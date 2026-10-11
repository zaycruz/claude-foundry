// The approval ladder, the branch gate and the approval modes. Pure functions:
// no `$`, so the test kit and the hooks share them. Read/mutation comes from
// orthanc's own agent-manifest `kind`.

export type ManifestCommand = { path: string; kind?: string; auth?: string; input?: string }

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
const BRANCHLESS_MUTATION_PATHS = [
  'dataset create',
  'folder create',
  'folder move',
  'project create',
  'project create-from-template',
  'project update',
  'project add-orgs',
  'project remove-orgs',
  'cp',
  'resource delete',
  'resource restore',
  'resource add-markings',
  'resource remove-markings',
  'resource-role grant',
  'resource-role revoke',
]
const GLOBAL_BRANCH_PREFIX = 'agent/'
const DATASET_BRANCH_PREFIX = 'agent-'
const BRANCH_NAME_MAX_LEN = 64
const READ_VERBS = new Set([
  'get', 'list', 'search', 'describe', 'check', 'health', 'inspect',
  'preview', 'query', 'read', 'view', 'help', 'export', 'status', 'download',
])
export const DENIED_COMMANDS = new Set(['auth store', 'onboarding'])
// Orthanc `local` commands that only read local state.
const LOCAL_READS = new Set([
  'version', 'hello', 'agent-manifest', 'capabilities', 'completion show',
  'configure list', 'alias list', 'alias show', 'alias resolve', 'alias export',
])

export type GateClassification = {
  command: string | null
  kind: 'mutation' | 'branch-creation'
  isBranchScoped: boolean
  hasWorkingBranch: boolean
  targetsProtected: boolean
  isDestructive: boolean
  proposedName?: string
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

function argsHaveForce(args: readonly string[]): boolean {
  return args.some(arg => {
    const flag = arg.trim().toLowerCase().replace(/=.*$/, '')
    return flag === '--force' || flag === '-f'
  })
}

const isProtectedValue = (value: string) =>
  PROTECTED_BRANCHES.includes(value.trim().toLowerCase())

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

function targetsProtected(input: unknown, isOntology: boolean): boolean {
  if (typeof input === 'string') return isOntology && input.startsWith('ri.ontology.main.')
  if (Array.isArray(input)) {
    const flagPair = input.some((flag, index) => {
      const value = input[index + 1]
      return isBranchFlag(flag) && typeof value === 'string' && isProtectedValue(value)
    })
    return flagPair || input.some(item => targetsProtected(item, isOntology))
  }
  if (typeof input !== 'object' || input === null) return false
  return Object.entries(input).some(([key, value]) => {
    const field = key.replace(/^-+/, '').toLowerCase()
    const isBranchField = field === 'branch' || field === 'branchname' || field === 'branch_name'
    return (
      (isBranchField && typeof value === 'string' && isProtectedValue(value)) ||
      targetsProtected(value, isOntology)
    )
  })
}

function orthancClassification(
  command: string,
  args: readonly string[],
  rawInput: unknown,
  workingBranch: string | null,
): GateClassification {
  const base = {
    command,
    hasWorkingBranch: branchIsWorking(workingBranch),
    targetsProtected: targetsProtected(rawInput, command.startsWith('ontology ')),
  }
  if (!BRANCH_CREATION_PATHS.includes(command)) {
    return {
      ...base,
      kind: 'mutation',
      isBranchScoped: !BRANCHLESS_MUTATION_PATHS.includes(command),
      isDestructive: isDestructiveCommand(command) || argsHaveForce(args),
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

// Bash: the first `orthanc` token, then the longest manifest path (3..1
// words, no flags) after it; else group + verb when the group is known.
export function orthancInvocationFromShell(
  command: string,
  manifest: readonly ManifestCommand[],
): { path: string; args: string[] } | null {
  const tokens = command.split(/\s+/).filter(token => token !== '')
  const start = tokens.findIndex(
    token => token.split('/').at(-1)?.replace(/^!/, '').toLowerCase() === 'orthanc',
  )
  if (start < 0) return null
  const paths = new Set(manifest.map(entry => entry.path))
  for (let width = 3; width >= 1; width -= 1) {
    const window = tokens.slice(start + 1, start + 1 + width)
    if (window.length !== width || window.some(token => token.startsWith('-'))) continue
    const path = window.join(' ').toLowerCase()
    if (paths.has(path)) return { path, args: tokens.slice(start + 1 + width) }
  }
  const groups = new Set(manifest.map(entry => entry.path.split(' ')[0]))
  const rest = tokens.slice(start + 1).filter(token => !token.startsWith('-'))
  const group = rest[0]?.toLowerCase()
  if (group === undefined || !groups.has(group)) return null
  const verb = rest[1]
  return verb === undefined ? { path: group, args: [] } : { path: `${group} ${verb.toLowerCase()}`, args: rest.slice(2) }
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

/** Null: a read, or a tool outside the Foundry lane. Never reaches the ladder. */
export function classifyCall(
  tool: string,
  input: Record<string, unknown>,
  manifest: readonly ManifestCommand[],
  workingBranch: string | null,
): GateClassification | null {
  if (tool === ORTHANC_CLI) {
    const command = typeof input.command === 'string' ? input.command.trim().replace(/\s+/g, ' ') : ''
    if (command === '' || command === 'repository clone') return null
    if (classifyOrthancCommand(command, manifest) === 'read') return null
    const args = Array.isArray(input.args) ? input.args.map(String) : []
    return orthancClassification(command, args, input, workingBranch)
  }
  if (tool === 'Bash' && typeof input.command === 'string') {
    const found = orthancInvocationFromShell(input.command, manifest)
    if (found === null || found.path === 'repository clone') return null
    if (classifyOrthancCommand(found.path, manifest) === 'read') return null
    return orthancClassification(found.path, found.args, { command: found.path, args: found.args }, workingBranch)
  }
  if (PALANTIR_MCP.test(tool)) {
    const inner = tool.replace(PALANTIR_MCP, '')
    if (classifyMcpIntent(inner) === 'read') return null
    return {
      command: null,
      kind: 'mutation',
      isBranchScoped: false,
      hasWorkingBranch: branchIsWorking(workingBranch),
      targetsProtected: targetsProtected(input, true),
      isDestructive: inner.toLowerCase().split(/[^a-z]+/).includes('delete'),
    }
  }
  return null
}

export function ladderDecision(
  mode: ApprovalMode,
  classification: GateClassification,
  verdict?: GuardVerdict | null,
): LadderDecision {
  if (classification.kind === 'branch-creation') {
    if (classification.error) return { outcome: 'block', reason: classification.error }
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
  if (classification.isDestructive) {
    return { outcome: 'ask', reason: `destructive mutation '${command}' asks in every mode${note}` }
  }
  if (classification.targetsProtected && mode !== 'yolo') {
    return {
      outcome: 'ask',
      reason: `'${command}' targets a protected baseline (main/master branch or the production ontology)${note}`,
    }
  }
  if (mode === 'yolo') return { outcome: 'run', reason: 'yolo mode: no guardrails outside destructive paths' }
  if (mode === 'ask-always') return { outcome: 'ask', reason: `ask-always mode: mutation '${command}' waits for approval` }
  if (classification.isBranchScoped && !classification.hasWorkingBranch) {
    return {
      outcome: 'ask',
      reason: `'${command}' is branch-scoped but no working branch is tracked — create one with 'global-branch create' or approve running as-is`,
    }
  }
  if (mode === 'allow-edits') return { outcome: 'run', reason: 'allow-edits mode: non-protected mutations run' }
  if (!verdict) return { outcome: 'ask', reason: `'${command}': guard unavailable; failing closed to a human decision` }
  if (verdict.action === 'approve') return { outcome: 'run', reason: verdict.reason }
  return { outcome: 'ask', reason: `'${command}': ${verdict.reason}` }
}

export function modeGuidance(mode: ApprovalMode): string {
  return (
    `Foundry approval mode: ${mode}. Foundry mutations may surface an approval dialog for the ` +
    'operator: the call continues once approved; if the operator declines or no one can be asked, ' +
    'the call is blocked — report it, do not retry blindly.'
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
