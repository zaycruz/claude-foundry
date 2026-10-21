// foundry: a governed Palantir Foundry lane as a Claude Code mod.
// Orthanc tools, the approval ladder, Foundry context in the system prompt,
// one slash command per Foundry resource, and /foundry, the visual view of what is in context.
// Orthanc is the only path to Foundry: what it cannot do waits on an orthanc bead.

import { atom, read, update } from 'claude-code'
import type { Args, EngineInterface, EventResult, Next, Register } from 'claude-code'

import type { FdeSession, FoundryPicker, FoundryPickerKind, FoundryPickItem, FoundryResource, FoundryResourceKind, FoundryScope } from '../types'
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
  namespaceChanged,
  normalizeScope,
  OBJECT_QUERY_BEAD,
  objectsQuery,
  ontologyChanged,
  RESOURCE_LABELS,
  resourceArgs,
  resourceRows,
} from './catalog'
import {
  adoptable,
  branchCreateArgs,
  foreignRids,
  goalLabel,
  takePlan,
  branchRidFrom,
  contentHash,
  fdeBind,
  fdeBranchName,
  fdeContext,
  fdeHandoff,
  fdeStatus,
  fileCandidates,
  hasApply,
  parseFdeArgs,
  planGate,
  planSignature,
  recordApply,
  recordPlan,
} from './fde'
import {
  CLI_TIMEOUT_FLOOR_MS,
  cliTimeoutMs,
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
import { PROCESS_RUN_MAX_MS, type ProcessOutput, readToExit } from './process'
import {
  APPROVAL_MODES,
  type ApprovalMode,
  type ManifestCommand,
  classifyCall,
  classifyOrthancCommand,
  compassRootReason,
  DEFAULT_APPROVAL_MODE,
  type GateClassification,
  type GuardVerdict,
  FOUNDRY_GIT_PUSH_REASON,
  gitPushDirectories,
  gitPushNamesFoundry,
  ladderDecision,
  loopStep,
  modeGuidance,
  ORTHANC_CLI,
  ORTHANC_HELP,
  parseApprovalMode,
  resolveOrthancCommand,
  rulesWriteReason,
} from './policy'
import {
  domainPatterns,
  langfuseApiBase,
  otlpBody,
  parseEnvFile,
  randomHex,
  redactString,
  resourceAttributes,
  serializePayload,
  type SpanRecord,
  type TraceConfig,
  type TraceEnv,
  traceConfig,
} from './telemetry'

const SCOPE = { plugin: 'foundry', key: 'scope' } as const
const PICKER = { plugin: 'foundry', key: 'picker' } as const
const BRANCH = { plugin: 'foundry', key: 'workingBranch' } as const
const FDE = { plugin: 'foundry', key: 'fde' } as const
const PANE = 'foundry-picker'
const CONTEXT_PANE = 'foundry-context'
const pickerAtom = atom(PICKER, null)
const scopeAtom = atom(SCOPE, emptyScope('unknown', ''))
const fdeAtom = atom(FDE, null)
const GUARD_MODEL = 'claude-haiku-5-5'
const VISIBLE_ROWS = 12
const TREE_ROWS = 8
const ROOT_CONCURRENCY = 6

let loop: { identity: string; streak: number } | null = null
let manifestCache: readonly ManifestCommand[] | undefined
const helpCache = new Map<string, string>()
const refusedCommands: string[] = []

const asString = (value: unknown) => (typeof value === 'string' ? value : '')
const errorsOf = (envelope: Envelope) => JSON.stringify(envelope.errors).slice(0, 400)

async function orthancBin($: EngineInterface): Promise<string> {
  return (await $.env.get('ORTHANC_BIN'))?.trim() || 'orthanc'
}

// $.process.run stops at ten minutes: a longer wait streams under its own deadline.
async function runLong($: EngineInterface, command: readonly string[], timeoutMs: number): Promise<ProcessOutput> {
  let expire = () => {}
  const expired = new Promise<void>(resolve => {
    expire = resolve
  })
  const timer = $.clock.after(timeoutMs, () => expire())
  try {
    return await readToExit($.process.spawn({ argv: command }), expired, timeoutMs)
  } finally {
    timer.cancel()
  }
}

// orthanc in agent mode, argv only, no shell; any failure comes back as an
// envelope so callers handle one shape.
async function runOrthanc(
  $: EngineInterface,
  argv: readonly string[],
  profile?: string,
  timeoutMs = CLI_TIMEOUT_FLOOR_MS,
): Promise<Envelope> {
  const full = ['--agent', '--non-interactive', ...(profile ? ['--profile', profile] : []), ...argv]
  try {
    const command = [await orthancBin($), ...full]
    const ran = timeoutMs > PROCESS_RUN_MAX_MS ? await runLong($, command, timeoutMs) : await $.process.run(command, { timeoutMs })
    return (
      parseEnvelope(ran.stdout) ??
      failure('orthanc-launch-error', `orthanc exited ${ran.exitCode} with no foundry-agent-v1 envelope`, argv.join(' '), {
        exit_code: ran.exitCode,
        stderr: ran.stderr.slice(0, 4000),
      })
    )
  } catch (error) {
    return failure('orthanc-launch-error', error instanceof Error ? error.message : String(error), argv.join(' '), {
      timeout_seconds: timeoutMs / 1000,
    })
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
  // The same resolution the guard classified, so what runs is what was judged.
  const resolved = resolveOrthancCommand(input.command, input.args, commands)
  const command = commands.find(entry => entry.path === resolved.path)
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
  const envelope = await runOrthanc($, [...command.path.split(' '), ...resolved.args], input.profile, cliTimeoutMs(command, resolved.args))
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

const spaceArgs = (scope: FoundryScope) => (scope.namespace ? ['--space-rid', scope.namespace.rid] : [])

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

const RULES_LIMIT = 4000

// Operator rules for the Haiku guard: ~/.claude/foundry/rules.md (the
// operator's), then the project's .claude/foundry-rules.md, which a cloned
// repository can carry and so may only make the guard stricter. They steer the
// guard only; the branch rule and the destructive rule run before it.
type OperatorRule = { path: string; text: string; isProject: boolean }
// Read once per session: an edit made mid-session (by anyone) waits for the next.
let rulesSnapshot: OperatorRule[] | undefined

async function operatorRules($: EngineInterface): Promise<OperatorRule[]> {
  if (rulesSnapshot !== undefined) return rulesSnapshot
  const home = (await $.env.get('HOME'))?.trim()
  const paths = [...(home ? [{ path: `${home}/.claude/foundry/rules.md`, isProject: false }] : []), { path: '.claude/foundry-rules.md', isProject: true }]
  const found: { path: string; text: string; isProject: boolean }[] = []
  for (const { path, isProject } of paths) {
    const text = await $.fs.read(path).then(String).catch(() => '')
    if (text.trim() !== '') found.push({ path, text: text.trim().slice(0, RULES_LIMIT), isProject })
  }
  rulesSnapshot = found
  return found
}

// The auto tier's classifier: a Haiku call.
// Anything but a clean JSON verdict is null, which the ladder turns into ask.
// Project rules can come with a cloned repository, so they only tighten: the
// guard runs with and without them and the stricter verdict stands.
async function guardVerdict(
  $: EngineInterface,
  tool: string,
  input: unknown,
  classification: GateClassification,
): Promise<GuardVerdict | null> {
  const rules = await operatorRules($)
  const operator = rules.filter(rule => !rule.isProject).map(rule => rule.text).join('\n\n')
  const project = rules.filter(rule => rule.isProject).map(rule => rule.text).join('\n\n')
  const base = await guardOnce($, tool, input, classification, operator, '')
  if (project === '' || base === null || base.action === 'deny') return base
  const withProject = await guardOnce($, tool, input, classification, operator, project)
  if (withProject === null) return null
  return GUARD_RANK[withProject.action] > GUARD_RANK[base.action] ? withProject : base
}

const GUARD_RANK = { approve: 0, ask: 1, deny: 2 } as const

async function guardOnce(
  $: EngineInterface,
  tool: string,
  input: unknown,
  classification: GateClassification,
  operator: string,
  project: string,
): Promise<GuardVerdict | null> {
  const answer = await $.model.complete({
    model: GUARD_MODEL,
    maxTokens: 200,
    timeoutMs: 15_000,
    system:
      'You review one Palantir Foundry mutation an agent wants to run. Answer only JSON: ' +
      '{"action":"approve"|"ask"|"deny","reason":"<one sentence>"}. approve: routine, reversible, ' +
      'scoped work on an agent branch. ask: unclear blast radius, shared or production resources, ' +
      'permissions, schema or ontology changes. deny: clearly destructive or targeting main/master or production.' +
      (operator === '' ? '' : `\nThe operator's rules, which take precedence over the defaults above:\n${operator}`) +
      (project === ''
        ? ''
        : `\nThe project's rules, which may only make you more cautious:\n${project}`),
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

// The session's directory; '/' where the host has none (the test kit).
async function sessionCwd($: EngineInterface): Promise<string> {
  try {
    return await $.session.cwd()
  } catch {
    return '/'
  }
}

async function homeDir($: EngineInterface): Promise<string> {
  try {
    return (await $.env.get('HOME'))?.trim() ?? ''
  } catch {
    return ''
  }
}

// Tracing: one OTLP trace per turn that touched Foundry, sent to Langfuse or
// any OTLP/HTTP collector. Config comes from the environment, else from an env
// file (~/.claude/foundry/otel.env, which Claude cannot write) sourced in a
// subprocess; keys and headers stay in the mod's memory and are never shown.
// Tracing never changes a gate outcome and never blocks a turn.
type Tracing = { config: TraceConfig; resource: Record<string, string>; redact: RegExp[]; everyTurn: boolean; source: string }
type TurnTrace = { traceId: string; rootSpanId: string; startMs: number; prompt: string; spans: SpanRecord[]; touched: boolean; dropped: number }
type GateNote = { outcome?: string; reason?: string; command?: string; foundry: boolean }
let tracing: Tracing | null = null
let literalNote = ''
let tracingNote = 'off: no OTLP endpoint or Langfuse keys configured'
let lastExport: { traceId: string; status: string; atMs: number } | null = null
const turnTraces = new Map<string, TurnTrace>()
const ENV_FILE_TIMEOUT_MS = 10_000
const MAX_SPANS = 200
const STALE_TURN_MS = 3_600_000

// Read as data (parseEnvFile), never sourced. 1Password references resolve
// through `op read` by argv, in-process; the values never reach the model.
async function traceEnvFromFile($: EngineInterface, path: string): Promise<TraceEnv | null> {
  const text = await $.fs.read(path).then(String).catch(() => null)
  if (text === null) return null
  const { env, refs, literalSecrets } = parseEnvFile(text)
  if (literalSecrets.length > 0) literalNote = ` (ignored ${literalSecrets.join(', ')}: write them as op:// references)`
  // Together, so a hung `op` costs one timeout, not one per reference.
  await Promise.all(
    Object.entries(refs).map(async ([key, ref]) => {
      const ran = await $.process.run(['op', 'read', '--no-newline', ref], { timeoutMs: ENV_FILE_TIMEOUT_MS }).catch(() => null)
      if (ran && ran.exitCode === 0 && ran.stdout.trim() !== '') env[key] = ran.stdout.trim()
    }),
  )
  return env
}

async function loadTracing($: EngineInterface, profile: string | null): Promise<void> {
  tracing = null
  literalNote = ''
  // $.env.get takes literal names, so the variables the mod reads stay listable.
  const read = (value: string | undefined) => value || undefined
  const env: TraceEnv = {
    OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: read(await $.env.get('OTEL_EXPORTER_OTLP_TRACES_ENDPOINT')),
    OTEL_EXPORTER_OTLP_ENDPOINT: read(await $.env.get('OTEL_EXPORTER_OTLP_ENDPOINT')),
    OTEL_EXPORTER_OTLP_HEADERS: read(await $.env.get('OTEL_EXPORTER_OTLP_HEADERS')),
    LANGFUSE_BASE_URL: read(await $.env.get('LANGFUSE_BASE_URL')),
    LANGFUSE_HOST: read(await $.env.get('LANGFUSE_HOST')),
    LANGFUSE_PUBLIC_KEY: read(await $.env.get('LANGFUSE_PUBLIC_KEY')),
    LANGFUSE_SECRET_KEY: read(await $.env.get('LANGFUSE_SECRET_KEY')),
    FOUNDRY_OTEL: read(await $.env.get('FOUNDRY_OTEL')),
    FOUNDRY_OTEL_TOOL_IO: read(await $.env.get('FOUNDRY_OTEL_TOOL_IO')),
    PALANTIR_AGENT_OTEL_TOOL_IO: read(await $.env.get('PALANTIR_AGENT_OTEL_TOOL_IO')),
    OTEL_SERVICE_NAME: read(await $.env.get('OTEL_SERVICE_NAME')),
    OTEL_RESOURCE_ATTRIBUTES: read(await $.env.get('OTEL_RESOURCE_ATTRIBUTES')),
    FOUNDRY_OTEL_REDACT_DOMAINS: read(await $.env.get('FOUNDRY_OTEL_REDACT_DOMAINS')),
  }
  for (const key of Object.keys(env)) if (env[key] === undefined) delete env[key]
  let source = 'environment'
  if ((env.FOUNDRY_OTEL ?? '').toLowerCase() === 'off') {
    tracingNote = 'off: FOUNDRY_OTEL=off'
    return
  }
  if (traceConfig(env) === null) {
    const home = await homeDir($)
    // Only the operator's own file: a path from the environment could come with a project.
    if (home === '') return
    const path = `${home}/.claude/foundry/otel.env`
    const fromFile = await traceEnvFromFile($, path).catch(() => null)
    if (fromFile === null) return
    Object.assign(env, fromFile)
    source = '~/.claude/foundry/otel.env'
  }
  const config = traceConfig(env)
  if (config === null) {
    tracingNote = (env.FOUNDRY_OTEL ?? '').toLowerCase() === 'off' ? 'off: FOUNDRY_OTEL=off' : `off: ${source} has no OTLP endpoint or Langfuse keys (or a key reference did not resolve)`
    return
  }
  tracing = {
    config,
    resource: resourceAttributes(env, profile),
    redact: domainPatterns(env.FOUNDRY_OTEL_REDACT_DOMAINS),
    everyTurn: (env.FOUNDRY_OTEL ?? '').toLowerCase() === 'all',
    source,
  }
  $.ui.log(`foundry: tracing to ${config.host}`, { to: 'debug' })
  tracingNote = `on: ${config.host} (from ${source}${config.toolIo ? '' : ', tool input and output off'}${tracing.everyTurn ? ', every turn' : ', Foundry turns'})`
}

function startTurn(key: string, prompt: string, nowMs: number): TurnTrace {
  for (const [stale, turn] of turnTraces) if (stale !== 'main' && nowMs - turn.startMs > STALE_TURN_MS) turnTraces.delete(stale)
  const turn = { traceId: randomHex(32), rootSpanId: randomHex(16), startMs: nowMs, prompt, spans: [], touched: false, dropped: 0 }
  turnTraces.set(key, turn)
  return turn
}

function recordTool(key: string, tool: string, input: unknown, ran: unknown, note: GateNote, startMs: number, endMs: number): void {
  if (tracing === null) return
  const turn = turnTraces.get(key) ?? startTurn(key, '', startMs)
  turn.touched ||= note.foundry
  if (turn.spans.length >= MAX_SPANS) {
    turn.dropped += 1
    return
  }
  const result = (ran ?? {}) as Record<string, unknown>
  const denied = typeof result.deny === 'string' ? result.deny : undefined
  const output = denied ?? result.text ?? result.result
  // Only Foundry calls carry their input and output; other tools in the turn are named, not shown.
  const io = tracing.config.toolIo && note.foundry
  const attributes: SpanRecord['attributes'] = {
    'langfuse.observation.type': 'tool',
    'gen_ai.tool.name': tool,
    ...(note.command ? { 'foundry.command': redactString(note.command, tracing.redact) } : {}),
    ...(note.outcome ? { 'foundry.gate.outcome': note.outcome } : {}),
    ...(note.reason ? { 'foundry.gate.reason': serializePayload(note.reason, tracing.redact) ?? '' } : {}),
  }
  const inputJson = io ? serializePayload(input, tracing.redact) : undefined
  const outputJson = io ? serializePayload(output, tracing.redact) : undefined
  if (inputJson) attributes['langfuse.observation.input'] = inputJson
  if (outputJson) attributes['langfuse.observation.output'] = outputJson
  turn.spans.push({
    spanId: randomHex(16),
    parentSpanId: turn.rootSpanId,
    name: `tool ${tool}${note.command ? ` ${redactString(note.command, tracing.redact)}` : ''}`,
    startMs,
    endMs,
    attributes,
    ...(denied ? { error: `denied: ${denied}` } : result.isError === true ? { error: 'tool error' } : {}),
  })
}

async function exportTurn($: EngineInterface, key: string, answer: string, usage: unknown, reason: string, endMs: number): Promise<void> {
  const turn = turnTraces.get(key)
  turnTraces.delete(key)
  // In FDE mode every turn is part of the engagement, so every turn is exported.
  const fde = await fdeState($).catch(() => null)
  if (tracing === null || turn === undefined || !(turn.touched || tracing.everyTurn || fde !== null)) return
  const sessionId = await $.session.id().catch(() => 'unknown')
  const redact = tracing.redact
  const root: SpanRecord = {
    spanId: turn.rootSpanId,
    name: key === 'main' ? 'claude-foundry turn' : 'claude-foundry subagent turn',
    startMs: turn.startMs,
    endMs,
    attributes: {
      'langfuse.observation.type': 'agent',
      'langfuse.trace.name': key === 'main' ? 'claude-foundry turn' : 'claude-foundry subagent turn',
      'langfuse.session.id': sessionId,
      'session.id': sessionId,
      'foundry.turn.reason': reason,
      'foundry.tool.count': turn.spans.length,
      ...(turn.dropped > 0 ? { 'foundry.spans.dropped': turn.dropped } : {}),
      ...(key === 'main' ? {} : { 'foundry.agent.id': key }),
      ...(fde ? { 'foundry.fde.branch': redactString(fde.branchRid, redact), 'foundry.fde.goal': redactString(fde.goal, redact) } : {}),
    },
    ...(reason === 'error' || reason === 'refusal' ? { error: reason } : {}),
  }
  const prompt = serializePayload(turn.prompt || undefined, redact)
  const output = serializePayload(answer || undefined, redact)
  if (prompt) root.attributes['langfuse.observation.input'] = prompt
  if (output) root.attributes['langfuse.observation.output'] = output
  const spans = [root, ...turn.spans]
  const counted = usage as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; model?: string } | undefined
  if (counted?.model) {
    spans.push({
      spanId: randomHex(16),
      parentSpanId: turn.rootSpanId,
      name: 'model',
      startMs: turn.startMs,
      endMs,
      attributes: {
        'langfuse.observation.type': 'generation',
        'gen_ai.request.model': counted.model,
        'langfuse.observation.model.name': counted.model,
        'langfuse.observation.usage_details': JSON.stringify({
          input: counted.input_tokens ?? 0,
          output: counted.output_tokens ?? 0,
          cache_read_input_tokens: counted.cache_read_input_tokens ?? 0,
          cache_creation_input_tokens: counted.cache_creation_input_tokens ?? 0,
        }),
      },
    })
  }
  const body = otlpBody(turn.traceId, tracing.resource, spans)
  const sent = { traceId: turn.traceId, status: 'sending', atMs: endMs }
  lastExport = sent
  try {
    const response = await $.http.fetch(tracing.config.url, { method: 'POST', headers: tracing.config.headers, body })
    sent.status = `HTTP ${response.status}`
  } catch (error) {
    sent.status = `failed: ${redactString(error instanceof Error ? error.message : 'fetch error').slice(0, 120)}`
  }
}

function touchesFoundry(tool: string, input: Record<string, unknown>, classified: boolean): boolean {
  if (classified || tool === ORTHANC_CLI || tool === ORTHANC_HELP) return true
  if (tool === 'Bash') return /\borthanc\b/.test(asString(input.command))
  return /^mcp__.*(palantir|foundry)/i.test(tool)
}

async function traceText($: EngineInterface): Promise<string> {
  const lines = [`Tracing ${tracingNote}${literalNote}.`]
  if (tracing === null) {
    lines.push('Set OTEL_EXPORTER_OTLP_TRACES_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS, or LANGFUSE_BASE_URL, LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY, in the environment or in ~/.claude/foundry/otel.env (KEY=value lines; keys as op:// references; read once per session).')
    return lines.join('\n')
  }
  if (lastExport === null) {
    lines.push('No Foundry turn exported yet this session.')
    return lines.join('\n')
  }
  lines.push(`Last trace ${lastExport.traceId}: ${lastExport.status}.`)
  const api = langfuseApiBase(tracing.config)
  if (api === null || !lastExport.status.startsWith('HTTP 2')) return lines.join('\n')
  const headers = Object.fromEntries(Object.entries(tracing.config.headers).filter(([name]) => name.toLowerCase() !== 'content-type'))
  const found = await $.http.fetch(`${api}/traces/${lastExport.traceId}`, { headers }).catch(() => null)
  if (found?.ok) {
    let count = '?'
    try {
      const parsed = JSON.parse(found.text) as { observations?: unknown[] }
      count = String(parsed.observations?.length ?? '?')
    } catch {}
    lines.push(`Langfuse has it: ${count} observations.`)
  } else {
    lines.push(`Langfuse lookup: ${found ? `HTTP ${found.status}` : 'failed'} (ingestion can take a few seconds; run /trace again).`)
  }
  return lines.join('\n')
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

// `notRun` is a failure Orthanc refused before reaching Foundry (a usage error);
// any other failure may have changed something.
async function serveTool($: EngineInterface, tool: string, input: Record<string, unknown>): Promise<{ out: EventResult<'tool.call'>; failed: boolean; notRun: boolean }> {
  if (tool === ORTHANC_HELP) {
    return { failed: false, notRun: false, out: {
      result: await renderHelp($, {
        group: asString(input.group).trim() || undefined,
        command: asString(input.command).trim() || undefined,
        query: asString(input.query).trim() || undefined,
      }),
    } }
  }
  const scope = await currentScope($)
  const envelope = await executeCli($, {
    command: normalizeCommand(asString(input.command)),
    args: Array.isArray(input.args) ? input.args.map(String) : [],
    profile: profileArg(scope),
  })
  const failed = isErrorEnvelope(envelope)
  return { failed, notRun: failed && isUsageError(envelope), out: { result: serialize(envelope, await spill($, input.command, envelope)), ...(failed ? { context: ['The Orthanc call returned errors; read them before retrying.'] } : {}) } }
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

// ---------- /fde ----------

async function fdeState($: EngineInterface): Promise<FdeSession | null> {
  return (await $.state.get(FDE)).value ?? null
}

// The session's binding, mirrored to the store so the next session can offer /fde resume.
async function setFde($: EngineInterface, fde: FdeSession | null): Promise<void> {
  await $.state.set(FDE, fde)
  await $.state.set(BRANCH, fde?.branchRid ?? null)
  await $.store.set('fdeOpen', fde)
}

async function fdeFromEarlier($: EngineInterface): Promise<FdeSession | null> {
  const stored = await $.store.get('fdeOpen').catch(() => null)
  return typeof stored === 'object' && stored !== null && typeof (stored as FdeSession).branchRid === 'string' ? (stored as FdeSession) : null
}

/**
 * The global branch's name when it is an OPEN agent/ branch of the ontology.
 * Otherwise a reason, with `transient` set when the lookup failed rather than
 * the branch being unfit, so a resume can keep the binding and try again.
 */
async function openBranch($: EngineInterface, rid: string, profile: string, ontologyRid: string): Promise<{ name: string } | { reason: string; transient: boolean }> {
  const envelope = await runOrthanc($, ['global-branch', 'get', rid], profile, 60_000)
  if (isErrorEnvelope(envelope)) return { reason: `global-branch get ${rid} failed: ${errorsOf(envelope)}`, transient: true }
  const fit = adoptable(envelope.data, ontologyRid)
  return typeof fit === 'string' ? { reason: fit, transient: false } : fit
}

// FDE mode: pin the call to the session's branch and hold each --apply to its
// dry run. It only adds checks; the branch rule and the ladder still judge the
// bound call. Returns the bound input and its plan, or why it is refused.
const MAX_PINNED_FILE = 20_000_000
type FdePlan = { signature: string; isApply: boolean; command: string; files: string[] }

async function filesSignature(
  $: EngineInterface,
  fde: FdeSession,
  command: string,
  args: string[],
  files: { required: string[]; optional: string[] },
): Promise<string | { deny: string }> {
  const hashes: Record<string, string> = {}
  for (const file of [...files.required, ...files.optional]) {
    // Only regular files are read, and only up to a size, so a device or FIFO
    // argument cannot hang the gate.
    const stat = await $.fs.stat(file).catch(() => null)
    if (stat !== null && stat.kind === 'file' && stat.size > MAX_PINNED_FILE) {
      return { deny: `FDE mode: ${file} is over ${MAX_PINNED_FILE / 1_000_000} MB, too large to check against its dry run, so the call was not run.` }
    }
    const text = stat?.kind === 'file' ? await $.fs.read(file).then(String).catch(() => null) : null
    if (text === null && files.required.includes(file)) return { deny: `FDE mode: could not read ${file} to check it against its dry run, so the call was not run.` }
    if (text === null) continue
    const foreign = foreignRids(fde, text)
    if (foreign) return { deny: `FDE mode: ${foreign}` }
    hashes[file] = await contentHash(text)
  }
  return planSignature(command, args, hashes)
}

async function fdeGate(
  $: EngineInterface,
  fde: FdeSession,
  input: Record<string, unknown>,
  manifest: readonly ManifestCommand[],
): Promise<{ deny: string } | { input: Record<string, unknown>; plan: FdePlan | null }> {
  const resolved = resolveOrthancCommand(asString(input.command), Array.isArray(input.args) ? input.args.map(String) : [], manifest)
  const isMutation = resolved.path !== '' && resolved.path !== 'repository clone' && classifyOrthancCommand(resolved.path, manifest) === 'mutation'
  const bound = fdeBind(fde, resolved.path, resolved.args, (await currentScope($)).profile, isMutation)
  if ('deny' in bound) return bound
  const next = { ...input, command: resolved.path, args: bound.args }
  if (!isMutation) return { input: next, plan: null }
  const files = fileCandidates(bound.args, await sessionCwd($), await homeDir($))
  const signature = await filesSignature($, fde, resolved.path, bound.args, files)
  if (typeof signature !== 'string') return signature
  const isApply = hasApply(bound.args)
  const gated = planGate(fde, signature, isApply)
  if (gated) return { deny: gated }
  return { input: next, plan: { signature, isApply, command: resolved.path, files: [...files.required, ...files.optional] } }
}

async function fdeCommand($: EngineInterface, args: string): Promise<string> {
  const parsed = parseFdeArgs(args)
  const active = await fdeState($)
  const earlier = active ? null : await fdeFromEarlier($)
  if (parsed.kind === 'error') return parsed.reason
  if (parsed.kind === 'status') {
    if (active) return fdeStatus(active)
    return [
      'FDE mode is off. /fde on (or /fde <goal>) creates an agent global branch on the selected ontology and binds this session to it; /fde --branch <rid> [goal] adopts an open one.',
      ...(earlier ? [`An earlier session left ${earlier.branchName} (${goalLabel(earlier.goal)}) bound: /fde resume rebinds it, /fde end hands it off.`] : []),
    ].join('\n')
  }
  if (parsed.kind === 'end') {
    const ending = active ?? earlier
    if (ending === null) return 'FDE mode is off.'
    await setFde($, null)
    const history = await $.store.get('fdeHandoffs').catch(() => null)
    await $.store.set('fdeHandoffs', [...(Array.isArray(history) ? history : []), { ...ending, endedAt: new Date().toISOString() }].slice(-10))
    return fdeHandoff(ending)
  }
  if (parsed.kind === 'goal') {
    if (!active) return 'FDE mode is off, so there is no goal to set. /fde on starts it.'
    const next = { ...active, goal: parsed.goal }
    await setFde($, next)
    return `Goal set.\n${fdeStatus(next)}`
  }
  if (parsed.kind === 'resume') {
    if (active) return fdeStatus(active)
    if (earlier === null) return 'No FDE branch to resume. /fde on starts one.'
    const open = await openBranch($, earlier.branchRid, earlier.profile, earlier.ontologyRid)
    if ('reason' in open) {
      if (open.transient) return `${open.reason} Not resumed; the earlier binding is kept, so /fde resume can try again.`
      await $.store.set('fdeOpen', null)
      return `${open.reason} Not resumed; the earlier binding is forgotten.`
    }
    await setFde($, earlier)
    return `Resumed.\n${fdeStatus(earlier)}`
  }
  if (active) return `Already in FDE mode:\n${fdeStatus(active)}\n/fde end first.`
  const scope = await currentScope($)
  if (scope.profile === 'unknown') return 'No Foundry stack is active. Run /profile first.'
  if (scope.ontology === null) return 'Choose the ontology first (/ontology): the branch is made on it.'
  let branchRid: string
  let branchName: string
  if (parsed.kind === 'start') {
    branchName = fdeBranchName(parsed.goal, new Date())
    const envelope = await runOrthanc($, branchCreateArgs(branchName, scope.ontology.rid, parsed.goal), scope.profile, 120_000)
    const rid = branchRidFrom(envelope)
    if (rid === null) return `global-branch create ${branchName} failed, so FDE mode stays off: ${errorsOf(envelope)}`
    branchRid = rid
  } else {
    const open = await openBranch($, parsed.rid, scope.profile, scope.ontology.rid)
    if ('reason' in open) return `${open.reason} FDE mode stays off.`
    branchRid = parsed.rid
    branchName = open.name
  }
  const fde: FdeSession = {
    goal: parsed.goal,
    profile: scope.profile,
    ontologyRid: scope.ontology.rid,
    branchRid,
    branchName,
    startedAt: new Date().toISOString(),
    plans: [],
    applied: [],
  }
  await setFde($, fde)
  return `${fdeStatus(fde)}\nOntology writes in this session now go to this branch only, and each --apply needs its dry run first.`
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
    const projects = await runOrthanc($, ['project', 'list', ...spaceArgs(scope)], scope.profile, 120_000)
    if (isErrorEnvelope(projects)) return `project list failed: ${errorsOf(projects)}`
    roots = listItems(projects, 'projects').map(entry => asString(entry.rid)).filter(Boolean)
  }
  if (roots.length === 0) return `No projects are visible ${scope.namespace ? `in ${scope.namespace.name}` : 'on this stack'}. No selection was saved.`
  const search = kind === 'folders' && !query.trim() ? 'ri.compass.main.folder.' : query
  const envelopes = await inBatches(roots, ROOT_CONCURRENCY, root =>
    runOrthanc($, resourceArgs(search, def.typeId, root), scope.profile, 180_000),
  )
  const failed = envelopes.filter(isErrorEnvelope)
  if (failed.length === envelopes.length && failed[0]) return `resource listing failed: ${errorsOf(failed[0])}`
  const rows = resourceRows(envelopes.flatMap(envelope => rowsOf(envelope, ['resources'])))
  return {
    title: `${def.label}${scope.projects.length > 0 ? ' in selected projects' : scope.namespace ? ` in ${scope.namespace.name}` : ''}`,
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
  if (kind === 'namespace') {
    const envelope = await runOrthanc($, ['space', 'list'], scope.profile, 60_000)
    if (isErrorEnvelope(envelope)) return `space list failed: ${errorsOf(envelope)}`
    const rows = listItems(envelope, 'spaces')
      .map(entry => ({
        key: asString(entry.rid),
        label: asString(entry.display_name) || asString(entry.path),
        hint: asString(entry.path),
      }))
      .filter(entry => entry.key !== '')
    if (rows.length === 0) return 'No namespaces are visible on this stack. No selection was saved.'
    return {
      title: 'Namespace',
      isMulti: false,
      items: [{ key: '', label: 'All namespaces', hint: 'no namespace in scope' }, ...rows],
    }
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
    const envelope = await runOrthanc($, ['project', 'list', ...spaceArgs(scope)], scope.profile, 120_000)
    if (isErrorEnvelope(envelope)) return `project list failed: ${errorsOf(envelope)}`
    return {
      title: scope.namespace ? `Projects in ${scope.namespace.name}` : 'Projects',
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
  if (picker.kind === 'namespace') {
    const pick = chosen[0]
    if (pick === undefined) return 'No namespace selected.'
    if (pick.key === '') {
      await saveScope($, namespaceChanged(scope, null))
      return 'All namespaces: no namespace in scope.'
    }
    const next = namespaceChanged(scope, { rid: pick.key, name: pick.label, path: pick.hint })
    await saveScope($, next)
    const dropped = next.projects.length !== scope.projects.length || JSON.stringify(next.resources) !== JSON.stringify(scope.resources)
    return `Namespace: ${pick.label}.${dropped ? ' Projects and Compass resources picked before were cleared.' : ''}`
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
    if (kind === 'namespace') await saveScope($, namespaceChanged(scope, null))
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
    const argv = scope.namespace?.path
      ? ['search', query, '--path-prefix', scope.namespace.path, '--page-size', '100']
      : ['search', query, '--limit', '100']
    const envelope = await runOrthanc($, argv, scope.profile, 60_000)
    if (isErrorEnvelope(envelope)) return `search failed: ${errorsOf(envelope)}`
    return source(`Resources matching '${query}'${scope.namespace ? ` in ${scope.namespace.name}` : ''}`, resourceRows(rowsOf(envelope, ['results'])))
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
    fix: 'install Orthanc in your terminal, then run /onboard again:\n  curl -fsSL https://github.com/zaycruz/orthanc/releases/latest/download/install.sh | sh\n  orthanc onboarding\n(or set ORTHANC_BIN to an orthanc you already have)',
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
  checks.push({ label: 'context', ok: hasFocus(scope), detail: hasFocus(scope) ? 'ontology, namespace or projects selected' : 'nothing selected', fix: '/open' })
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
  if (nodes.length === 0) lines.push('  nothing selected: /open sets the stack, ontology, namespace and projects')
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
      if (scope.profile === 'unknown') return runPicker($, 'profile', '', { chain: ['ontology', 'namespace', 'project'] })
      return runPicker($, 'ontology', '', { chain: ['namespace', 'project'] })
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
      if (wanted === '') return `Foundry approval mode: ${await approvalMode($)}. Modes: ${APPROVAL_MODES.join(', ')}. /approval rules shows the guard's operator rules.`
      if (wanted === 'rules') {
        const rules = await operatorRules($)
        return rules.length === 0
          ? 'No operator rules. Write them in ~/.claude/foundry/rules.md (yours) or .claude/foundry-rules.md (this project, stricter only), one per line; the auto-mode guard follows them. The branch rule always applies first.'
          : rules.map(rule => `${rule.path}${rule.isProject ? ' (project: may only make the guard stricter)' : ''}:\n${rule.text}`).join('\n\n')
      }
      const mode = parseApprovalMode(wanted)
      if (mode === null) return `Unknown mode '${wanted}'. Modes: ${APPROVAL_MODES.join(', ')}.`
      await $.store.set('approvalMode', mode)
      return `Foundry approval mode: ${mode}.`
    }
    case 'trace':
      return traceText($)
    case 'fde':
      return fdeCommand($, args)
    case 'foundry': {
      const opened = await $.ui.open({ id: CONTEXT_PANE, title: 'Foundry context', focus: true, closeOnEscape: true })
      return opened.isPlaced ? 'Foundry context is open (Esc closes it).' : await treeText($)
    }
  }
}

// The guard, then the tools this mod serves: compass check → rules files →
// git push → ladder → loop guard → serve. `note` records the gate's outcome for tracing.
async function guardedCall($: EngineInterface, e: Args<'tool.call'>, next: Next<'tool.call'>, note: GateNote): Promise<EventResult<'tool.call'>> {
  const tool = String(e.tool)
  const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, consent: _consent, ...raw } =
    e as unknown as Record<string, unknown>
  let input: Record<string, unknown> = raw
  note.foundry = touchesFoundry(tool, input, false)
  note.outcome = 'block'
  const rootReason = compassRootReason(tool, input)
  if (rootReason) return { deny: rootReason }
  const rulesReason = rulesWriteReason(tool, input, await sessionCwd($), await homeDir($))
  if (rulesReason) return { deny: rulesReason }
  if (tool === 'Bash' && typeof input.command === 'string') {
    if (gitPushNamesFoundry(input.command)) return { deny: FOUNDRY_GIT_PUSH_REASON }
    const directories = gitPushDirectories(input.command)
    const home = (await $.env.get('HOME'))?.trim() ?? ''
    for (const pushed of directories ?? []) {
      const directory = pushed.replace(/^~(?=\/|$)/, home)
      // Read the remotes in-process only; they can carry a token and are never shown.
      // A directory that is not a repository cannot push; a check that cannot run denies.
      const remotes = await $.process
        .run(['git', ...(directory ? ['-C', directory] : []), 'remote', '-v'], { timeoutMs: 10_000 })
        .catch(() => null)
      if (remotes === null) return { deny: `foundry: could not check whether ${pushed || 'this directory'} is a Foundry repository, so the push was not run.` }
      if (remotes.stdout.includes('ri.stemma.')) return { deny: FOUNDRY_GIT_PUSH_REASON }
    }
  }

  const manifest = tool === ORTHANC_CLI || tool === 'Bash' ? await loadManifest($).catch(() => []) : []
  const fde = tool === ORTHANC_CLI ? await fdeState($) : null
  let plan: FdePlan | null = null
  if (fde !== null) {
    const gated = await fdeGate($, fde, input, manifest)
    if ('deny' in gated) return gated
    input = gated.input
    plan = gated.plan
  }
  // An apply takes its dry run now, in one step, so a parallel twin finds it gone.
  // If the call then does not run, or fails, the plan is put back.
  if (plan?.isApply) {
    const signature = plan.signature
    let taken = false
    await update($, fdeAtom, current => {
      if (current === null) return current
      const took = takePlan(current, signature)
      taken = took.taken
      return took.fde
    })
    if (!taken) return { deny: planGate({ ...fde!, plans: [] }, signature, true)! }
  }
  let executed = false
  let failed = false
  let notRun = false
  try {
  const branch = (await $.state.get(BRANCH)).value ?? null
  const classification = classifyCall(tool, input, manifest, branch)
  note.outcome = undefined
  if (classification) {
    note.foundry = true
    note.command = classification.command ?? undefined
    const mode = await approvalMode($)
    const verdict =
      mode === 'auto' && classification.kind === 'mutation'
        ? await guardVerdict($, tool, input, classification).catch(() => null)
        : undefined
    const decision = ladderDecision(mode, classification, verdict)
    $.ui.log(`foundry: ${tool} ${classification.command ?? ''} → ${decision.outcome}: ${decision.reason}`, { to: 'debug' })
    note.outcome = decision.outcome
    note.reason = decision.reason
    if (decision.outcome === 'block') return { deny: decision.reason }
    if (decision.outcome === 'ask' && !(await askOperator($, decision.reason))) {
      return { deny: `Operator declined or no one could be asked: ${decision.reason}` }
    }
  }

  const looped = loopStep(loop, tool, input)
  loop = looped.next
  if (looped.reason) {
    note.outcome = 'block'
    return { deny: looped.reason }
  }

  // The ladder may have waited on the operator: the files the call reads must still be the planned ones.
  if (plan !== null && plan.files.length > 0) {
    const args = Array.isArray(input.args) ? input.args.map(String) : []
    const now = await filesSignature($, fde!, plan.command, args, fileCandidates(args, await sessionCwd($), await homeDir($)))
    if (now !== plan.signature) return { deny: 'FDE mode: a file this call reads changed after it was checked, so the call was not run. Dry-run it again.' }
  }
  executed = true
  const ran = tool === ORTHANC_CLI || tool === ORTHANC_HELP ? await serveTool($, tool, input).then(served => ((failed = served.failed), (notRun = served.notRun), served.out)) : await next(e)
  if (plan !== null && !failed) {
    const done = plan
    let latest: FdeSession | null = null
    await update($, fdeAtom, current => (latest = current === null ? null : done.isApply ? recordApply(current, done.command, done.signature, new Date()) : recordPlan(current, done.signature)))
    if (latest !== null) await $.store.set('fdeOpen', latest)
  }
  if (classification?.kind === 'branch-creation' && classification.command === 'global-branch create') {
    const text = typeof ran.result === 'string' ? ran.result : ''
    const rid = /ri\.branch\.[^"\s,}]+/.exec(text)?.[0]
    if (text !== '' && !text.includes('"errors": [\n')) await $.state.set(BRANCH, rid ?? classification.proposedName ?? null)
  }
  return ran
  } finally {
    if (plan?.isApply && (!executed || notRun)) {
      const signature = plan.signature
      await update($, fdeAtom, current => (current === null ? null : recordPlan(current, signature))).catch(() => undefined)
    }
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    rulesSnapshot = undefined
    await operatorRules($)
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
    turnTraces.clear()
    lastExport = null
    const startScope = await currentScope($).catch(() => null)
    await loadTracing($, startScope ? (profileArg(startScope) ?? null) : null).catch(() => {
      tracing = null
      tracingNote = 'off: tracing setup failed'
    })
    void loadManifest($).catch(() => undefined)
    const earlier = (await fdeState($)) === null ? await fdeFromEarlier($).catch(() => null) : null
    if (earlier) $.ui.toast(`FDE branch ${earlier.branchName} (${goalLabel(earlier.goal)}) is still open from an earlier session: /fde resume or /fde end`)
    return started
  })

  // Subagents do not get the session's prompt sections: hand the Foundry block
  // to the mod's own agents as context when they start.
  on('classic.SubagentStart', async ($, e, next) => {
    const started = await next(e)
    if (!e.agent_type.startsWith('foundry:')) return started
    const text = contextText(await currentScope($), await approvalMode($))
    const fde = await fdeState($)
    return { ...started, additionalContext: [...(started.additionalContext ?? []), text, ...(fde ? [fdeContext(fde)] : [])] }
  }).catch(($, e, next) => next(e))

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    const text = contextText(await currentScope($), await approvalMode($))
    const fde = await fdeState($)
    return {
      sections: [
        ...composed.sections,
        { id: 'foundry:context', text, scope: 'session' },
        ...(fde ? [{ id: 'foundry:fde', text: fdeContext(fde), scope: 'session' as const }] : []),
      ],
    }
  })

  on('tool.call', async ($, e, next) => {
    const note: GateNote = { foundry: false }
    const startMs = Date.now()
    const ran = await guardedCall($, e, next, note)
    try {
      const { tool: _tool, tool_use_id: _id, agentId, requestMeta: _meta, consent: _consent, ...input } = e as unknown as Record<string, unknown>
      recordTool(typeof agentId === 'string' ? agentId : 'main', String(e.tool), input, ran, note, startMs, Date.now())
    } catch {
      // Tracing never changes what the call did.
    }
    return ran
  }).catch(($, e, next) => (next.called ? next(e) : { deny: 'foundry: the Foundry guard failed; the call was not run.' }))

  on('turn.start', async ($, e, next) => {
    if (tracing !== null) startTurn('main', e.text, Date.now())
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const completed = await next(e)
    if (tracing !== null) void exportTurn($, e.agentId ?? 'main', e.answer, completed.usage ?? e.usage, e.reason, Date.now()).catch(() => undefined)
    return completed
  })

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

  // FDE mode band: the goal and branch stay in view while the session is bound.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const fde = await read($, fdeAtom)
    if (fde === null || e.props.hasSurvey) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text color="yellow" bold>
          FDE
        </Text>
        <Text dimColor>{` ${goalLabel(fde.goal)} · ${fde.branchName} · ${fde.applied.length} applied · ${fde.plans.length} planned · /fde end hands off`}</Text>
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
        {nodes.length === 0 && <Text dimColor>Nothing selected. /open sets the stack, ontology, namespace and projects.</Text>}
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
