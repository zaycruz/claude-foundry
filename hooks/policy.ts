// The approval ladder, the branch gate and the approval modes. Pure functions:
// no `$`, so the test kit and the hooks share them. Read/mutation comes from
// orthanc's own agent-manifest `kind`.

/** One option of a manifest command, as Orthanc's agent-manifest lists it. */
export type ManifestFlag = { flag: string; takesValue: boolean; default?: string }
export type ManifestCommand = { path: string; kind?: string; auth?: string; input?: string; flags?: ManifestFlag[] }

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
])
export const requiresBranch = (path: string) => BRANCH_REQUIRED_PATHS.has(path)
// Ontology writes Orthanc cannot branch: they change live data on main.
const MAIN_ONLY_WRITES = new Set(['ontology object-upsert', 'ontology object-upsert-batch', 'ontology action-apply-with-overrides'])
// Promotion into main is the operator's decision, not the agent's.
// A tag publishes a release from a commit, so it is promotion too.
const PROMOTIONS = new Set(['proposal merge', 'proposal accept', 'proposal approve', 'repository tag create'])
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
      const takesValue = !arg.includes('=') && !BOOLEAN_FLAGS.has(arg)
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
  if (command === 'repository push') {
    if (args.some(arg => unquote(arg).replace(/=.*$/, '').toLowerCase() === '--allow-default-branch')) {
      return "'repository push --allow-default-branch' pushes to the default branch. Push to a work branch and open a pull request."
    }
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
  if (isProtectedValue(branch)) return `'${command}' targets ${branch}. Agent work happens on branches, never on main or master.`
  if (command.startsWith('ontology ') && !branch.startsWith(GLOBAL_BRANCH_RID)) {
    return `'${command}' must target a global branch RID (ri.branch..branch.…), not '${branch}': only a global branch is provably not the main ontology branch.`
  }
  return null
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
    targetsProtected: targetsProtected(rawInput),
  }
  if (!BRANCH_CREATION_PATHS.includes(command)) {
    const refused = branchRuleReason(command, args)
    return {
      ...base,
      kind: 'mutation',
      isBranchScoped: BRANCH_REQUIRED_PATHS.has(command),
      isDestructive: isDestructiveCommand(command) || argsHaveForce(args),
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
 * executor both resolve through here, so they see the same command. */
export function resolveOrthancCommand(
  command: string,
  args: readonly string[],
  manifest: readonly ManifestCommand[],
): { path: string; args: string[] } {
  const words = command.trim().split(/\s+/).filter(word => word !== '')
  const paths = new Set(manifest.map(entry => entry.path))
  for (let width = words.length; width >= 1; width -= 1) {
    const path = words.slice(0, width).join(' ').toLowerCase()
    if (paths.has(path)) return { path, args: [...words.slice(width), ...args] }
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

/** One pass over a shell line as the shell reads it: the words of each simple
 * command, plus the command text the shell runs from inside words (`$(…)` and
 * backquotes in double quotes or an unquoted heredoc). Redirect targets and
 * heredoc bodies are data, not words. Single-quoted text stays literal. */
function shellWords(command: string): { segments: string[][]; code: string[] } {
  const segments: string[][] = []
  const code: string[] = []
  const heredocs: { delimiter: string; expands: boolean; tabs: boolean }[] = []
  let words: string[] = []
  let word = ''
  let quote: string | null = null
  let quoted = false
  let target: 'file' | 'heredoc' | 'heredoc-tabs' | null = null
  const endWord = () => {
    if (word !== '' || quoted) {
      if (target === 'heredoc' || target === 'heredoc-tabs') heredocs.push({ delimiter: word, expands: !quoted, tabs: target === 'heredoc-tabs' })
      else if (target === null) words.push(word)
      target = null
    }
    word = ''
    quoted = false
  }
  const endSegment = () => {
    endWord()
    target = null
    if (words.length > 0) segments.push(words)
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
      endSegment()
      index += 1
    } else if (char === '<' || char === '>' || (char === '&' && command[index + 1] === '>')) {
      endWord()
      let last = index
      while ('<>&|'.includes(command[last + 1] ?? ' ')) last += 1
      const operator = command.slice(index, last + 1)
      index = last
      if (command[last + 1] === '(') {
        // <(…) and >(…) run a command: read it as its own segment.
        endSegment()
        index += 1
      } else if (operator === '<<') {
        const tabs = command[last + 1] === '-'
        if (tabs) index += 1
        target = tabs ? 'heredoc-tabs' : 'heredoc'
      } else target = 'file'
    } else if (SHELL_OPERATORS.includes(char)) endSegment()
    else word += char
  }
  endSegment()
  return { segments, code }
}

const SHELLS = /^(sh|bash|zsh|dash|ksh|mksh|ash|fish|busybox)$/
// Heads whose following words are one command line the shell runs (eval, ssh host …).
const LINE_RUNNERS = new Set(['eval', 'ssh', 'watch', 'tmux', 'screen', 'parallel'])
const CODE_FLAG = /^-[A-Za-z]*[cS]$/
const NESTING_LIMIT = 3

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
export function commandSegments(command: string, depth = 0): string[][] {
  const { segments, code } = shellWords(command)
  const nested = [...code, ...segments.flatMap(codeWords)].filter(item => item.trim() !== '')
  if (nested.length === 0) return segments
  if (depth >= NESTING_LIMIT) return [...segments, ['$']]
  return [...segments, ...nested.flatMap(item => commandSegments(item, depth + 1))]
}

const basename = (word: string | undefined) => (word ?? '').split('/').at(-1)?.replace(/^!/, '') ?? ''
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const MENTIONS_ORTHANC = /(^|[^\w/.-])orthanc([^\w.-]|$)|ORTHANC_BIN/i
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

/** Where Orthanc starts in a segment: the command word, or the first orthanc
 * word after any head that can run another program (env, sudo, xargs, find
 * -exec, npx, ssh, `!`, …). -1 when the segment does not run Orthanc. */
function orthancStart(words: readonly string[]): number {
  let index = 0
  while (index < words.length && ASSIGNMENT.test(words[index]!)) index += 1
  if (index >= words.length) return -1
  if (isOrthancWord(words[index]!)) return index
  if (NON_EXECUTING.has(basename(words[index]))) return -1
  return words.findIndex((word, position) => position > index && isOrthancWord(word))
}

/** True when a segment runs Orthanc in a form the parser cannot read: a
 * variable or eval as the command, code passed to an interpreter, or an
 * Orthanc command stored in a variable. `command` is the whole shell line. */
function hidesOrthanc(words: readonly string[], command: string): boolean {
  if (!MENTIONS_ORTHANC.test(command)) return false
  let index = 0
  // Wrappers, their flags and the numbers they take (`timeout 5`, `nice -n 10`).
  while (index < words.length && (ASSIGNMENT.test(words[index]!) || WRAPPERS.has(basename(words[index])) || words[index]!.startsWith('-') || /^[0-9.]+[smhd]?$/.test(words[index]!))) {
    if (ASSIGNMENT.test(words[index]!) && MENTIONS_ORTHANC.test(words[index]!.replace(ASSIGNMENT, ''))) return true
    index += 1
  }
  const head = words[index]
  if (head === undefined) return false
  if (head.startsWith('$')) return true
  const rest = words.slice(index + 1)
  if (INDIRECT.has(head)) return rest.some(word => MENTIONS_ORTHANC.test(word))
  // A shell or interpreter with no script reads its code from stdin (`| sh`, `bash <<<`, a heredoc).
  if ((SHELLS.test(basename(head)) || CODE_RUNNERS.test(basename(head))) && rest.every(word => word.startsWith('-'))) return true
  // Interpreter code inline (`python3 -c "…orthanc…"`): a word holding code, or the one after -c/-e.
  return CODE_RUNNERS.test(basename(head)) &&
    rest.some((word, position) => MENTIONS_ORTHANC.test(word) && (/[\s()'"\[\];]/.test(word) || /^-(c|e|-eval)$/.test(rest[position - 1] ?? '')))
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

// Bash may read through Orthanc; every Orthanc write goes through orthanc_cli,
// where the branch rule and the ladder see its arguments as data, not shell.
function shellClassification(
  command: string,
  manifest: readonly ManifestCommand[],
  workingBranch: string | null,
): GateClassification | null {
  const refuse = (path: string | null, error: string): GateClassification => ({
    command: path,
    kind: 'mutation',
    isBranchScoped: false,
    hasWorkingBranch: branchIsWorking(workingBranch),
    targetsProtected: false,
    isDestructive: false,
    error,
  })
  for (const words of commandSegments(command)) {
    if (hidesOrthanc(words, command)) {
      return refuse(null, 'This shell command runs Orthanc in a form the Foundry guard cannot read (a variable, eval or interpreter code). Run Orthanc reads as plain `orthanc …` and writes with orthanc_cli.')
    }
    const start = orthancStart(words)
    if (start < 0) continue
    const call = orthancShellCall(words, start, manifest)
    if (call.path === '' && !call.help && /\$|`/.test(command)) {
      return refuse(null, 'This shell command builds an Orthanc command from a substitution or variable, which the Foundry guard cannot read. Run Orthanc reads as plain `orthanc …` and writes with orthanc_cli.')
    }
    if (call.help || call.path === '' || call.path === 'repository clone') continue
    if (!call.known) {
      return refuse(call.path, `Bash runs 'orthanc ${call.path}', which is not a command in Orthanc's agent manifest. Look it up with orthanc_help, then run it with orthanc_cli.`)
    }
    if (classifyOrthancCommand(call.path, manifest) === 'read') continue
    return refuse(call.path, `Orthanc writes run through orthanc_cli, where the branch rule and approval ladder apply, not Bash. Run '${call.path}' with orthanc_cli.`)
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

/** Null: a read, or a tool outside the Foundry lane. Never reaches the ladder. */
export function classifyCall(
  tool: string,
  input: Record<string, unknown>,
  manifest: readonly ManifestCommand[],
  workingBranch: string | null,
): GateClassification | null {
  if (tool === ORTHANC_CLI) {
    const raw = typeof input.command === 'string' ? input.command : ''
    const resolved = resolveOrthancCommand(raw, Array.isArray(input.args) ? input.args.map(String) : [], manifest)
    if (resolved.path === '' || resolved.path === 'repository clone') return null
    if (classifyOrthancCommand(resolved.path, manifest) === 'read') return null
    return orthancClassification(resolved.path, resolved.args, { ...input, args: resolved.args }, workingBranch)
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
// A loose mention (a relative foundry/…md path) is denied with a writer.
const SHELL_MENTION = /\bfound\S*\/\S*\.md/i
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
