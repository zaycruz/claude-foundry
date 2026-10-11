// foundry: the pi-palantir governed lane as a Claude Code mod.
// Orthanc tools, the approval ladder, Foundry context in the system prompt,
// pi-palantir's slash commands, and /foundry, the visual view of what is in context.
// Orthanc is the only path to Foundry: what it cannot do waits on an orthanc bead.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { FoundryPicker, FoundryPickerKind, FoundryPickItem, FoundryResource, FoundryResourceKind, FoundryScope } from '../types'
import {
  applyClear,
  blockedText,
  type ClearTarget,
  COMMAND_TABLE,
  type CommandEntry,
  COMPASS_KINDS,
  type CompassKind,
  contextLines,
  emptyScope,
  foundryTree,
  hasFocus,
  mergeSelections,
  normalizeScope,
  OBJECT_QUERY_BEAD,
  objectsQuery,
  ontologyChanged,
  RESOURCE_LABELS,
  resourceArgs,
  resourceRows,
} from './catalog'
import {
  type Envelope,
  failure,
  guideEnvelope,
  isCredentialCommand,
  isErrorEnvelope,
  isOversized,
  isUsageError,
  listItems,
  manifestFrom,
  normalizeCommand,
  parseEnvelope,
  renderCommand,
  renderListing,
  rowsOf,
  serialize,
} from './orthanc'
import {
  APPROVAL_MODES,
  type ApprovalMode,
  type ManifestCommand,
  classifyCall,
  compassRootReason,
  DEFAULT_APPROVAL_MODE,
  type GateClassification,
  type GuardVerdict,
  ladderDecision,
  loopStep,
  modeGuidance,
  ORTHANC_CLI,
  ORTHANC_HELP,
  parseApprovalMode,
} from './policy'

const SCOPE = { plugin: 'foundry', key: 'scope' } as const
const PICKER = { plugin: 'foundry', key: 'picker' } as const
const BRANCH = { plugin: 'foundry', key: 'workingBranch' } as const
const PANE = 'foundry-picker'
const CONTEXT_PANE = 'foundry-context'
const pickerAtom = atom(PICKER, null)
const scopeAtom = atom(SCOPE, emptyScope('unknown', ''))
const GUARD_MODEL = 'claude-haiku-5-5'
const VISIBLE_ROWS = 12
const TREE_ROWS = 8
const ROOT_CONCURRENCY = 6
const CLI_TIMEOUT_MS = 300_000

let loop: { identity: string; streak: number } | null = null
let manifestCache: readonly ManifestCommand[] | undefined
const helpCache = new Map<string, string>()
const refusedCommands: string[] = []

const asString = (value: unknown) => (typeof value === 'string' ? value : '')
const errorsOf = (envelope: Envelope) => JSON.stringify(envelope.errors).slice(0, 400)

async function orthancBin($: EngineInterface): Promise<string> {
  return (await $.env.get('ORTHANC_BIN'))?.trim() || 'orthanc'
}

// orthanc in agent mode, argv only, no shell; any failure comes back as an
// envelope so callers handle one shape.
async function runOrthanc(
  $: EngineInterface,
  argv: readonly string[],
  profile?: string,
  timeoutMs = CLI_TIMEOUT_MS,
): Promise<Envelope> {
  const full = ['--agent', '--non-interactive', ...(profile ? ['--profile', profile] : []), ...argv]
  try {
    const ran = await $.process.run([await orthancBin($), ...full], { timeoutMs })
    return (
      parseEnvelope(ran.stdout) ??
      failure('orthanc-launch-error', `orthanc exited ${ran.exitCode} with no foundry-agent-v1 envelope`, argv.join(' '), {
        exit_code: ran.exitCode,
        stderr: ran.stderr.slice(0, 4000),
      })
    )
  } catch (error) {
    return failure('orthanc-launch-error', error instanceof Error ? error.message : String(error), argv.join(' '))
  }
}

async function loadManifest($: EngineInterface): Promise<readonly ManifestCommand[]> {
  if (manifestCache !== undefined) return manifestCache
  const loaded = manifestFrom(await runOrthanc($, ['agent-manifest'], undefined, 30_000))
  if (loaded.length === 0) throw new Error('orthanc agent-manifest returned no commands')
  manifestCache = loaded
  return loaded
}

async function helpText($: EngineInterface, path: string): Promise<string | null> {
  const cached = helpCache.get(path)
  if (cached !== undefined) return cached
  try {
    const ran = await $.process.run([await orthancBin($), ...path.split(' '), '--help'], { timeoutMs: 15_000 })
    const text = `${ran.stdout}${ran.stderr}`.trim()
    if (text === '') return null
    helpCache.set(path, text)
    return text
  } catch {
    return null
  }
}

async function renderHelp($: EngineInterface, input: { group?: string; command?: string; query?: string }): Promise<string> {
  const commands = await loadManifest($)
  if (!input.command) return renderListing(commands, input)
  const path = normalizeCommand(input.command)
  const command = commands.find(entry => entry.path === path)
  if (command === undefined) return `Unknown Orthanc command '${path}'. Use orthanc_help with query to search commands.`
  return renderCommand(command, await helpText($, command.path))
}

async function executeCli($: EngineInterface, input: { command: string; args: string[]; profile?: string }): Promise<Envelope> {
  const commands = await loadManifest($)
  const command = commands.find(entry => entry.path === input.command)
  if (command === undefined) {
    return failure('unknown-command', `Unknown Orthanc command '${input.command}'. Call orthanc_help first.`, input.command)
  }
  if (isCredentialCommand(command)) {
    return failure(
      'credential-command-denied',
      `Orthanc command '${command.path}' requires credential input and is not available through orthanc_cli. The operator runs it in a terminal.`,
      command.path,
    )
  }
  const envelope = await runOrthanc($, [...command.path.split(' '), ...input.args], input.profile)
  return guideEnvelope(envelope, command, isUsageError(envelope) ? await helpText($, command.path) : null)
}

async function storedScopes($: EngineInterface): Promise<Record<string, unknown>> {
  const value = await $.store.get('scopes')
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

async function saveScope($: EngineInterface, scope: FoundryScope): Promise<void> {
  const next = { ...scope, updatedAt: new Date().toISOString() }
  await $.state.set(SCOPE, next)
  await $.store.set('scopes', { ...(await storedScopes($)), [next.profile]: next })
}

async function approvalMode($: EngineInterface): Promise<ApprovalMode> {
  return parseApprovalMode(asString(await $.store.get('approvalMode'))) ?? DEFAULT_APPROVAL_MODE
}

type Profile = { name: string; host: string; isDefault: boolean; status: string }

async function listProfiles($: EngineInterface): Promise<Profile[]> {
  const envelope = await runOrthanc($, ['configure', 'list'], undefined, 30_000)
  return listItems(envelope, 'profiles').map(entry => ({
    name: asString(entry.name),
    host: asString(entry.host),
    isDefault: entry.is_default === true,
    status: asString(entry.status),
  }))
}

async function activateProfile($: EngineInterface, profile: Profile): Promise<FoundryScope> {
  const next = normalizeScope((await storedScopes($))[profile.name], profile.name, profile.host)
  await $.env.set('FOUNDRY_PROFILE', profile.name)
  await $.store.set('defaultProfile', profile.name)
  await $.state.set(BRANCH, null)
  await saveScope($, { ...next, host: profile.host || next.host })
  return next
}

async function startupScope($: EngineInterface): Promise<void> {
  const profiles = await listProfiles($)
  const wanted = (await $.env.get('FOUNDRY_PROFILE')) || asString(await $.store.get('defaultProfile'))
  const chosen = profiles.find(profile => profile.name === wanted) ?? profiles.find(profile => profile.isDefault)
  if (chosen === undefined) {
    await $.state.set(SCOPE, emptyScope(wanted || 'unknown', ''))
    return
  }
  const scope = normalizeScope((await storedScopes($))[chosen.name], chosen.name, chosen.host)
  await $.env.set('FOUNDRY_PROFILE', chosen.name)
  await $.state.set(SCOPE, { ...scope, host: chosen.host || scope.host })
}

async function currentScope($: EngineInterface): Promise<FoundryScope> {
  return normalizeScope((await $.state.get(SCOPE)).value, 'unknown', '')
}

const profileArg = (scope: FoundryScope) => (scope.profile === 'unknown' ? undefined : scope.profile)

function contextText(scope: FoundryScope, mode: ApprovalMode): string {
  const lines = [
    '# Palantir Foundry',
    'Tools: `mcp__foundry__orthanc_help` (orthanc_help in the skills) discovers the Orthanc command surface; ' +
      '`mcp__foundry__orthanc_cli` (orthanc_cli) runs Orthanc in agent mode. Prefer them over raw `orthanc` in Bash ' +
      'and over any Palantir MCP server, which is a read-only fallback for documentation.',
    `Foundry stack: ${scope.profile}${scope.host ? ` (${scope.host})` : ''}. The operator switches it with /profile; do not pass --profile.`,
    ...contextLines(scope),
  ]
  if (hasFocus(scope)) {
    lines.push(
      'Start Foundry resource discovery from the selected ontology, projects and resources.',
      'For a bounded change: inspect the target, make the smallest reversible change, then run focused verification.',
      'Read documentation only for a concrete unknown, a tool error, or a high-risk irreversible operation.',
    )
  }
  lines.push(modeGuidance(mode))
  return lines.join('\n')
}

// The auto tier's classifier: pi-palantir asked Jev; here a Haiku call.
// Anything but a clean JSON verdict is null, which the ladder turns into ask.
async function guardVerdict(
  $: EngineInterface,
  tool: string,
  input: unknown,
  classification: GateClassification,
): Promise<GuardVerdict | null> {
  const answer = await $.model.complete({
    model: GUARD_MODEL,
    maxTokens: 200,
    timeoutMs: 15_000,
    system:
      'You review one Palantir Foundry mutation an agent wants to run. Answer only JSON: ' +
      '{"action":"approve"|"ask"|"deny","reason":"<one sentence>"}. approve: routine, reversible, ' +
      'scoped work on an agent branch. ask: unclear blast radius, shared or production resources, ' +
      'permissions, schema or ontology changes. deny: clearly destructive or targeting main/master or production.',
    prompt: JSON.stringify({ tool, input, classification }).slice(0, 8000),
  })
  if (!answer.isAnswered) return null
  try {
    const parsed: unknown = JSON.parse(answer.text.replace(/^```(json)?|```$/g, '').trim())
    if (typeof parsed !== 'object' || parsed === null) return null
    const { action, reason } = parsed as Record<string, unknown>
    if (action !== 'approve' && action !== 'ask' && action !== 'deny') return null
    return { action, reason: `guard: ${asString(reason) || action}` }
  } catch {
    return null
  }
}

async function askOperator($: EngineInterface, reason: string): Promise<boolean> {
  try {
    const answer = await $.ui.ask(`Approve Foundry mutation? ${reason}`, {
      header: 'Foundry',
      options: ['Approve', 'Decline'],
    })
    return answer === 'Approve'
  } catch {
    return false
  }
}

async function serveTool($: EngineInterface, tool: string, input: Record<string, unknown>) {
  if (tool === ORTHANC_HELP) {
    return {
      result: await renderHelp($, {
        group: asString(input.group).trim() || undefined,
        command: asString(input.command).trim() || undefined,
        query: asString(input.query).trim() || undefined,
      }),
    }
  }
  const scope = await currentScope($)
  const envelope = await executeCli($, {
    command: normalizeCommand(asString(input.command)),
    args: Array.isArray(input.args) ? input.args.map(String) : [],
    profile: profileArg(scope),
  })
  return { result: serialize(envelope, await spill($, input.command, envelope)), ...(isErrorEnvelope(envelope) ? { context: ['The Orthanc call returned errors; read them before retrying.'] } : {}) }
}

// Writes an oversized envelope where the model can read it whole; undefined when
// it fits inline or the write fails (the cut text still carries the page token).
async function spill($: EngineInterface, command: unknown, envelope: Envelope): Promise<string | undefined> {
  if (!isOversized(envelope)) return undefined
  const base = ((await $.env.get('TMPDIR')) || '/tmp').replace(/\/$/, '')
  const path = `${base}/foundry-orthanc/${Date.now()}-${asString(command).trim().replace(/\W+/g, '-') || 'output'}.json`
  try {
    await $.fs.write(path, JSON.stringify(envelope, null, 2))
    return path
  } catch {
    return undefined
  }
}

// ---------- pickers ----------

type Source = { title: string; isMulti: boolean; items: FoundryPickItem[]; resourceKind?: FoundryResourceKind }
type PickerOptions = { resourceKind?: FoundryResourceKind; chain?: FoundryPickerKind[] }

const toItems = (resources: readonly FoundryResource[]): FoundryPickItem[] =>
  resources.map(entry => ({ key: entry.rid, label: entry.name, hint: entry.hint }))

async function inBatches<T, R>(values: readonly T[], size: number, run: (value: T) => Promise<R>): Promise<R[]> {
  const out: R[] = []
  for (let index = 0; index < values.length; index += size) out.push(...(await Promise.all(values.slice(index, index + size).map(run))))
  return out
}

/** Compass resources of one kind under the selected projects, or every visible project. */
async function compassSource($: EngineInterface, scope: FoundryScope, kind: CompassKind, query: string): Promise<Source | string> {
  const def = COMPASS_KINDS[kind]
  let roots = scope.projects.map(project => project.rid)
  if (roots.length === 0) {
    const projects = await runOrthanc($, ['project', 'list'], scope.profile, 120_000)
    if (isErrorEnvelope(projects)) return `project list failed: ${errorsOf(projects)}`
    roots = listItems(projects, 'projects').map(entry => asString(entry.rid)).filter(Boolean)
  }
  if (roots.length === 0) return 'No projects are visible on this stack. No selection was saved.'
  const search = kind === 'folders' && !query.trim() ? 'ri.compass.main.folder.' : query
  const envelopes = await inBatches(roots, ROOT_CONCURRENCY, root =>
    runOrthanc($, resourceArgs(search, def.typeId, root), scope.profile, 180_000),
  )
  const failed = envelopes.filter(isErrorEnvelope)
  if (failed.length === envelopes.length && failed[0]) return `resource listing failed: ${errorsOf(failed[0])}`
  const rows = resourceRows(envelopes.flatMap(envelope => rowsOf(envelope, ['resources'])))
  return {
    title: `${def.label}${scope.projects.length > 0 ? ' in selected projects' : ''}`,
    isMulti: true,
    items: toItems(rows),
    resourceKind: kind,
  }
}

async function pickerSource(
  $: EngineInterface,
  kind: FoundryPickerKind,
  scope: FoundryScope,
  query: string,
  resourceKind?: FoundryResourceKind,
): Promise<Source | string> {
  if (kind === 'profile') {
    const profiles = await listProfiles($)
    return {
      title: 'Foundry stack',
      isMulti: false,
      items: profiles.map(profile => ({
        key: profile.name,
        label: profile.name,
        hint: [profile.host, profile.status, profile.name === scope.profile ? 'active' : ''].filter(Boolean).join(' · '),
      })),
    }
  }
  if (scope.profile === 'unknown') return 'No Foundry stack is active. Run /profile first.'
  if (kind === 'resource') {
    if (resourceKind && resourceKind in COMPASS_KINDS) return compassSource($, scope, resourceKind as CompassKind, query)
    return 'This resource kind has no listing; use its lookup command.'
  }
  if (kind === 'ontology') {
    const envelope = await runOrthanc($, ['ontology', 'list'], scope.profile, 60_000)
    if (isErrorEnvelope(envelope)) return `ontology list failed: ${errorsOf(envelope)}`
    return {
      title: 'Ontology',
      isMulti: false,
      items: listItems(envelope, 'data').map(entry => ({
        key: asString(entry.rid),
        label: asString(entry.display_name) || asString(entry.api_name),
        hint: asString(entry.rid),
      })),
    }
  }
  if (kind === 'project') {
    const envelope = await runOrthanc($, ['project', 'list'], scope.profile, 120_000)
    if (isErrorEnvelope(envelope)) return `project list failed: ${errorsOf(envelope)}`
    return {
      title: 'Projects',
      isMulti: true,
      items: listItems(envelope, 'projects').map(entry => ({
        key: asString(entry.rid),
        label: asString(entry.display_name) || asString(entry.name),
        hint: asString(entry.path),
      })),
    }
  }
  if (scope.ontology === null) return 'No ontology is selected. Run /ontology first.'
  const isAction = kind === 'action-type'
  const envelope = await runOrthanc(
    $,
    ['ontology', isAction ? 'action-type-list' : 'object-type-list', scope.ontology.rid],
    scope.profile,
    120_000,
  )
  if (isErrorEnvelope(envelope)) return `${isAction ? 'action' : 'object'}-type-list failed: ${errorsOf(envelope)}`
  return {
    title: isAction ? 'Action types' : 'Object types',
    isMulti: true,
    items: listItems(envelope, isAction ? 'action_types' : 'object_types').map(entry => ({
      key: asString(entry.api_name),
      label: asString(entry.display_name) || asString(entry.api_name),
      hint: asString(entry.api_name),
    })),
  }
}

async function applyPick($: EngineInterface, picker: FoundryPicker, keys: readonly string[]): Promise<string> {
  const scope = await currentScope($)
  const chosen = picker.items.filter(item => keys.includes(item.key))
  if (picker.kind === 'profile') {
    const profile = (await listProfiles($)).find(entry => entry.name === chosen[0]?.key)
    if (profile === undefined) return 'No stack selected.'
    const next = await activateProfile($, profile)
    return `Foundry stack: ${next.profile}${next.ontology ? `, ontology ${next.ontology.name}` : ''}.`
  }
  if (picker.kind === 'ontology') {
    const pick = chosen[0]
    if (pick === undefined) return 'No ontology selected.'
    await saveScope($, ontologyChanged(scope, { rid: pick.key, name: pick.label }))
    return `Ontology: ${pick.label}. Projects, types, functions and object instances were cleared.`
  }
  if (picker.kind === 'project') {
    await saveScope($, { ...scope, projects: chosen.map(item => ({ rid: item.key, name: item.label })) })
    return `Projects: ${chosen.map(item => item.label).join(', ') || 'none'}.`
  }
  if (picker.kind === 'resource' && picker.resourceKind) {
    const kind = picker.resourceKind
    const asResource = (item: FoundryPickItem): FoundryResource => ({ rid: item.key, name: item.label, hint: item.hint })
    const merged = mergeSelections(scope.resources[kind] ?? [], chosen.map(asResource), picker.items.map(asResource))
    await saveScope($, { ...scope, resources: { ...scope.resources, [kind]: merged } })
    return `${RESOURCE_LABELS[kind]}: ${merged.map(entry => entry.name).join(', ') || 'none'}.`
  }
  const key = picker.kind === 'action-type' ? 'actionTypes' : 'objectTypes'
  await saveScope($, { ...scope, [key]: chosen.map(item => ({ apiName: item.key, displayName: item.label })) })
  return `${picker.title}: ${chosen.map(item => item.label).join(', ') || 'none'}.`
}

const matches = (item: FoundryPickItem, filter: string) => {
  const haystack = `${item.label} ${item.hint} ${item.key}`.toLowerCase()
  return filter.toLowerCase().split(/\s+/).filter(Boolean).every(term => haystack.includes(term))
}

function preselected(scope: FoundryScope, kind: FoundryPickerKind, resourceKind?: FoundryResourceKind): string[] {
  if (kind === 'project') return scope.projects.map(project => project.rid)
  if (kind === 'object-type') return scope.objectTypes.map(type => type.apiName)
  if (kind === 'action-type') return scope.actionTypes.map(type => type.apiName)
  if (kind === 'resource' && resourceKind) return (scope.resources[resourceKind] ?? []).map(entry => entry.rid)
  return []
}

/** Opens the picker pane on `source`, or answers in text where no pane can be placed. */
async function openPicker($: EngineInterface, kind: FoundryPickerKind, source: Source, query: string, chain: FoundryPickerKind[]): Promise<string> {
  const scope = await currentScope($)
  if (source.items.length === 0) return `No ${source.title.toLowerCase()} found. No selection was saved.`
  const picker: FoundryPicker = {
    kind,
    ...(source.resourceKind ? { resourceKind: source.resourceKind } : {}),
    title: source.title,
    isMulti: source.isMulti,
    items: source.items,
    chosen: preselected(scope, kind, source.resourceKind),
    filter: kind === 'resource' ? '' : query,
    chain,
  }
  const filtered = source.items.filter(item => matches(item, picker.filter))
  const only = filtered.length === 1 ? filtered[0] : undefined
  if (query !== '' && only) return applyPick($, picker, [...new Set([...picker.chosen, only.key])])
  await $.state.set(PICKER, picker)
  const opened = await $.ui.open({ id: PANE, title: source.title, focus: true, closeOnEscape: true })
  if (!opened.isPlaced) {
    await $.state.set(PICKER, null)
    const lines = filtered.slice(0, 20).map(item => `- ${item.label}  (${item.hint || item.key})`)
    return [`${filtered.length} ${source.title.toLowerCase()}; widen the terminal for the picker, or narrow the command with a filter.`, ...lines].join('\n')
  }
  return `Choose ${source.title.toLowerCase()} in the picker (type to filter, Enter or a click selects, Esc cancels).`
}

async function runPicker($: EngineInterface, kind: FoundryPickerKind, args: string, options: PickerOptions = {}): Promise<string> {
  const scope = await currentScope($)
  const query = args.trim()
  if (query === 'clear' && kind !== 'profile') {
    if (kind === 'ontology') await saveScope($, ontologyChanged(scope, null))
    if (kind === 'project') await saveScope($, { ...scope, projects: [] })
    if (kind === 'object-type') await saveScope($, { ...scope, objectTypes: [] })
    if (kind === 'action-type') await saveScope($, { ...scope, actionTypes: [] })
    if (kind === 'resource' && options.resourceKind) {
      await saveScope($, { ...scope, resources: { ...scope.resources, [options.resourceKind]: [] } })
    }
    return `Cleared ${options.resourceKind ? RESOURCE_LABELS[options.resourceKind].toLowerCase() : kind} selection.`
  }
  const source = await pickerSource($, kind, scope, query, options.resourceKind)
  if (typeof source === 'string') return source
  return openPicker($, kind, source, query, options.chain ?? [])
}

// ---------- lookups ----------

async function lookupSource($: EngineInterface, entry: CommandEntry, args: string, scope: FoundryScope): Promise<Source | string> {
  if (entry.action.type !== 'lookup') return 'Not a lookup.'
  const { lookup, kind } = entry.action
  const query = args.trim()
  const usage = `Usage: /${entry.name} ${entry.argumentHint ?? ''}`.trim()
  const source = (title: string, rows: FoundryResource[]): Source => ({ title, isMulti: true, items: toItems(rows), resourceKind: kind })
  if (lookup === 'objects') {
    const parsed = objectsQuery(query)
    if (parsed === null) {
      return query
        ? `Free-text object search needs 'ontology object-search --query' in orthanc (bead ${OBJECT_QUERY_BEAD}). ` +
            `For now name the property: /${entry.name} <property>=<text>.`
        : usage
    }
    if (scope.ontology === null || scope.objectTypes.length === 0) return 'Choose an ontology and at least one object type first (/ontology, /object-type).'
    const where = JSON.stringify({ type: 'containsAllTerms', field: parsed.property, value: parsed.text })
    const ontology = scope.ontology
    const envelopes = await Promise.all(
      scope.objectTypes.map(type =>
        runOrthanc($, ['ontology', 'object-search', '--where-json', where, '--select', parsed.property, ontology.rid, type.apiName], scope.profile, 120_000).then(
          envelope => ({ type, envelope }),
        ),
      ),
    )
    const failed = envelopes.find(({ envelope }) => isErrorEnvelope(envelope))
    const rows = envelopes.flatMap(({ type, envelope }) =>
      rowsOf(envelope, ['data']).map(row => {
        const key = asString(row.__rid) || `${type.apiName}:${asString(row.__primaryKey) || String(row[parsed.property] ?? '')}`
        return { rid: key, name: String(row.__title ?? row[parsed.property] ?? key), hint: type.displayName }
      }),
    )
    if (rows.length === 0 && failed) return `object-search failed: ${errorsOf(failed.envelope)}`
    return source(`Object instances matching ${parsed.property}=${parsed.text}`, resourceRows(rows.map(row => ({ rid: row.rid, name: row.name, path: row.hint }))))
  }
  if (lookup === 'language-model') {
    const envelope = await runOrthanc($, ['language-models', 'list'], scope.profile, 60_000)
    if (isErrorEnvelope(envelope)) return `language-models list failed: ${errorsOf(envelope)}`
    return source('Language models', resourceRows(rowsOf(envelope, ['models', 'language_models', 'data']), ['provider', 'type']))
  }
  if (!query) return usage
  if (lookup === 'function') {
    const envelope = await runOrthanc($, ['functions', 'search', query, '--limit', '100'], scope.profile, 60_000)
    if (isErrorEnvelope(envelope)) return `functions search failed: ${errorsOf(envelope)}`
    return source(`Functions matching '${query}'`, resourceRows(rowsOf(envelope, ['results']), ['api_name', 'version', 'type']))
  }
  if (lookup === 'search') {
    const envelope = await runOrthanc($, ['search', query, '--limit', '100'], scope.profile, 60_000)
    if (isErrorEnvelope(envelope)) return `search failed: ${errorsOf(envelope)}`
    return source(`Resources matching '${query}'`, resourceRows(rowsOf(envelope, ['results'])))
  }
  if (lookup === 'permission') {
    const envelope = await runOrthanc($, ['resource-role', 'list', query], scope.profile, 60_000)
    if (isErrorEnvelope(envelope)) return `resource-role list failed: ${errorsOf(envelope)}`
    const rows = rowsOf(envelope, ['roles']).map(row => ({
      rid: `${query}#${asString(row.principal_id)}:${asString(row.role_name)}`,
      name: `${asString(row.principal_type).toLowerCase()} ${asString(row.principal_id)} → ${asString(row.role_name)}`,
      path: query,
    }))
    return source(`Role grants on ${query}`, resourceRows(rows))
  }
  // media-item: one item, added directly.
  const [setRid, ...rest] = query.split(/\s+/)
  const item = rest.join(' ')
  if (!setRid || !item) return usage
  const envelope = await runOrthanc(
    $,
    /^ri\./i.test(item) ? ['media-sets', 'get', setRid, item] : ['media-sets', 'get-by-path', setRid, item],
    scope.profile,
    60_000,
  )
  if (isErrorEnvelope(envelope)) return `media item lookup failed: ${errorsOf(envelope)}`
  const data = typeof envelope.data === 'object' && envelope.data !== null && !Array.isArray(envelope.data) ? (envelope.data as Record<string, unknown>) : {}
  const rid = asString(data.rid) || asString(data.media_item_rid) || asString(data.mediaItemRid) || (/^ri\./i.test(item) ? item : '')
  if (!rid) return 'The media item response did not include an RID. No selection was saved.'
  const selected = { rid, name: asString(data.path) || item, hint: setRid }
  const next = mergeSelections(scope.resources.mediaItems ?? [], [selected], [selected])
  await saveScope($, { ...scope, resources: { ...scope.resources, mediaItems: next } })
  return `Media items: ${next.map(entry => entry.name).join(', ')}.`
}

async function runLookup($: EngineInterface, entry: CommandEntry, args: string): Promise<string> {
  if (entry.action.type !== 'lookup') return 'Not a lookup.'
  const kind = entry.action.kind
  if (args.trim() === 'clear') return runPicker($, 'resource', 'clear', { resourceKind: kind })
  // Parse-only answers (usage, waits-on-bead) come before the stack check.
  if (entry.action.lookup === 'objects' && objectsQuery(args) === null) return (await lookupSource($, entry, args, emptyScope('unknown', ''))) as string
  const scope = await currentScope($)
  if (scope.profile === 'unknown') return 'No Foundry stack is active. Run /profile first.'
  const source = await lookupSource($, entry, args, scope)
  if (typeof source === 'string') return source
  return openPicker($, 'resource', source, '', [])
}

// ---------- status, onboarding, auth ----------

type Check = { label: string; ok: boolean; detail: string; fix?: string }

async function setupChecks($: EngineInterface): Promise<{ checks: Check[]; scope: FoundryScope }> {
  const checks: Check[] = []
  const version = await runOrthanc($, ['version'], undefined, 15_000)
  const versionText = JSON.stringify(version.data ?? '').replace(/[{}"]/g, '').slice(0, 120)
  checks.push({
    label: 'orthanc',
    ok: !isErrorEnvelope(version),
    detail: isErrorEnvelope(version) ? errorsOf(version) : `${await orthancBin($)} ${versionText}`,
    fix: 'Install orthanc or set ORTHANC_BIN.',
  })
  const profiles = await listProfiles($)
  checks.push({ label: 'profiles', ok: profiles.length > 0, detail: profiles.map(profile => `${profile.name} (${profile.status || '?'})`).join(', ') || 'none', fix: '/auth <name> to create one.' })
  const scope = await currentScope($)
  const active = profiles.find(profile => profile.name === scope.profile)
  checks.push({ label: 'stack', ok: active !== undefined, detail: active ? `${active.name} · ${active.host}` : 'none active', fix: '/profile' })
  if (active) {
    const probe = await runOrthanc($, ['ontology', 'list'], active.name, 60_000)
    checks.push({
      label: 'credentials',
      ok: !isErrorEnvelope(probe),
      detail: isErrorEnvelope(probe) ? errorsOf(probe) : 'ontology list works',
      fix: `/auth ${active.name}`,
    })
  }
  checks.push({ label: 'context', ok: hasFocus(scope), detail: hasFocus(scope) ? 'ontology or projects selected' : 'nothing selected', fix: '/open' })
  return { checks, scope }
}

const renderChecks = (checks: readonly Check[]) =>
  checks.map(check => `${check.ok ? '✓' : '✗'} ${check.label}: ${check.detail}${check.ok || !check.fix ? '' : `  → ${check.fix}`}`).join('\n')

async function authText($: EngineInterface, args: string): Promise<string> {
  const scope = await currentScope($)
  const target = args.trim() || scope.profile
  const profile = (await listProfiles($)).find(entry => entry.name === target)
  const host = profile?.host || '<https://your-stack.palantirfoundry.com>'
  const lines = [
    `Credentials never pass through Claude. Run one of these in your own terminal:`,
    profile
      ? `  orthanc auth store --profile ${target} --host ${host}    # paste the token on stdin`
      : `  orthanc configure profile create    # new profile '${target}': host and token`,
    `Then run /onboard (or /profile ${target}) here to verify.`,
  ]
  if (profile) {
    const probe = await runOrthanc($, ['ontology', 'list'], target, 60_000)
    lines.unshift(isErrorEnvelope(probe) ? `${target}: credentials do not work (${errorsOf(probe).slice(0, 160)}).` : `${target}: credentials already work.`)
  }
  return lines.join('\n')
}

// ---------- /foundry ----------

async function treeText($: EngineInterface): Promise<string> {
  const scope = await currentScope($)
  const nodes = foundryTree(scope)
  const lines = [`Foundry context · ${scope.profile}${scope.host ? ` (${scope.host})` : ''} · ~${Math.ceil(contextText(scope, await approvalMode($)).length / 4)} tokens`]
  if (nodes.length === 0) lines.push('  nothing selected: /open sets the stack, ontology and projects')
  nodes.forEach((node, index) => {
    const last = index === nodes.length - 1
    lines.push(`${last ? '└─' : '├─'} ${node.label}${node.detail ? `: ${node.detail}` : ` (${node.count})`}`)
    node.children.slice(0, TREE_ROWS).forEach((child, childIndex) => {
      lines.push(`${last ? '   ' : '│  '}${childIndex === node.children.length - 1 ? '└─' : '├─'} ${child.label}  ${child.detail}`)
    })
    if (node.children.length > TREE_ROWS) lines.push(`${last ? '   ' : '│  '}   … ${node.children.length - TREE_ROWS} more`)
  })
  return lines.join('\n')
}

async function clearFromTree($: EngineInterface, target: ClearTarget): Promise<void> {
  await saveScope($, applyClear(await currentScope($), target))
}

// ---------- registration ----------

async function runEntry($: EngineInterface, entry: CommandEntry, args: string): Promise<string> {
  const action = entry.action
  switch (action.type) {
    case 'picker':
      return runPicker($, action.kind, args)
    case 'resource':
      return runPicker($, 'resource', args, { resourceKind: action.kind })
    case 'blocked':
      return blockedText(action.what, action.bead)
    case 'lookup':
      return runLookup($, entry, args)
    case 'open': {
      const scope = await currentScope($)
      if (scope.profile === 'unknown') return runPicker($, 'profile', '', { chain: ['ontology', 'project'] })
      return runPicker($, 'ontology', '', { chain: ['project'] })
    }
    case 'onboard': {
      const { checks } = await setupChecks($)
      const failing = checks.filter(check => !check.ok)
      return `${renderChecks(checks)}\n${failing.length === 0 ? 'Setup is complete.' : `Next: ${failing[0]?.fix ?? ''}`}`
    }
    case 'auth':
      return authText($, args)
    case 'mcp-status': {
      const { checks } = await setupChecks($)
      const manifest = await loadManifest($).catch(() => [])
      return [
        renderChecks(checks),
        `orthanc commands: ${manifest.length} in the agent manifest`,
        `tools: mcp__foundry__orthanc_help, mcp__foundry__orthanc_cli`,
        refusedCommands.length > 0 ? `commands Claude Code refused: ${refusedCommands.join(', ')}` : 'all foundry slash commands registered',
      ].join('\n')
    }
    case 'scope': {
      const wanted = args.trim()
      const scope = await currentScope($)
      if (wanted === 'clear') {
        await saveScope($, emptyScope(scope.profile, scope.host))
        return 'Foundry context cleared.'
      }
      if (wanted === 'ontology') return runPicker($, 'ontology', '')
      const branch = (await $.state.get(BRANCH)).value ?? null
      return [await treeText($), `Working branch: ${branch ?? 'none'} · approval: ${await approvalMode($)}`, '/foundry opens the interactive view.'].join('\n')
    }
    case 'approval': {
      const wanted = args.trim()
      if (wanted === '') return `Foundry approval mode: ${await approvalMode($)}. Modes: ${APPROVAL_MODES.join(', ')}.`
      const mode = parseApprovalMode(wanted)
      if (mode === null) return `Unknown mode '${wanted}'. Modes: ${APPROVAL_MODES.join(', ')}.`
      await $.store.set('approvalMode', mode)
      return `Foundry approval mode: ${mode}.`
    }
    case 'foundry': {
      const opened = await $.ui.open({ id: CONTEXT_PANE, title: 'Foundry context', focus: true, closeOnEscape: true })
      return opened.isPlaced ? 'Foundry context is open (Esc closes it).' : await treeText($)
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.tool.register({
      name: 'orthanc_help',
      isDeferred: false,
      description:
        'Discover the Orthanc CLI command surface (orthanc agent-manifest). Use before orthanc_cli. Orthanc is the ' +
        'preferred path for Foundry reads, diagnostics, plan-first mutations and dependency work.',
      inputSchema: {
        type: 'object',
        properties: {
          group: { type: 'string', description: "Command group to list, e.g. 'ontology', 'dataset', 'repository'." },
          command: { type: 'string', description: "Full command path to inspect, e.g. 'dataset branches list'." },
          query: { type: 'string', description: 'Keyword search across command paths.' },
        },
      },
    })
    await $.tool.register({
      name: 'orthanc_cli',
      isDeferred: false,
      description:
        'Run an Orthanc command in agent mode (orthanc --agent --non-interactive) against the active Foundry stack. ' +
        '`command` is the manifest path from orthanc_help; `args` are positionals then flags. Returns the ' +
        'foundry-agent-v1 envelope. Mutations pass the Foundry approval ladder and may wait for the operator.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: "Full command path, e.g. 'ontology object-search'." },
          args: { type: 'array', items: { type: 'string' }, description: 'Positionals first, then exact flags.' },
        },
        required: ['command'],
      },
    })
    refusedCommands.length = 0
    for (const entry of COMMAND_TABLE) {
      try {
        await $.command.register({ name: entry.name, description: entry.description, ...(entry.argumentHint ? { argumentHint: entry.argumentHint } : {}) })
      } catch {
        refusedCommands.push(`/${entry.name}`)
      }
    }
    if (refusedCommands.length > 0) $.ui.log(`foundry: commands refused: ${refusedCommands.join(', ')}`, { to: 'debug' })
    await startupScope($).catch(error => $.ui.log(`foundry: no stack selected (${String(error)})`, { to: 'debug' }))
    void loadManifest($).catch(() => undefined)
    return started
  })

  // Subagents do not get the session's prompt sections: hand the Foundry block
  // to the mod's own agents as context when they start.
  on('classic.SubagentStart', async ($, e, next) => {
    const started = await next(e)
    if (!e.agent_type.startsWith('foundry:')) return started
    const text = contextText(await currentScope($), await approvalMode($))
    return { ...started, additionalContext: [...(started.additionalContext ?? []), text] }
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = contextText(await currentScope($), await approvalMode($))
    return { sections: [...composed.sections, { id: 'foundry:context', text, scope: 'session' }] }
  })

  // The guard, then the tools this mod serves. One hook, so the order of
  // compass check → ladder → loop guard → serve is fixed.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, consent: _consent, ...input } =
      e as unknown as Record<string, unknown>
    const rootReason = compassRootReason(tool, input)
    if (rootReason) return { deny: rootReason }

    const manifest = tool === ORTHANC_CLI || tool === 'Bash' ? await loadManifest($).catch(() => []) : []
    const branch = (await $.state.get(BRANCH)).value ?? null
    const classification = classifyCall(tool, input, manifest, branch)
    if (classification) {
      const mode = await approvalMode($)
      const verdict =
        mode === 'auto' && classification.kind === 'mutation'
          ? await guardVerdict($, tool, input, classification).catch(() => null)
          : undefined
      const decision = ladderDecision(mode, classification, verdict)
      $.ui.log(`foundry: ${tool} ${classification.command ?? ''} → ${decision.outcome}: ${decision.reason}`, { to: 'debug' })
      if (decision.outcome === 'block') return { deny: decision.reason }
      if (decision.outcome === 'ask' && !(await askOperator($, decision.reason))) {
        return { deny: `Operator declined or no one could be asked: ${decision.reason}` }
      }
    }

    const looped = loopStep(loop, tool, input)
    loop = looped.next
    if (looped.reason) return { deny: looped.reason }

    const ran = tool === ORTHANC_CLI || tool === ORTHANC_HELP ? await serveTool($, tool, input) : await next(e)
    if (classification?.kind === 'branch-creation' && classification.command === 'global-branch create') {
      const text = typeof ran.result === 'string' ? ran.result : ''
      if (text !== '' && !text.includes('"errors": [\n')) await $.state.set(BRANCH, classification.proposedName ?? null)
    }
    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'foundry: the Foundry guard failed; the call was not run.' }))

  for (const entry of COMMAND_TABLE) {
    on('command.run', { command: entry.name }, async ($, e) => ({ text: await runEntry($, entry, e.args) })).catch(
      ($, e, next) => ({ text: `/${e.command} failed: ${next.error instanceof Error ? next.error.message : String(next.error)}` }),
    )
  }

  // The picker every list command opens.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const picker = await read($, pickerAtom)
    if (picker === null) return <Text dimColor>Nothing to choose.</Text>
    const shown = picker.items.filter(item => matches(item, picker.filter))
    const finish = async (keys: readonly string[]) => {
      const text = await applyPick($, picker, keys)
      await $.state.set(PICKER, null)
      await $.ui.close({ id: PANE })
      $.ui.toast(text)
      const [following, ...rest] = picker.chain
      if (following) $.ui.toast(await runPicker($, following, '', { chain: rest }))
    }
    const press = (item: FoundryPickItem) => () =>
      picker.isMulti
        ? update($, pickerAtom, current =>
            current
              ? {
                  ...current,
                  chosen: current.chosen.includes(item.key)
                    ? current.chosen.filter(key => key !== item.key)
                    : [...current.chosen, item.key],
                }
              : null,
          )
        : finish([item.key])
    return (
      <Box flexDirection="column">
        <Input
          key="filter"
          label="Filter "
          value={picker.filter}
          autoFocus
          submitLabel={picker.isMulti ? 'done' : 'pick first'}
          onInput={value => void update($, pickerAtom, current => (current ? { ...current, filter: value } : null))}
          onSubmit={() => {
            const first = shown[0]
            if (picker.isMulti) void finish(picker.chosen)
            else if (first) void finish([first.key])
          }}
        />
        <Text dimColor>
          {shown.length} of {picker.items.length}
          {picker.isMulti ? ` · ${picker.chosen.length} chosen` : ''}
          {picker.chain.length > 0 ? ` · then ${picker.chain.join(', ')}` : ''}
        </Text>
        {shown.slice(0, VISIBLE_ROWS).map(item => (
          <Button key={`item-${item.key}`} plain onPress={press(item)}>
            {picker.isMulti ? (picker.chosen.includes(item.key) ? '[x] ' : '[ ] ') : ''}
            {item.label} <Text dimColor>{item.hint}</Text>
          </Button>
        ))}
        {picker.isMulti && (
          <Button key="done" variant="primary" label="Done" onPress={() => void finish(picker.chosen)} />
        )}
      </Box>
    )
  })

  // /foundry: the Foundry resources in context, as /context shows the window.
  on('ui.render', { component: 'Pane', requestId: CONTEXT_PANE }, async ($, e, next) => {
    if (e.surface === 'mobile') return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)
    const scope = normalizeScope(await read($, scopeAtom), 'unknown', '')
    const mode = await approvalMode($)
    const branch = (await $.state.get(BRANCH)).value ?? null
    const nodes = foundryTree(scope)
    const tokens = Math.ceil(contextText(scope, mode).length / 4)
    const widest = Math.max(1, ...nodes.map(node => node.count))
    const clear = (target: ClearTarget) => () => void clearFromTree($, target)
    return (
      <Box flexDirection="column">
        <Text bold>
          {scope.profile}
          <Text dimColor>{scope.host ? `  ${scope.host}` : ''}</Text>
        </Text>
        <Text dimColor>
          ~{tokens} tokens in the system prompt · approval {mode} · branch {branch ?? 'none'}
        </Text>
        {nodes.length === 0 && <Text dimColor>Nothing selected. /open sets the stack, ontology and projects.</Text>}
        {nodes.map(node => (
          <Box key={node.id} flexDirection="column" marginTop={1}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text>
                <Text color="cyan">{'█'.repeat(Math.max(1, Math.round((node.count / widest) * 12)))}</Text>
                {' '}
                <Text bold>{node.label}</Text>
                <Text dimColor>{node.detail ? `  ${node.detail}` : `  ${node.count}`}</Text>
                <Text dimColor>{`  ${node.command}`}</Text>
              </Text>
              {node.clear && <Button key={`clear-${node.id}`} plain label="clear" onPress={clear(node.clear)} />}
            </Box>
            {node.children.slice(0, TREE_ROWS).map((child, index) => (
              <Box key={child.id} flexDirection="row" justifyContent="space-between">
                <Text>
                  <Text dimColor>{index === Math.min(node.children.length, TREE_ROWS) - 1 ? '  └─ ' : '  ├─ '}</Text>
                  {child.label}
                  <Text dimColor>{`  ${child.detail}`}</Text>
                </Text>
                {child.clear && <Button key={`x-${child.id}`} plain label="×" onPress={clear(child.clear)} />}
              </Box>
            ))}
            {node.children.length > TREE_ROWS && <Text dimColor>{`     … ${node.children.length - TREE_ROWS} more (${node.command})`}</Text>}
          </Box>
        ))}
        <Box marginTop={1}>
          <Button key="close" label="Close" onPress={() => void $.ui.close({ id: CONTEXT_PANE })} />
        </Box>
      </Box>
    )
  })
}
