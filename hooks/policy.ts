// The approval ladder, the branch gate and the approval modes. Pure functions:
// no `$`, so the test kit and the hooks share them. Read/mutation comes from
// orthanc's own agent-manifest `kind`.

/** One option of a manifest command, as Orthanc's agent-manifest lists it. */
export type ManifestFlag = { flag: string; takesValue: boolean; default?: string }
export type ManifestCommand = {
  path: string
  kind?: string
  auth?: string
  input?: string
  flags?: ManifestFlag[]
  /** The entry's raw `operator_approval`, unread: operatorApprovalQuestion reads it, failing closed. */
  operatorApproval?: unknown
  /** The entry's raw `operator_approval_scope` (orthanc #118), unread: approvalOnWorkBranch reads it, failing closed. */
  operatorApprovalScope?: unknown
}

export const APPROVAL_MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
export type ApprovalMode = (typeof APPROVAL_MODES)[number]
export const DEFAULT_APPROVAL_MODE: ApprovalMode = 'auto'

export function parseApprovalMode(value: string): ApprovalMode | null {
  const normalized = value.trim().toLowerCase()
  return APPROVAL_MODES.find(mode => mode === normalized) ?? null
}

export const ORTHANC_CLI = 'mcp__foundry__orthanc_cli'
export const ORTHANC_HELP = 'mcp__foundry__orthanc_help'

const PROTECTED_BRANCHES = ['main', 'master']
const BRANCH_CREATION_PATHS = ['global-branch create', 'dataset branches create']
// The branch rule: agent work happens on branches, never on a production main.
// Each of these writes must name a non-protected --branch; ontology writes must
// name a global branch RID, the one branch shape that is provably not main.
const BRANCH_REQUIRED_PATHS = new Set([
  'compute manage',
  'compute execute',
  'dataset files upload',
  'dataset files delete',
  'dataset schema set',
  'dataset schema apply',
  'dataset schema update',
  'dataset transactions start',
  'ontology action-apply',
  'ontology object-type-create',
  'ontology object-type-upsert',
  'ontology object-type-guarded-upsert',
  'ontology object-type-add-property',
  'ontology object-type-delete',
  'ontology object-type-guarded-delete',
  'ontology link-type-create',
  'ontology link-type-upsert',
  'ontology link-type-delete',
  'ontology action-type-upsert',
  'ontology action-type-update',
  'ontology action-type-set-function-version',
  'ontology action-type-delete',
  'streams dataset create',
  'streams stream create',
  'streams stream publish',
  'streams stream publish-batch',
  'streams stream reset',
  'orchestration builds create',
  'cp',
  // Imports whose output branch defaults to master.
  'connectivity import create-file',
  'connectivity import create-table',
  'repository imports add',
  'repository imports remove',
  // Optional --branch that lands on main or master when it is left out.
  'dataset create-from-csv',
  'workshop module update',
  'automate update',
  'automate pause',
  'automate resume',
  'pipeline sandbox create',
  'pipeline sandbox archive',
  'pipeline edit',
  'pipeline publish',
  'pipeline deploy',
])
export const requiresBranch = (path: string) => BRANCH_REQUIRED_PATHS.has(path)
// Ontology writes Orthanc cannot branch: they change live data on main.
const MAIN_ONLY_WRITES = new Set(['ontology object-upsert', 'ontology object-upsert-batch', 'ontology action-apply-with-overrides'])
// Writes that change main and take no branch: each is a write on main, so it
// asks the operator in every mode, yolo too.
const MAIN_WRITES = new Set(['workshop module publish'])
// Writes that name their branch as a positional. Any positional naming main
// counts (a flag the guard does not know can shift the positions), so these
// ask for main in every mode; over-reading only asks more.
const POSITIONAL_BRANCH_WRITES = new Set([
  'dataset branches delete',
  'repository branch delete',
  'repository checks required set',
  'repository checks required remove',
  'branch-protection repo protect',
  'branch-protection repo policy set',
  'branch-protection repo unprotect',
])
// Promotion into main is the operator's decision, not the agent's. A release
// tag is not here: it asks the operator outside yolo (see releaseTagCall).
const PROMOTIONS = new Set(['proposal merge', 'proposal accept', 'proposal approve', 'global-branch deploy', 'repository pull-request merge'])
export const BRANCH_FLAGS = ['--branch', '-b']
const BRANCH_VALUE = /^[A-Za-z0-9._/-]+$/
// Orthanc flags that take no value, so the word after one is a positional.
const BOOLEAN_FLAGS = new Set([
  '--agent', '--apply', '--allow-default-branch', '--non-interactive', '--dry-run', '--force',
  '--recursive', '-r', '--schema', '--fail-fast', '--debug', '--help', '-h',
])
const GLOBAL_BRANCH_RID = 'ri.branch.'
const GLOBAL_BRANCH_PREFIX = 'agent/'
const DATASET_BRANCH_PREFIX = 'agent-'
const BRANCH_NAME_MAX_LEN = 64
const READ_VERBS = new Set([
  'get', 'list', 'search', 'describe', 'check', 'health', 'inspect',
  'preview', 'query', 'read', 'view', 'help', 'export', 'status', 'download',
])
export const DENIED_COMMANDS = new Set(['auth store', 'onboarding'])
// Orthanc's global stack flag; it takes no abbreviation (`--prof` is a usage error).
const PROFILE_FLAG = /^--profile(=|$)/
// Local commands that change which stack orthanc runs on when none is named.
const STACK_COMMANDS = new Set(['configure use', 'configure set-default'])
// Orthanc `local` commands that only read local state.
const LOCAL_READS = new Set([
  'version', 'hello', 'agent-manifest', 'capabilities', 'completion show',
  'configure list', 'alias list', 'alias show', 'alias resolve', 'alias export',
  'ai-fde tools list', 'smoke schedule',
])

export type GateClassification = {
  command: string | null
  kind: 'mutation' | 'branch-creation'
  isBranchScoped: boolean
  hasWorkingBranch: boolean
  targetsProtected: boolean
  isDestructive: boolean
  proposedName?: string
  /** The question to put to the operator for a release tag apply. */
  release?: string
  /** True when the tag is linked to one global branch RID: yolo skips the release ask. */
  releaseOnWorkBranch?: true
  /** The question to put to the operator for a write the manifest marks operator_approval. */
  operatorApproval?: string
  /** True when operator_approval_scope proves the write lands on one global work branch: yolo skips the ask. */
  operatorApprovalOnWorkBranch?: true
  error?: string
}

export type LadderDecision = { outcome: 'run' | 'ask' | 'block'; reason: string }

export type GuardVerdict = { action: 'approve' | 'ask' | 'deny'; reason: string }

const lastWord = (text: string) => text.split(/\s+/).at(-1) ?? ''

export function classifyOrthancCommand(
  command: string,
  manifest: readonly ManifestCommand[],
): 'read' | 'mutation' {
  const normalized = command.trim().toLowerCase()
  const declared = manifest.find(entry => entry.path === normalized)
  if (declared?.kind === 'read-only') return 'read'
  if (declared?.kind === 'local' && LOCAL_READS.has(normalized)) return 'read'
  if (declared === undefined && READ_VERBS.has(lastWord(normalized))) return 'read'
  return 'mutation'
}

function isDestructiveCommand(command: string): boolean {
  return lastWord(command.trim().toLowerCase()).split('-').at(-1) === 'delete'
}

/** True when any arg names one of these flags, in any case, with or without a
 * `=value` (`--force`, `--APPLY`, `--apply=true`). Over-matching only asks more. */
function argsNameFlag(args: readonly string[], names: readonly string[]): boolean {
  return args.some(arg => {
    const flag = unquote(arg).trim().toLowerCase().replace(/=.*$/, '')
    return names.includes(flag)
  })
}

// The local commands where -f is --force. Elsewhere -f is --format or --folder.
const SHORT_FORCE = new Set(['configure', 'configure profile create', 'configure delete', 'alias add', 'onboarding'])

function argsHaveForce(command: string, args: readonly string[]): boolean {
  return argsNameFlag(args, SHORT_FORCE.has(command) ? ['--force', '-f'] : ['--force'])
}

// A flag as the manifest may list it in when_all_flags.
const APPROVAL_FLAG = /^--?[a-z0-9][a-z0-9-]*$/i
const QUESTION_ARGS_MAX = 600

/** The every-mode question for a call whose manifest entry carries
 * `operator_approval`, or null. `{when_all_flags: [...]}` asks when every
 * listed flag is given (argsNameFlag: any case, `=value`, any order);
 * `"always"` asks on every call. Anything else is unreadable and asks on every
 * call: a condition the guard cannot read never lets a call through. */
/** `{when_all_flags: [flags]}`, nothing else. ("always" is handled before.) */
function approvalReadable(value: unknown): boolean {
  if (value === 'always') return true
  const condition = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const flags = condition?.when_all_flags
  return (
    condition !== null &&
    Object.keys(condition).length === 1 &&
    Array.isArray(flags) &&
    flags.length > 0 &&
    flags.every(flag => typeof flag === 'string' && APPROVAL_FLAG.test(flag))
  )
}

export function operatorApprovalQuestion(
  path: string,
  args: readonly string[],
  manifest: readonly ManifestCommand[],
): string | null {
  const entry = manifest.find(found => found.path === path)
  if (entry === undefined || entry.operatorApproval === undefined) return null
  const value = entry.operatorApproval
  // JSON escapes newlines and quotes, so an arg cannot forge lines in the question.
  const shown = JSON.stringify(args)
  const cut = shown.length > QUESTION_ARGS_MAX ? `${shown.slice(0, QUESTION_ARGS_MAX)}… (${shown.length - QUESTION_ARGS_MAX} more characters)` : shown
  const ask = (why: string) => `'${path}' ${cut} weakens a governance control: ${why} The operator approves it.`
  if (value === 'always') return ask("Orthanc's agent manifest marks it operator_approval.")
  if (!approvalReadable(value)) {
    return ask("Orthanc's agent manifest marks it operator_approval in a form the Foundry guard cannot read, so it asks on every call.")
  }
  const listed = ((value as Record<string, unknown>).when_all_flags as string[]).map(flag => flag.toLowerCase())
  if (!listed.every(flag => argsNameFlag(args, [flag]))) return null
  return ask(`Orthanc's agent manifest marks it operator_approval when ${listed.join(' ')} are given.`)
}

// A global branch RID, exactly. Main is not a global branch (orthanc CONTRACTS.md, SRC-15).
const WORK_BRANCH_RID = /^ri\.branch\.\.branch\.[A-Za-z0-9-]+$/
const SCOPE_FLAG = /^--[a-z0-9][a-z0-9-]*$/

/** True only when `names` are given exactly once in all, spelled exactly
 * (`--flag v` or `--flag=v`, no quotes, no other case), with a global branch
 * RID as the value, and no `-b` and no other branch flag names anything else.
 * Anything the reader is not sure of is false: the call then asks. */
function oneWorkBranchFlag(args: readonly string[], names: readonly string[]): boolean {
  const values: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? ''
    const lower = arg.toLowerCase()
    const name = names.find(found => arg === found || arg.startsWith(`${found}=`))
    if (name !== undefined) {
      if (arg === name) {
        values.push(args[index + 1] ?? '')
        index += 1
      } else values.push(arg.slice(name.length + 1))
      continue
    }
    // Another case of a listed flag, or a branch flag the scope does not list.
    if (names.some(found => lower === found || lower.startsWith(`${found}=`))) return false
    if (BRANCH_FLAGS.some(flag => lower === flag || lower.startsWith(`${flag}=`)) || /^-b./i.test(arg)) return false
  }
  return values.length === 1 && WORK_BRANCH_RID.test(values[0]!)
}

/** True only when the entry's operator_approval_scope (orthanc #118) shows
 * that this call lands on one global work branch, never on main:
 * `"work-branch"` with a global branch RID among the positionals and nothing
 * naming main, or `{work_branch_flag, flag_aliases?}` with that flag (or an
 * alias) holding one global branch RID. A missing or unreadable scope, or an
 * unreadable operator_approval, is false: yolo then asks. */
export function approvalOnWorkBranch(path: string, args: readonly string[], manifest: readonly ManifestCommand[]): boolean {
  const entry = manifest.find(found => found.path === path)
  if (entry === undefined || !approvalReadable(entry.operatorApproval)) return false
  const scope = entry.operatorApprovalScope
  if (scope === 'work-branch') {
    // Every word that is not a flag counts, whatever flag comes before it: the
    // guard does not know which flags take a value (`--yes main`).
    const words = args.filter(arg => !unquote(arg).startsWith('-'))
    return (
      words.some(arg => WORK_BRANCH_RID.test(arg)) &&
      !words.some(arg => isProtectedValue(unquote(arg))) &&
      !flagValues(args.map(arg => arg.toLowerCase()), BRANCH_FLAGS).some(isProtectedValue)
    )
  }
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) return false
  const record = scope as Record<string, unknown>
  if (!Object.keys(record).every(key => key === 'work_branch_flag' || key === 'flag_aliases')) return false
  const flag = record.work_branch_flag
  const aliases = record.flag_aliases ?? []
  if (typeof flag !== 'string' || !SCOPE_FLAG.test(flag)) return false
  if (!Array.isArray(aliases) || !aliases.every(alias => typeof alias === 'string' && SCOPE_FLAG.test(alias))) return false
  return oneWorkBranchFlag(args, [flag, ...(aliases as string[])])
}

// `main`, `refs/heads/main`, `+refs/heads/main`, `:main`, `./main/` all name main.
const branchCore = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^[+:]+|:+$/g, '')
    .replace(/\/{2,}/g, '/')
    .replace(/^(\.\/)+/, '')
    .replace(/^(refs\/)?heads\//, '')
    .replace(/[/.]+$/, '')
const isProtectedValue = (value: string) => PROTECTED_BRANCHES.includes(branchCore(value)) || branchCore(value) === 'head'

export function branchIsWorking(branch: string | null | undefined): boolean {
  return typeof branch === 'string' && branch.trim() !== '' && !isProtectedValue(branch)
}

export function validateBranchName(
  path: string,
  name: string,
): { ok: true; name: string } | { ok: false; reason: string } {
  const trimmed = name.trim()
  if (trimmed.length > BRANCH_NAME_MAX_LEN) {
    return { ok: false, reason: `branch name exceeds ${BRANCH_NAME_MAX_LEN} characters` }
  }
  const prefix = path === 'global-branch create' ? GLOBAL_BRANCH_PREFIX : DATASET_BRANCH_PREFIX
  if (!trimmed.startsWith(prefix)) {
    const kind = prefix === GLOBAL_BRANCH_PREFIX ? 'global' : 'dataset'
    return {
      ok: false,
      reason: `${kind} branch name must start with '${prefix}', e.g. '${prefix}foundry-fix-12'`,
    }
  }
  const body = trimmed.slice(prefix.length)
  const isKebab = body !== '' && body.split('-').every(part => /^[a-z0-9]+$/.test(part))
  if (!isKebab) {
    return {
      ok: false,
      reason: 'branch name body must be lowercase alphanumeric segments separated by single hyphens',
    }
  }
  return { ok: true, name: trimmed }
}

export function proposedBranchName(args: readonly string[]): string | null {
  const candidate = args.find(item => {
    const trimmed = item.trim()
    return trimmed !== '' && !trimmed.startsWith('--') && !trimmed.startsWith('ri.')
  })
  return candidate ? candidate.trim() : null
}

const isBranchFlag = (value: unknown) =>
  typeof value === 'string' && value.replace(/^-+/, '').toLowerCase() === 'branch'

function targetsProtected(input: unknown): boolean {
  if (typeof input === 'string') return false
  if (Array.isArray(input)) {
    const flagPair = input.some((flag, index) => {
      const value = input[index + 1]
      return isBranchFlag(flag) && typeof value === 'string' && isProtectedValue(value)
    })
    return flagPair || input.some(item => targetsProtected(item))
  }
  if (typeof input !== 'object' || input === null) return false
  return Object.entries(input).some(([key, value]) => {
    const field = key.replace(/^-+/, '').toLowerCase()
    const isBranchField = field === 'branch' || field === 'branchname' || field === 'branch_name'
    return (
      (isBranchField && typeof value === 'string' && isProtectedValue(value)) ||
      targetsProtected(value)
    )
  })
}

export const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2')

/** Every value of the named flags (`--name value`, `--name=value`, `-bvalue`), unquoted; '' for a flag with no value. */
export function flagValues(args: readonly string[], names: readonly string[]): string[] {
  const found: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = unquote(args[index] ?? '')
    for (const name of names) {
      if (arg === name) {
        const value = unquote(args[index + 1] ?? '')
        if (value === '' || value.startsWith('-')) found.push('')
        else {
          found.push(value)
          index += 1
        }
        break
      }
      if (arg.startsWith(`${name}=`)) {
        found.push(unquote(arg.slice(name.length + 1)))
        break
      }
      if (/^-[a-z]$/.test(name) && arg.startsWith(name) && arg.length > 2) {
        found.push(unquote(arg.slice(2)))
        break
      }
    }
  }
  return found
}

/** The first value of `--name value` or `--name=value`, unquoted; '' when the flag has no value. */
export function flagValue(args: readonly string[], name: string): string | null {
  return flagValues(args, [name])[0] ?? null
}

const positionals = (args: readonly string[]) => {
  const found: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = unquote(args[index] ?? '')
    if (arg.startsWith('-')) {
      const takesValue = !arg.includes('=') && !BOOLEAN_FLAGS.has(arg.toLowerCase())
      if (takesValue && args[index + 1] !== undefined && !unquote(args[index + 1] ?? '').startsWith('-')) index += 1
      continue
    }
    found.push(arg)
  }
  return found
}

/** Why the branch rule refuses this Orthanc write, or null. Applies in every approval mode. */
export function branchRuleReason(command: string, args: readonly string[]): string | null {
  if (MAIN_ONLY_WRITES.has(command)) {
    return `'${command}' writes live data on the main ontology branch and cannot take --branch. Agents do not run it: use 'ontology action-apply --branch <global branch RID>' or hand it to the operator.`
  }
  if (PROMOTIONS.has(command)) {
    return `'${command}' promotes work (a merge, an approval or a release). The operator does it; the agent does not.`
  }
  if (argsNameFlag(args, ['--allow-default-branch'])) {
    return `'${command} --allow-default-branch' writes the default branch. Use a work branch (and, for code, a pull request).`
  }
  if (command === 'repository push') {
    const found = positionals(args)
    if (found.length !== 3) {
      return `'repository push' takes exactly <repository rid> <local ref> <destination ref>; found ${found.length} positionals, so the destination cannot be checked.`
    }
    const destination = found[2]!
    if (isProtectedValue(destination)) {
      return `'repository push' to ${destination} targets the default branch. Push to a work branch and open a pull request.`
    }
    return null
  }
  if (!BRANCH_REQUIRED_PATHS.has(command)) return null
  const branches = flagValues(args, BRANCH_FLAGS)
  if (branches.length > 1) return `'${command}' names --branch ${branches.length} times. Name one work branch.`
  const branch = branches[0] ?? null
  if (branch === null || branch === '') {
    return command.startsWith('ontology ')
      ? `'${command}' names no --branch, so it would change the main ontology. Pass --branch <global branch RID> (ri.branch..branch.…); create one with 'global-branch create ${GLOBAL_BRANCH_PREFIX}<name>'.`
      : `'${command}' names no --branch, so it would write the default branch (master). Pass --branch <work branch>; create one with 'dataset branches create <dataset> ${DATASET_BRANCH_PREFIX}<name>' or use a global branch.`
  }
  if (!BRANCH_VALUE.test(branch)) return `'${command}' branch '${branch}' has characters no branch name uses.`
  // A write naming main is not refused here: the ladder asks the operator for it
  // in every mode (targetsProtected), and refuses it when no one can be asked.
  if (isProtectedValue(branch)) return null
  if (command.startsWith('ontology ') && !branch.startsWith(GLOBAL_BRANCH_RID)) {
    return `'${command}' must target a global branch RID (ri.branch..branch.…), not '${branch}': only a global branch is provably not the main ontology branch.`
  }
  return null
}

// A release tag: what it publishes must be plain enough for the operator to
// read the question. Anything else is refused, so nothing half-read is asked.
const TAG_REPOSITORY = /^ri\.stemma\.main\.repository\.[A-Za-z0-9-]+$/
const TAG_NAME = /^[A-Za-z0-9][A-Za-z0-9._+\/-]{0,127}$/
const TAG_COMMIT = /^[0-9a-f]{40,64}$/i
const TAG_BRANCH_RID = /^ri\.[a-z0-9-]+\.[a-z0-9-]*\.[a-z0-9-]+\.[A-Za-z0-9-]+$/
const TAG_REFUSAL =
  "'repository tag create --apply' must name a repository RID, a plain tag and one --commit-hash <hex> (and one plain --branch or --foundry-branch-rid, if any), so the operator can see what they approve."
// --foundry-branch-rid is orthanc's hidden alias of --branch.
const TAG_BRANCH_FLAGS = ['--branch', '--foundry-branch-rid']

/** The question a `repository tag create --apply` puts to the operator, or why it is refused.
 * A tag linked to one global branch RID is not a release on main: yolo does not ask for it. */
function releaseTagCall(args: readonly string[]): { release: string; releaseOnWorkBranch?: true } | { error: string } {
  // Orthanc gets the raw args, so a quoted, padded or newline-carrying arg is
  // not what the operator would read. Any such arg is refused.
  if (args.some(arg => unquote(arg) !== arg)) return { error: TAG_REFUSAL }
  const found = positionals(args)
  const repository = found[0] ?? ''
  const tag = found[1] ?? ''
  const commits = flagValues(args, ['--commit-hash'])
  const links = flagValues(args, [...TAG_BRANCH_FLAGS, '-b'])
  const commit = commits[0] ?? ''
  const link = links[0] ?? null
  if (
    commits.length > 1 ||
    links.length > 1 ||
    !TAG_REPOSITORY.test(repository) ||
    !TAG_NAME.test(tag) ||
    !TAG_COMMIT.test(commit) ||
    (link !== null && !TAG_BRANCH_RID.test(link))
  ) {
    return { error: TAG_REFUSAL }
  }
  const linked = link === null ? '' : ` (linked to Foundry branch ${link})`
  return {
    release:
      link === null
        ? `'repository tag create' publishes ${tag} at commit ${commit} of ${repository}${linked}. A tag with no Foundry branch is a release on main: the operator approves each one.`
        : `'repository tag create' publishes ${tag} at commit ${commit} of ${repository}${linked}. A tag is a release: the operator approves each one.`,
    ...(oneWorkBranchFlag(args, TAG_BRANCH_FLAGS) ? { releaseOnWorkBranch: true as const } : {}),
  }
}

// A schedule's build action is a JSON positional that names its branch inside.
const ACTION_BRANCH_WRITES = new Set(['orchestration schedules create', 'orchestration schedules replace'])
const ACTION_VALUE_FLAGS = new Set(['--trigger', '--name', '--description'])
// These start builds on the branch stored in a schedule or an import, so the
// guard reads it first (storedBranchReads) and judges what it finds.
export const STORED_BRANCH_RUNS = new Set(['orchestration schedules run', 'orchestration schedules unpause', 'connectivity import run'])
const BRANCH_KEYS = new Set(['branch', 'branchname', 'branch_name'])

/** Every string under a branch key (branchName, branch, branch_name), at any depth. */
export function branchesIn(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(branchesIn)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, inner]) =>
    BRANCH_KEYS.has(key.toLowerCase()) && typeof inner === 'string' ? [inner] : branchesIn(inner),
  )
}

/** The orthanc reads (argv) that return the stored schedule or import a run starts. */
export function storedBranchReads(command: string, args: readonly string[]): string[][] {
  const rid = positionals(args).find(arg => arg.startsWith('ri.'))
  if (rid === undefined) return []
  if (command === 'connectivity import run') {
    const connection = flagValue(args, '--connection')
    const extra = connection ? ['--connection', connection] : []
    const kind = flagValue(args, '--kind')
    const kinds = kind === 'file' || kind === 'table' ? [kind] : ['file', 'table']
    return kinds.map(each => ['connectivity', 'import', `get-${each}`, rid, ...extra])
  }
  return [['orchestration', 'schedules', 'get', rid]]
}

/** A schedule action's branches, or why it is refused. */
function actionBranches(command: string, args: readonly string[]): { branches: string[] } | { error: string } {
  const actions = args.filter((arg, index) => unquote(arg).startsWith('{') && !ACTION_VALUE_FLAGS.has(unquote(args[index - 1] ?? '')))
  if (actions.length !== 1) {
    return { error: `'${command}' must pass one build action as JSON with its branchName, so the guard can see which branch its builds write; found ${actions.length}.` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(unquote(actions[0]!))
  } catch {
    return { error: `'${command}' action is not JSON the guard can read, so the branch its builds write cannot be checked.` }
  }
  const branches = branchesIn(parsed)
  if (branches.length === 0) {
    return { error: `'${command}' action names no branchName, so its builds would write master. Add "branchName": "<work branch>" to the action.` }
  }
  const odd = branches.find(branch => !BRANCH_VALUE.test(branch.trim()))
  if (odd !== undefined) return { error: `'${command}' action branch '${odd}' has characters no branch name uses.` }
  return { branches }
}

function orthancClassification(
  command: string,
  args: readonly string[],
  rawInput: unknown,
  workingBranch: string | null,
  manifest: readonly ManifestCommand[],
  stored?: readonly string[] | null,
): GateClassification {
  const action = ACTION_BRANCH_WRITES.has(command) ? actionBranches(command, args) : null
  const base = {
    command,
    hasWorkingBranch: branchIsWorking(workingBranch),
    // `-b` is --branch in every command, so every spelling of it names the branch.
    targetsProtected:
      MAIN_WRITES.has(command) ||
      (action !== null && 'branches' in action && action.branches.some(isProtectedValue)) ||
      // A stored branch that could not be read, or none (Foundry reads none as master), may be main.
      (STORED_BRANCH_RUNS.has(command) &&
        (stored == null || stored.length === 0 || stored.some(branch => isProtectedValue(branch) || !BRANCH_VALUE.test(branch.trim())))) ||
      (POSITIONAL_BRANCH_WRITES.has(command) && args.some(arg => !unquote(arg).startsWith('-') && isProtectedValue(unquote(arg)))) ||
      targetsProtected(rawInput) ||
      flagValues(args.map(arg => arg.toLowerCase()), BRANCH_FLAGS).some(isProtectedValue),
  }
  if (!BRANCH_CREATION_PATHS.includes(command)) {
    const refused = branchRuleReason(command, args) ?? (action !== null && 'error' in action ? action.error : null)
    const release =
      refused === null && command === 'repository tag create' && argsNameFlag(args, ['--apply'])
        ? releaseTagCall(args)
        : null
    const approval = operatorApprovalQuestion(command, args, manifest)
    const approvalOnBranch = approval !== null && approvalOnWorkBranch(command, args, manifest)
    return {
      ...base,
      kind: 'mutation',
      isBranchScoped: BRANCH_REQUIRED_PATHS.has(command),
      isDestructive: isDestructiveCommand(command) || argsHaveForce(command, args),
      ...(release !== null ? release : {}),
      ...(approval !== null ? { operatorApproval: approval } : {}),
      ...(approvalOnBranch ? { operatorApprovalOnWorkBranch: true as const } : {}),
      ...(refused ? { error: refused } : {}),
    }
  }
  const creation = { ...base, kind: 'branch-creation' as const, isBranchScoped: false, isDestructive: false }
  const proposed = proposedBranchName(args)
  if (proposed === null) {
    return {
      ...creation,
      error: `branch creation blocked: the call proposes no branch name; name branches '${GLOBAL_BRANCH_PREFIX}<kebab>' for global branches`,
    }
  }
  const validated = validateBranchName(command, proposed)
  return validated.ok
    ? { ...creation, targetsProtected: false, proposedName: proposed }
    : { ...creation, proposedName: proposed, error: `branch name '${proposed}' rejected: ${validated.reason}` }
}

/** An orthanc_cli command as the manifest path it names (lowercased, longest
 * prefix) and its args; words past the path lead the args. Classifier and
 * executor both resolve through here, so they see the same command. The path
 * may split across the two ('repository' plus ['tag', 'create', …]): the argv
 * rebuilt from the path is the same words either way. */
export function resolveOrthancCommand(
  command: string,
  args: readonly string[],
  manifest: readonly ManifestCommand[],
): { path: string; args: string[] } {
  const words = command.trim().split(/\s+/).filter(word => word !== '')
  const paths = new Set(manifest.map(entry => entry.path))
  const head = words.map(word => word.toLowerCase())
  for (const arg of args) {
    const word = unquote(arg).toLowerCase()
    if (!/^[a-z0-9-]+$/.test(word)) break
    head.push(word)
  }
  for (let width = head.length; width >= 1; width -= 1) {
    const path = head.slice(0, width).join(' ')
    if (!paths.has(path)) continue
    return width <= words.length
      ? { path, args: [...words.slice(width), ...args] }
      : { path, args: args.slice(width - words.length) }
  }
  return { path: words.join(' ').toLowerCase(), args: [...args] }
}

const SHELL_OPERATORS = ';&|()`<>'

/** A shell command as segments of words: quotes kept together, split at
 * ; & | ( ) ` < > $( and newlines. A quoted word that holds a command
 * (`bash -c "…"`) is split again and its segments added. */
export function shellSegments(command: string, depth = 0): string[][] {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let quote: string | null = null
  let quoted = false
  const endWord = () => {
    if (word !== '' || quoted) words.push(word)
    word = ''
    quoted = false
  }
  const endSegment = () => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote !== null) {
      if (char === quote) quote = null
      else if (char === '\\' && quote === '"' && index + 1 < command.length) word += command[++index]
      else word += char
    } else if (char === "'" || char === '"') {
      quote = char
      quoted = true
    } else if (char === '\\' && index + 1 < command.length) word += command[++index]
    else if (char === '\n') endSegment()
    else if (/\s/.test(char)) endWord()
    else if (char === '$' && command[index + 1] === '(') {
      endSegment()
      index += 1
    } else if (SHELL_OPERATORS.includes(char)) endSegment()
    else word += char
  }
  endSegment()
  if (depth >= 3) return segments
  const nested = segments.flatMap(found =>
    found.filter(item => /[\s;&|()`<>]|\$\(/.test(item)).flatMap(item => shellSegments(item, depth + 1)),
  )
  return [...segments, ...nested]
}

/** Where the `$(` … `)` whose `(` is at `open` ends: its `)`, or the end of
 * `text`. Quotes and nested parentheses inside it are honored. */
function substitutionEnd(text: string, open: number): number {
  let depth = 0
  let quote: string | null = null
  for (let index = open; index < text.length; index += 1) {
    const char = text[index]!
    if (quote === "'") {
      if (char === "'") quote = null
    } else if (char === '\\') index += 1
    else if (quote === '"') {
      if (char === '"') quote = null
    } else if (char === "'" || char === '"') quote = char
    else if (char === '(') depth += 1
    else if (char === ')' && (depth -= 1) === 0) return index
  }
  return text.length
}

/** Where the backquoted command whose opening backquote is at `open` ends. */
function backquoteEnd(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1
    else if (text[index] === '`') return index
  }
  return text.length
}

/** The `$(…)` and backquoted commands in text the shell expands (a
 * double-quoted word, an unquoted heredoc body). `text[at]` starts one or not. */
function substitutionAt(text: string, at: number): { body: string; end: number } | null {
  if (text[at] === '$' && text[at + 1] === '(') {
    const end = substitutionEnd(text, at + 1)
    return { body: text.slice(at + 2, end), end }
  }
  if (text[at] === '`') {
    const end = backquoteEnd(text, at)
    return { body: text.slice(at + 1, end), end }
  }
  return null
}

function substitutionsIn(text: string): string[] {
  const found: string[] = []
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    const substitution = substitutionAt(text, index)
    if (substitution === null) continue
    found.push(substitution.body)
    index = substitution.end
  }
  return found
}

/** What a command does with the text fed to its stdin by a heredoc or a
 * here-string: a shell (or ssh) runs it as shell code, an interpreter runs it
 * as its own code, anything else reads it as data. */
function stdinReader(words: readonly string[]): 'shell' | 'interpreter' | null {
  let head = 0
  while (head < words.length && ASSIGNMENT.test(words[head]!)) head += 1
  if (head >= words.length || NON_EXECUTING.has(basename(words[head]))) return null
  if (words.some(word => SHELLS.test(basename(word)) || basename(word) === 'ssh')) return 'shell'
  if (words.some(word => CODE_RUNNERS.test(basename(word)))) return 'interpreter'
  return null
}

/** One simple command: its words; fed: a heredoc or here-string feeds its stdin; split: it ended at an unquoted $( or backquote. */
export type Segment = { words: string[]; fed: boolean; split: boolean }

// Code that can start another process, per interpreter.
const SPAWNS: [RegExp, RegExp][] = [
  [/^python/, /subprocess|\bpty\b|ctypes|pexpect|plumbum|importlib|__import__|\brunpy\b|\bgetattr\b|\bbuiltins\b|\b(exec|eval|compile)\s*\(|\b(import|from)\s+(sh|commands)\b|\bos\s*\.\s*(system|popen|exec|spawn|posix_spawn|fork)|\b(system|popen[234]?|exec[lv]p?e?|spawn[lv]p?e?|posix_spawnp?|forkpty)\s*\(|\bfrom\s+os\s+import\b[^\n;]*\b(system|popen|exec|spawn|posix_spawn|fork)/],
  [/^(node|deno|bun)$/, /child_process|\bexec(Sync|File|FileSync)?\s*\(|\bspawn|\bfork\s*\(|Deno\s*\.\s*(Command|run)|Bun\s*\.\s*(spawn|\$)|\$\s*`|\beval\s*\(|\bFunction\s*\(|\bimport\s*\(|\brequire\s*\(\s*[^'"\s]|\bexeca\b|\bzx\b|process\s*\.\s*binding/],
  [/^ruby$/, /\bsystem\b|\bexec\b|\bspawn\b|`|%x|\bpopen|Open3|\beval\b|\bfork\b|\bsyscall\b|\bPTY\b|\bsend\s*\(|\b(instance|class|module)_eval\b|\bKernel\b/],
  [/^perl$/, /\bsystem\b|\bexec\b|`|\bqx\b|\bopen\b[^;]*\||\beval\b|\bfork\b|\bsyscall\b|IPC::|\bpipe\b/],
  [/^awk$/, /\bsystem\s*\(|\bgetline\b|\|/],
  [/^osascript$/, /do\s+(shell\s+)?script|doShellScript|NSTask|\bObjC\b/i],
]

/** True when `code`, run by `runner` (a CODE_RUNNERS basename), can start a process. Over-matching only refuses more. */
function spawns(runner: string, code: string): boolean {
  const entry = SPAWNS.find(([name]) => name.test(runner.toLowerCase()))
  return entry === undefined || entry[1].test(code)
}

/** One pass over a shell line as the shell reads it: the segments of each
 * simple command, plus the command text the shell runs from inside words
 * (`$(…)` and backquotes in double quotes or an unquoted heredoc). Redirect
 * targets are data. A heredoc or here-string is data too, unless its command
 * reads stdin as code: then a shell's text is code, and an interpreter's text
 * makes the line `hidden` when the line names orthanc and the text can start a
 * process. Single-quoted text stays literal. */
function shellWords(command: string): { segments: Segment[]; code: string[]; hidden: boolean } {
  const segments: Segment[] = []
  const code: string[] = []
  const heredocs: { delimiter: string; expands: boolean; tabs: boolean; owner: string[] }[] = []
  // Text fed to a command's stdin, judged once its line is complete.
  const fed: { owner: string[]; text: string }[] = []
  let words: string[] = []
  let word = ''
  let quote: string | null = null
  let quoted = false
  let target: 'file' | 'herestring' | 'heredoc' | 'heredoc-tabs' | null = null
  const endWord = () => {
    if (word !== '' || quoted) {
      if (target === 'heredoc' || target === 'heredoc-tabs') {
        heredocs.push({ delimiter: word, expands: !quoted, tabs: target === 'heredoc-tabs', owner: words })
      } else if (target === 'herestring') fed.push({ owner: words, text: word })
      else if (target === null) words.push(word)
      target = null
    }
    word = ''
    quoted = false
  }
  const endSegment = (split = false) => {
    endWord()
    target = null
    if (words.length > 0) segments.push({ words, fed: false, split })
    words = []
  }
  // At a newline: skip the bodies of the heredocs opened on the line that ends here.
  const skipHeredocs = (newline: number): number => {
    let end = newline
    for (const heredoc of heredocs.splice(0)) {
      const body: string[] = []
      while (end < command.length) {
        const start = end + 1
        const next = command.indexOf('\n', start)
        end = next < 0 ? command.length : next
        const line = command.slice(start, end)
        if ((heredoc.tabs ? line.replace(/^\t+/, '') : line) === heredoc.delimiter) break
        body.push(line)
      }
      if (heredoc.expands) code.push(...substitutionsIn(body.join('\n')))
      fed.push({ owner: heredoc.owner, text: body.join('\n') })
    }
    return end
  }
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]!
    if (quote === "'") {
      if (char === "'") quote = null
      else word += char
      continue
    }
    if (quote === '"') {
      const substitution = substitutionAt(command, index)
      if (char === '"') quote = null
      else if (char === '\\' && index + 1 < command.length) word += command[++index]
      else if (substitution !== null) {
        code.push(substitution.body)
        word += command.slice(index, substitution.end + 1)
        index = substitution.end
      } else word += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      quoted = true
    } else if (char === '\\' && index + 1 < command.length) word += command[++index]
    else if (char === '\n') {
      endSegment()
      index = skipHeredocs(index)
    } else if (/\s/.test(char)) endWord()
    else if (char === '$' && command[index + 1] === '(') {
      endSegment(true)
      index += 1
    } else if (char === '<' || char === '>' || (char === '&' && command[index + 1] === '>')) {
      // A file descriptor glued to the redirect (`2>`, `0<<`) is not a word.
      if (!quoted && /^[0-9]+$/.test(word)) word = ''
      endWord()
      let last = index
      while ('<>&|'.includes(command[last + 1] ?? ' ')) last += 1
      const operator = command.slice(index, last + 1)
      index = last
      if (command[last + 1] === '(') {
        // <(…) and >(…) run a command: read it as its own segment.
        endSegment()
        index += 1
      } else if (operator === '<<<') target = 'herestring'
      else if (operator === '<<') {
        const tabs = command[last + 1] === '-'
        if (tabs) index += 1
        target = tabs ? 'heredoc-tabs' : 'heredoc'
      } else target = 'file'
    } else if (SHELL_OPERATORS.includes(char)) endSegment(char === '`')
    else word += char
  }
  endSegment()
  // A heredoc opened on the last line has no body to skip, but still feeds its owner.
  const owners = new Set([...heredocs, ...fed].map(item => item.owner))
  for (const segment of segments) segment.fed = owners.has(segment.words)
  let hidden = false
  for (const { owner, text } of fed) {
    const reader = stdinReader(owner)
    if (reader === 'shell') code.push(text)
    else if (reader === 'interpreter' && NAMES_ORTHANC.test(command)) {
      const runner = basename(owner.find(word => CODE_RUNNERS.test(basename(word))))
      if (spawns(runner, text)) hidden = true
    }
  }
  return { segments, code, hidden }
}

const SHELLS = /^(sh|bash|zsh|dash|ksh|mksh|ash|fish|busybox)$/
// Heads whose following words are one command line the shell runs (eval, ssh host …).
const LINE_RUNNERS = new Set(['eval', 'ssh', 'watch', 'tmux', 'screen', 'parallel'])
const CODE_FLAG = /^-[A-Za-z]*[cS]$/
const NESTING_LIMIT = 3
// Words after which a later word is the program that runs (`docker exec -i c sh`).
const LAUNCHERS = new Set([
  'exec', 'run', 'ssh', 'sudo', 'doas', 'env', 'xargs', 'nohup', 'timeout', 'nice', 'stdbuf', 'setsid', 'chroot',
  'unshare', 'nsenter', 'flock', 'time', 'command', 'caffeinate',
])
// A segment hidesOrthanc refuses whenever the line names orthanc.
const UNREADABLE: Segment = { words: ['$'], fed: false, split: false }

/** The words of a segment that the shell runs as code: the value after -c
 * (sh -c, bash -lc, su -c, npx -c), env -S, and everything after eval or ssh.
 * Free-text heads (git, echo, grep, …) run none of their words. */
function codeWords(words: readonly string[]): string[] {
  let head = 0
  while (head < words.length && ASSIGNMENT.test(words[head]!)) head += 1
  if (head >= words.length || NON_EXECUTING.has(basename(words[head]))) return []
  const code: string[] = []
  for (let index = head; index < words.length; index += 1) {
    if (LINE_RUNNERS.has(basename(words[index]))) {
      code.push(words.slice(index + 1).join(' '))
      break
    }
    if (CODE_FLAG.test(words[index]!) && words[index + 1] !== undefined) code.push(words[index + 1]!)
  }
  return code
}

/** The simple commands a Bash line runs, for the Orthanc guard. Unlike
 * shellSegments, a quoted word is read as a command only where the shell runs
 * it (see codeWords and shellWords), so free text that mentions orthanc in a
 * commit message, a PR body or an echo stays text. Code nested past the limit
 * comes back as a `$` segment, which hidesOrthanc refuses. */
export function commandSegments(command: string, depth = 0): Segment[] {
  const { segments, code, hidden } = shellWords(command)
  const own = hidden ? [...segments, UNREADABLE] : segments
  const nested = [...code, ...segments.flatMap(segment => codeWords(segment.words))].filter(item => item.trim() !== '')
  if (nested.length === 0) return own
  if (depth >= NESTING_LIMIT) return [...own, UNREADABLE]
  return [...own, ...nested.flatMap(item => commandSegments(item, depth + 1))]
}

const basename = (word: string | undefined) => (word ?? '').split('/').at(-1)?.replace(/^!/, '') ?? ''
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
// orthanc as a word or the last segment of a path (`/opt/bin/orthanc`), not part of a longer name or a directory in a path.
const NAMES_ORTHANC = /(?<![\w.-])orthanc(?![\w./-])|ORTHANC_BIN/i
const isOrthancWord = (word: string) => basename(word).toLowerCase() === 'orthanc' || /\$\{?ORTHANC_BIN\}?/.test(word)
const WRAPPERS = new Set([
  'env', 'command', 'exec', 'time', 'nohup', 'sudo', 'doas', 'xargs', 'nice', 'timeout', 'caffeinate',
  'builtin', 'stdbuf', 'then', 'do', 'else', '!', '{',
])
const INDIRECT = new Set(['eval', 'source', '.'])
const CODE_RUNNERS = /^(python[0-9.]*|node|deno|bun|ruby|perl|osascript|awk)$/

// Heads that name orthanc without running it (`grep orthanc`, `cd orthanc`).
const NON_EXECUTING = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'cat', 'bat', 'less', 'more', 'head', 'tail', 'wc', 'ls', 'cd', 'pushd',
  'man', 'which', 'whereis', 'type', 'echo', 'printf', 'git', 'make', 'file', 'stat', 'open', 'code', 'vim',
  'nano', 'brew', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'tree', 'du', 'diff', 'cargo', 'sed', 'awk',
])

/** The index of the first word past the wrapper prefix: assignments, wrappers,
 * their flags and the numbers they take (`timeout 5`, `nice -n 10`). */
function commandHead(words: readonly string[]): number {
  let index = 0
  while (index < words.length && (ASSIGNMENT.test(words[index]!) || WRAPPERS.has(basename(words[index])) || words[index]!.startsWith('-') || /^[0-9.]+[smhd]?$/.test(words[index]!))) {
    index += 1
  }
  return index
}

// A path under a variable (`$X/orthanc-old`, `${X}/out`): an argument, not a command.
const VARIABLE_PATH = /^\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)\//

/** True when the word after `at`, past Orthanc's global flags, starts a call: a
 * first word of a manifest path (`groups`), a substitution, or a variable that
 * is not a path. Without a manifest, any word that is not a flag. */
function startsCall(words: readonly string[], at: number, groups: ReadonlySet<string>): boolean {
  let index = at + 1
  while (index < words.length) {
    const word = words[index]!
    if (word === '--agent' || word === '--non-interactive' || word.startsWith('--profile=')) index += 1
    else if (word === '--profile') index += 2
    else break
  }
  const next = words[index]
  if (next === undefined) return false
  if (groups.size === 0) return !next.startsWith('-')
  return groups.has(next.toLowerCase()) || (next.startsWith('$') && !VARIABLE_PATH.test(next)) || next.startsWith('`')
}

/** True when `flags` make `runner` print and exit without reading code
 * (`node --version`, `python3 -V`). Python's -v and a shell's -h read stdin. */
function printsAndExits(runner: string, flags: readonly string[]): boolean {
  return flags.some(
    flag =>
      /^--(version|help)$/.test(flag) ||
      (/^python/.test(runner) && /^-[hV]$/.test(flag)) ||
      (/^(node|bun|perl)$/.test(runner) && /^-[hv]$/.test(flag)),
  )
}

/** Where Orthanc starts in a segment: the command word, or the first orthanc
 * word after a head that can run another program (env, sudo, xargs, find
 * -exec, npx, ssh, a wrapper script, …) when a call follows it. -1 when the
 * segment does not run Orthanc: `--bin target/debug/orthanc` is an argument. */
function orthancStart(segment: Segment, groups: ReadonlySet<string>): number {
  const { words } = segment
  const head = commandHead(words)
  if (head >= words.length) return -1
  if (isOrthancWord(words[head]!)) return head
  if (NON_EXECUTING.has(basename(words[head]))) return -1
  for (let position = head + 1; position < words.length; position += 1) {
    if (!isOrthancWord(words[position]!)) continue
    // The segment ended at a substitution: the call continues in it.
    if (startsCall(words, position, groups) || (segment.split && position === words.length - 1)) return position
  }
  return -1
}

/** True when a segment runs Orthanc in a form the parser cannot read: an
 * assignment of the binary, a variable that may run it, eval, or interpreter
 * code that can start a process. `command` is the whole shell line;
 * `assignments` holds every value the line gives each variable. */
function hidesOrthanc(
  segment: Segment,
  command: string,
  assignments: ReadonlyMap<string, string[]>,
  groups: ReadonlySet<string>,
): boolean {
  if (!NAMES_ORTHANC.test(command)) return false
  const { words } = segment
  // Only assignments: `O=/opt/bin/orthanc` stores the binary to run later.
  if (words.every(word => ASSIGNMENT.test(word))) {
    return words.some(word => isOrthancWord(unquote(word.replace(ASSIGNMENT, '')).split(/\s+/)[0] ?? ''))
  }
  const index = commandHead(words)
  const head = words[index]
  if (head === undefined) return false
  if (head.startsWith('$')) {
    // A variable run as a command: refused when it may hold the binary, or is run with an Orthanc command.
    if (NAMES_ORTHANC.test(head)) return true
    const name = /^\$\{?([A-Za-z_][A-Za-z0-9_]*)/.exec(head)?.[1]
    if (name === undefined || name.toUpperCase().includes('ORTHANC')) return true
    const values = assignments.get(name) ?? []
    if (values.some(value => NAMES_ORTHANC.test(value))) return true
    if (values.length > 0 && values.every(value => value !== '' && !/[$`]/.test(value))) return false
    return startsCall(words, index, groups)
  }
  const rest = words.slice(index + 1)
  if (INDIRECT.has(head)) return rest.some(word => NAMES_ORTHANC.test(word))
  // A shell or interpreter in command position (the head, after `--`, or after
  // a launcher such as `kubectl exec -i p -- bash`, `docker exec -i c sh`).
  const runner = words.findIndex(
    (word, position) =>
      position >= index &&
      (SHELLS.test(basename(word)) || CODE_RUNNERS.test(basename(word))) &&
      (position === index || words[position - 1] === '--' || words.slice(index, position).some(earlier => LAUNCHERS.has(basename(earlier)))),
  )
  if (runner < 0 || (runner !== index && NON_EXECUTING.has(basename(head)))) return false
  const after = words.slice(runner + 1)
  // It reads its code from stdin when it has no script (and is not only asked
  // for its version), a script of - or /dev/stdin, or (a shell) -s. A heredoc
  // or here-string was judged in shellWords.
  if (!segment.fed) {
    const script = after.find(word => word === '-' || !word.startsWith('-'))
    if (script === undefined && !printsAndExits(basename(words[runner]).toLowerCase(), after)) return true
    if (script === '-' || script === '/dev/stdin') return true
    if (SHELLS.test(basename(words[runner])) && after.some(word => /^-[A-Za-z]*s[A-Za-z]*$/.test(word))) return true
  }
  // Interpreter code inline (`python3 -c "…"`): the word after -c/-e, or a word that holds code.
  if (!CODE_RUNNERS.test(basename(words[runner]))) return false
  const inline = after.filter((word, position) => /^(-c|-e|-E|--eval|-p|--print)$/.test(after[position - 1] ?? '') || /[\s()'"\[\];]/.test(word))
  return inline.length > 0 && spawns(basename(words[runner]), inline.join('\n'))
}

/** The Orthanc command a Bash segment runs: global flags skipped, then the longest manifest path. */
function orthancShellCall(
  words: readonly string[],
  start: number,
  manifest: readonly ManifestCommand[],
): { path: string; known: boolean; help: boolean } {
  const rest = words.slice(start + 1)
  let index = 0
  while (index < rest.length && rest[index]!.startsWith('-')) index += rest[index] === '--profile' ? 2 : 1
  const tail = rest.slice(index)
  const ended = rest.indexOf('--')
  const flags = ended < 0 ? rest : rest.slice(0, ended)
  const help = flags.some(word => ['-h', '--help', '-V', '--version'].includes(word)) || tail[0] === 'help'
  const leading: string[] = []
  for (const word of tail) {
    if (word.startsWith('-')) break
    leading.push(word)
  }
  const paths = new Set(manifest.map(entry => entry.path))
  for (let width = leading.length; width >= 1; width -= 1) {
    const path = leading.slice(0, width).join(' ').toLowerCase()
    if (paths.has(path)) return { path, known: true, help }
  }
  return { path: leading.join(' ').toLowerCase(), known: false, help }
}

// The Bash guard never refuses a command for its shape or because it names
// orthanc. A raw `orthanc …` call, a script file, a pipeline, a variable or a
// substitution all run. The guard stops one thing: a call it can read that does
// what the ladder names (a write on main or HEAD, a promotion, a release tag).
// A call it cannot read (a variable it cannot resolve, a substitution, a
// script) is allowed: it is judged by what it does where that is readable, and
// not at all where it is not.
const UNREADABLE_WORD = /[$`]/

// Run through a variable that the line sets to the binary (`O=orthanc; $O …`).
function resolveHead(segment: Segment, assignments: ReadonlyMap<string, string[]>): Segment {
  const index = commandHead(segment.words)
  const head = segment.words[index]
  const name = head === undefined ? undefined : /^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/.exec(head)?.[1]
  const values = name === undefined ? [] : (assignments.get(name) ?? [])
  const value = values.length > 0 && values.every(candidate => candidate === values[0]) ? unquote(values[0]!) : ''
  if (!isOrthancWord(value.split(/\s+/)[0] ?? '')) return segment
  return { ...segment, words: [...segment.words.slice(0, index), ...value.split(/\s+/), ...segment.words.slice(index + 1)] }
}

function shellClassification(
  command: string,
  manifest: readonly ManifestCommand[],
  workingBranch: string | null,
): GateClassification | null {
  const segments = commandSegments(command)
  // The first words of the manifest paths: what can follow `orthanc` as a call.
  const groups = new Set(manifest.map(entry => entry.path.toLowerCase().split(/\s+/)[0] ?? ''))
  // Every value the line assigns to each variable, at any position (`export X=…`, `env X=… cmd`).
  const assignments = new Map<string, string[]>()
  for (const word of segments.flatMap(segment => segment.words)) {
    const assigned = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word)
    if (assigned) assignments.set(assigned[1]!, [...(assignments.get(assigned[1]!) ?? []), assigned[2]!])
  }
  for (const original of segments) {
    const segment = resolveHead(original, assignments)
    const { words } = segment
    const start = orthancStart(segment, groups)
    if (start < 0) continue
    const call = orthancShellCall(words, start, manifest)
    // Help, version, an unknown or unreadable command, clone and every read run.
    if (call.help || !call.known || call.path === 'repository clone') continue
    // A read the manifest marks for operator approval is judged like a write.
    if (classifyOrthancCommand(call.path, manifest) === 'read' && !manifest.some(entry => entry.path === call.path && entry.operatorApproval !== undefined)) continue
    const args = words.slice(start + 1 + call.path.split(' ').length)
    // The guard names only what the ladder names: a promotion or a main-only
    // write (judged by the command path alone), a write naming main or HEAD, a
    // write with no branch (it lands on main), a release tag apply, a command the
    // manifest marks for operator approval. Every other branch-rule refusal
    // (a branch name it dislikes, a push with other positionals) is not named.
    // A word the shell expands cannot be read: the path and the literal flags are still judged.
    const readable = !words.slice(start + 1).some(word => UNREADABLE_WORD.test(word))
    const classified = orthancClassification(call.path, args, { command: call.path, args }, workingBranch, manifest)
    const declaresApply = manifest.some(entry => entry.path === call.path && entry.flags?.some(flag => flag.flag === '--apply'))
    // A dry run changes nothing: a command that declares --apply and was not given it.
    const dryRun = declaresApply && !argsNameFlag(args, ['--apply'])
    let error: string | undefined
    if (PROMOTIONS.has(call.path) || MAIN_ONLY_WRITES.has(call.path) || argsNameFlag(args, ['--allow-default-branch'])) {
      error = branchRuleReason(call.path, args) ?? classified.error
    } else if (call.path === 'repository push') {
      const found = positionals(args)
      if (found.length === 3 && isProtectedValue(found[2]!)) error = classified.error
    } else if (readable && BRANCH_REQUIRED_PATHS.has(call.path) && flagValues(args, BRANCH_FLAGS).length === 0) {
      error = classified.error
    }
    const tagApply = call.path === 'repository tag create' && argsNameFlag(args, ['--apply'])
    const release = tagApply
      ? (classified.release ?? `'repository tag create --apply' publishes a release tag; the guard cannot read all of its arguments, so the operator decides.`)
      : undefined
    const targetsProtected = classified.targetsProtected && !dryRun
    if (error === undefined && !targetsProtected && release === undefined && classified.operatorApproval === undefined) continue
    return {
      ...classified,
      targetsProtected,
      error,
      ...(release !== undefined ? { release } : {}),
    }
  }
  return null
}

const PALANTIR_MCP = /^mcp__palantir(-mcp)?__/
const WRITE_WORDS = new Set(['add', 'apply', 'build', 'create', 'delete', 'deploy', 'edit', 'install', 'post', 'publish', 'put', 'remove', 'rename', 'set', 'submit', 'update', 'write'])
const AMBIGUOUS_WORDS = new Set(['call', 'execute', 'invoke', 'run', 'trigger'])
const READ_WORDS = new Set(['check', 'describe', 'get', 'health', 'inspect', 'list', 'preview', 'query', 'read', 'search', 'view'])

export function classifyMcpIntent(inner: string): 'read' | 'write' | 'unknown' {
  const words = inner.toLowerCase().split(/[^a-z]+/)
  if (words.some(word => WRITE_WORDS.has(word))) return 'write'
  if (words.some(word => AMBIGUOUS_WORDS.has(word))) return 'unknown'
  if (words.some(word => READ_WORDS.has(word))) return 'read'
  return 'unknown'
}

/** A Foundry call the guard cannot read: blocked in every mode, so it never runs blind. */
function unreadableCall(input: unknown, workingBranch: string | null, error: string): GateClassification {
  return {
    command: null,
    kind: 'mutation',
    isBranchScoped: false,
    hasWorkingBranch: branchIsWorking(workingBranch),
    targetsProtected: targetsProtected(input),
    isDestructive: false,
    error,
  }
}

/** Null: a read, or a tool outside the Foundry lane. Never reaches the ladder. */
export function classifyCall(
  tool: string,
  input: Record<string, unknown>,
  manifest: readonly ManifestCommand[],
  workingBranch: string | null,
  /** For a run of a stored schedule or import: the branches read from it; null when the read failed. */
  stored?: readonly string[] | null,
): GateClassification | null {
  if (tool === ORTHANC_CLI) {
    // Without the manifest the guard cannot tell which command this call runs, and
    // the executor loads the manifest again for itself. Nothing unreadable runs.
    if (manifest.length === 0) {
      return unreadableCall(input, workingBranch, "Orthanc's agent manifest could not be loaded, so the Foundry guard cannot tell which command this call runs. Try again.")
    }
    const raw = typeof input.command === 'string' ? input.command : ''
    const resolved = resolveOrthancCommand(raw, Array.isArray(input.args) ? input.args.map(String) : [], manifest)
    // Words that name no command at all: nothing safe to run, so nothing runs.
    if (resolved.path === '' && resolved.args.length > 0) {
      return unreadableCall(input, workingBranch, `Orthanc's agent manifest has no command starting with '${resolved.args.join(' ')}'. Look it up with orthanc_help, then call orthanc_cli with the command name in \`command\`.`)
    }
    if (resolved.path === '' || resolved.path === 'repository clone') return null
    // A read whose entry also asks for the operator is not let through as a read.
    if (classifyOrthancCommand(resolved.path, manifest) === 'read' && operatorApprovalQuestion(resolved.path, resolved.args, manifest) === null) return null
    // orthanc reads the last --profile it is given, so one in the args would move
    // the write off the stack the operator picked. Reads may look at another stack.
    if (resolved.args.some(arg => PROFILE_FLAG.test(unquote(arg)))) {
      return unreadableCall(input, workingBranch, `'${resolved.path}' passes --profile, which would run this write on a stack the operator did not pick. orthanc_cli runs on the active stack; the operator switches it with /profile.`)
    }
    if (STACK_COMMANDS.has(resolved.path)) {
      return unreadableCall(input, workingBranch, `'${resolved.path}' changes orthanc's default stack, which a later session starts on. The stack is the operator's: they switch it with /profile.`)
    }
    return orthancClassification(resolved.path, resolved.args, { ...input, args: resolved.args }, workingBranch, manifest, stored)
  }
  if (tool === 'Bash' && typeof input.command === 'string') return shellClassification(input.command, manifest, workingBranch)
  if (PALANTIR_MCP.test(tool)) {
    const inner = tool.replace(PALANTIR_MCP, '')
    if (classifyMcpIntent(inner) === 'read') return null
    return {
      command: null,
      kind: 'mutation',
      isBranchScoped: false,
      hasWorkingBranch: branchIsWorking(workingBranch),
      targetsProtected: targetsProtected(input),
      isDestructive: inner.toLowerCase().split(/[^a-z]+/).includes('delete'),
      error: `${tool} writes to Foundry outside Orthanc, with no branch. Orthanc is the only write path: use orthanc_cli with --branch.`,
    }
  }
  return null
}

export function ladderDecision(
  mode: ApprovalMode,
  classification: GateClassification,
  verdict?: GuardVerdict | null,
): LadderDecision {
  if (classification.error) return { outcome: 'block', reason: classification.error }
  // zay, 2026-11-17: "when im in yolo mode of the plugin, no approvals are
  // necessary for anything on the branch, only main." A release tag or a write
  // the manifest marks operator_approval asks in every mode; yolo skips it only
  // when the call is shown to land on one global work branch. These come before
  // yolo's early run, so nothing that lands on main runs unasked.
  const yolo = mode === 'yolo'
  if (classification.release && !(yolo && classification.releaseOnWorkBranch)) {
    return { outcome: 'ask', reason: classification.release }
  }
  if (classification.operatorApproval && !(yolo && classification.operatorApprovalOnWorkBranch)) {
    return { outcome: 'ask', reason: classification.operatorApproval }
  }
  if (classification.kind === 'branch-creation') {
    if (mode === 'ask-always') {
      return {
        outcome: 'ask',
        reason: `ask-always mode: branch creation '${classification.proposedName ?? '?'}' waits for approval`,
      }
    }
    return { outcome: 'run', reason: 'branch creation is pre-authorized and reversible' }
  }
  const command = classification.command ?? '(foundry mcp write)'
  const note = verdict ? ` ${verdict.reason}` : ''
  // Yolo asks only for a write naming main: no write lands on main without the operator.
  if (mode === 'yolo' && classification.targetsProtected) {
    return {
      outcome: 'ask',
      reason: `yolo mode: '${command}' writes main (it names main, master or HEAD as its branch, or works on main only, or starts a stored schedule or import that may build main). It runs only if the operator approves; otherwise pass a work branch.`,
    }
  }
  if (mode === 'yolo') return { outcome: 'run', reason: 'yolo mode: nothing else asks; work stays on branches that are not main' }
  if (classification.isDestructive) {
    return { outcome: 'ask', reason: `destructive mutation '${command}' asks in every mode but yolo${note}` }
  }
  if (classification.targetsProtected) {
    return {
      outcome: 'ask',
      reason: `'${command}' targets a protected baseline (main/master branch or the production ontology)${note}`,
    }
  }
  if (mode === 'ask-always') return { outcome: 'ask', reason: `ask-always mode: mutation '${command}' waits for approval` }
  if (mode === 'allow-edits') return { outcome: 'run', reason: 'allow-edits mode: non-protected mutations run' }
  if (!verdict) return { outcome: 'ask', reason: `'${command}': guard unavailable; failing closed to a human decision` }
  if (verdict.action === 'approve') return { outcome: 'run', reason: verdict.reason }
  return { outcome: 'ask', reason: `'${command}': ${verdict.reason}` }
}

export function modeGuidance(mode: ApprovalMode): string {
  return (
    'Branch rule: agent work happens on branches, never on a production main. Every ontology write ' +
    'passes --branch <global branch RID> (ri.branch..branch.…; create one with global-branch create agent/<name>); ' +
    'dataset, stream and build writes pass --branch <work branch>; code goes to a work branch and a pull request. ' +
    'Writes without a branch, merges and default-branch pushes are blocked in every mode. ' +
    'A write that names main, master or HEAD as its branch, or works on main only, asks the operator in every mode. ' +
    (mode === 'yolo'
      ? 'Foundry approval mode: yolo. Nothing asks the operator except a write on main: deletes and --force writes run at once, ' +
        'and the loop guard is off. A write that names main or master as its branch asks the operator; ' +
        'so does a release tag (repository tag create --apply) with no --branch <global branch RID>, and a write the agent manifest ' +
        'marks operator_approval (such as turning branch protection off) unless its operator_approval_scope shows it lands on one global work branch. ' +
        'If the operator declines or no one can be asked, it is blocked. Pass a work branch instead.'
      : 'Writes the agent manifest marks operator_approval, such as turning branch protection off, also ask the operator. ' +
        'Release tags (repository tag create --apply) ask the operator in every mode except yolo, where only a tag with no --branch <global branch RID> asks. ' +
        `Foundry approval mode: ${mode}. Foundry mutations may surface an approval dialog for the ` +
        'operator: the call continues once approved; if the operator declines or no one can be asked, ' +
        'the call is blocked — report it, do not retry blindly.')
  )
}

const COMPASS_ROOT = 'ri.compass.main.folder.0'

function containsCompassRoot(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().toLowerCase() === COMPASS_ROOT
  if (Array.isArray(value)) return value.some(containsCompassRoot)
  if (typeof value === 'object' && value !== null) return Object.values(value).some(containsCompassRoot)
  return false
}

export function compassRootReason(tool: string, input: unknown): string | null {
  if (!containsCompassRoot(input)) return null
  return `Compass root folder ${COMPASS_ROOT} is not a valid scope for ${tool}. Provide a verified child folder RID; root resource search is not supported.`
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  )
}

/** Third consecutive identical call (tool + top-level-sorted input) is blocked. */
export function loopStep(
  previous: { identity: string; streak: number } | null,
  tool: string,
  input: unknown,
): { next: { identity: string; streak: number }; reason: string | null } {
  const identity = JSON.stringify({ input: stable(input), tool })
  const streak = previous?.identity === identity ? previous.streak + 1 : 1
  const reason =
    streak > 2
      ? 'Loop guard blocks a third identical tool call. Use existing evidence or change the experiment.'
      : null
  return { next: { identity, streak }, reason }
}

// Raw `git push` from a Foundry clone skips Orthanc's default-branch refusal.
// Every directory a `git … push` in a shell command could run in: '' (the
// session's), each cd/pushd target, each -C, --git-dir and --work-tree value.
// Over-counting only costs a remote check. Null when nothing pushes.
export function gitPushDirectories(command: string): string[] | null {
  const directories = new Set<string>([''])
  let pushes = false
  for (const words of shellSegments(command)) {
    words.forEach((word, index) => {
      if (word === 'cd' || word === 'pushd') {
        const target = words.slice(index + 1).find(next => !next.startsWith('-'))
        if (target !== undefined) directories.add(target)
      }
      const env = /^(?:GIT_DIR|GIT_WORK_TREE)=(.+)$/.exec(word)
      if (env) directories.add(env[1]!)
    })
    const git = words.findIndex(word => basename(word) === 'git')
    if (git < 0) continue
    const rest = words.slice(git + 1)
    for (let index = 0; index < rest.length; index += 1) {
      const word = rest[index]!
      if (word === '-C' || word === '--git-dir' || word === '--work-tree') {
        if (rest[index + 1] !== undefined) directories.add(rest[index + 1]!)
        index += 1
        continue
      }
      if (word === '-c' || word === '--namespace' || word === '--config-env') {
        // An alias set on the command line can be push under another name.
        if (/^alias\./i.test(rest[index + 1] ?? '')) pushes = true
        index += 1
        continue
      }
      const joined = /^--(git-dir|work-tree)=(.+)$/.exec(word)
      if (joined) directories.add(joined[2]!)
      if (word.startsWith('-')) continue
      if (word === 'push') pushes = true
      break
    }
  }
  return pushes ? [...directories] : null
}

/** A push that names a Foundry repository URL outright, from any directory. */
export function gitPushNamesFoundry(command: string): boolean {
  return gitPushDirectories(command) !== null && command.includes('ri.stemma.')
}

export const FOUNDRY_GIT_PUSH_REASON =
  "Raw 'git push' to a Foundry code repository bypasses Orthanc. Push with " +
  "'orthanc repository push <repository rid> refs/heads/<work branch> refs/heads/<work branch>' and open a pull request; it refuses the default branch."

// The operator's files steer the write guard and the trace export, so only the
// operator edits them: ~/.claude/foundry/ (rules.md, otel.env) and a project's
// .claude/foundry-rules.md. otel.env can name a collector and key references,
// so Claude does not read the directory either. The mod reads them once at
// session start, so a change made mid-session waits for the next one.
const FILE_WRITERS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit'])
const FILE_READERS = new Set(['Read', 'Grep', 'Glob', 'LS'])
const PROTECTED_FILE = /(^|\/)\.claude\/(foundry-rules\.md|foundry(\/|$))/
const SECRET_DIR = /(^|\/)\.claude\/foundry(\/|$)/
// Any shell mention of these is denied, read or write.
const SHELL_PROTECTED = /\.claude\/+(\.\/+)*foundry\b|foundry-rules|otel\.env|\.claude\/*\*/i
// A loose mention (a relative foundry/…md path) is denied with a writer. The
// directory starts a path component: skills/palantir-foundry-tools/… is not it.
const SHELL_MENTION = /(^|[\s'"=/:<>|;&(){},])found\S*\/\S*\.md/i
const SHELL_WRITES =
  /(>|\btee\b|\bsed\b|\bmv\b|\bcp\b|\brm\b|\bln\b|\btruncate\b|\binstall\b|\bdd\b|\btouch\b|\bperl\b|\bpython[0-9.]*\b|\bnode\b|\bruby\b|\bed\b|\bex\b|\bvim?\b|\bnvim\b|\bcurl\b|\bwget\b|\bchmod\b|\bunlink\b|\brsync\b|\bbun\b|\bdeno\b|\bphp\b|\bawk\b|\blua\b|\bswift\b|\bosascript\b|\btar\b|\bunzip\b|\bcpio\b|\bditto\b|\bpatch\b|\bgit\b|\b(ba|z|da|k|c|tc|fi)?sh\b)/
// Removing or moving ~/.claude itself removes the operator's rules with it.
const CLAUDE_DIR_REMOVAL = /\b(rm|mv|rsync|unlink)\b[^;&|]*\.claude\/?(?=["'\s;&|)]|$)/
export const RULES_WRITE_REASON =
  'Foundry operator files (~/.claude/foundry/: rules.md, otel.env; .claude/foundry-rules.md) steer the write guard and tracing, so only the operator reads and edits them. Suggest the change and let the operator make it.'

/** A file path as the filesystem sees it: absolute against `cwd`, ~ expanded, . and // collapsed, lowercased (macOS). */
export function normalizedPath(path: string, cwd: string, home: string): string {
  const expanded = path.trim().replace(/^~(?=\/|$)/, home)
  const absolute = expanded.startsWith('/') ? expanded : `${cwd.replace(/\/$/, '')}/${expanded}`
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`.toLowerCase()
}

export function rulesWriteReason(tool: string, input: Record<string, unknown>, cwd = '/', home = ''): string | null {
  const paths = [input.file_path, input.notebook_path, input.path].filter((value): value is string => typeof value === 'string')
  if (FILE_WRITERS.has(tool) && paths.some(path => PROTECTED_FILE.test(normalizedPath(path, cwd, home)))) return RULES_WRITE_REASON
  if (FILE_READERS.has(tool)) {
    const base = paths[0] ?? cwd
    const targets = [base, ...(typeof input.pattern === 'string' && tool === 'Glob' ? [`${base.replace(/\/$/, '')}/${input.pattern}`] : [])]
    const NAMES_OPERATOR_FILES = /otel|foundry-rules|\.claude/i
    if (typeof input.glob === 'string' && NAMES_OPERATOR_FILES.test(input.glob)) return RULES_WRITE_REASON
    if (tool === 'Glob' && typeof input.pattern === 'string' && NAMES_OPERATOR_FILES.test(input.pattern)) return RULES_WRITE_REASON
    // A search rooted at ~/.claude reaches the directory; one rooted at ~ is left
    // alone (it would stop every home-directory session), and otel.env holds only references.
    if (tool !== 'Read' && home !== '' && normalizedPath(base, cwd, home) === normalizedPath('~/.claude', '/', home)) return RULES_WRITE_REASON
    if (targets.some(target => SECRET_DIR.test(normalizedPath(target, cwd, home)))) return RULES_WRITE_REASON
  }
  if (tool === 'Bash' && typeof input.command === 'string') {
    const command = input.command
    if (SHELL_PROTECTED.test(command) || CLAUDE_DIR_REMOVAL.test(command)) return RULES_WRITE_REASON
    if (SHELL_MENTION.test(command) && SHELL_WRITES.test(command)) return RULES_WRITE_REASON
    if (PROTECTED_FILE.test(normalizedPath(cwd, '/', home))) return RULES_WRITE_REASON
  }
  return null
}
