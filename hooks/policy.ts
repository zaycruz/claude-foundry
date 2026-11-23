// The approval ladder, the branch gate and the approval modes. Pure functions:
// no `$`, so the test kit and the hooks share them. Read/mutation comes from
// orthanc's own agent-manifest `kind`.

/** One option of a manifest command, as Orthanc's agent-manifest lists it. */
export type ManifestFlag = { flag: string; takesValue: boolean; default?: string; values?: string[] }
export type ManifestCommand = {
  path: string
  kind?: string
  auth?: string
  input?: string
  /** Set when the command writes the operator's own credential store (orthanc names it `credential_store`). */
  credentialStore?: string
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
  // The schema writes orthanc 0.7.10 (#181) added beyond object, link and action
  // types, and the branch index of 0.7.7. Each one takes a branch and never
  // writes main (`--branch … required, never main`), so a call that names none
  // is an incomplete call, not a write with a default.
  'ontology interface-upsert',
  'ontology interface-delete',
  'ontology shared-property-upsert',
  'ontology shared-property-delete',
  'ontology type-group-upsert',
  'ontology type-group-delete',
  'ontology branch-index',
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
const DENIED_COMMANDS = new Set(['auth store', 'onboarding'])
// Orthanc names a command that takes a credential the operator types two ways:
// `input`, and `credential_store`, the store the command writes. An agent must
// never be the one to hand a credential over, so a marked command never runs.
// `credential_store` marks six commands in 0.7.10; four also name an `input`,
// and two only clear the store, so the ladder judges those as the deletes zay
// lets yolo run (2026-11-17). A marked command that is not one of the two is
// refused: the guard does not guess that an entry it has never seen types no
// secret. The names stay for a binary that ships the command with neither mark.
const CLEARS_CREDENTIALS = new Set(['auth delete', 'configure delete'])
export const isCredentialCommand = (command: ManifestCommand) =>
  DENIED_COMMANDS.has(command.path) ||
  command.input !== undefined ||
  (command.credentialStore !== undefined && !CLEARS_CREDENTIALS.has(command.path))

/** Where a typed credential belongs: said once, in both refusals and in /auth. */
export const CREDENTIAL_HINT = 'The operator runs it in their own terminal; /auth lists the credential commands.'
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
  /** Why it read as destructive: the word in its name, the flag it was given,
   * an enum value it was given, or `--force`. Carried into the ask and the debug
   * log, so the operator deciding the dialog and whoever reads the log later can
   * tell the four (`data-health check-group update --remove-check …` is not a
   * `project remove-orgs`). */
  destructiveWhy?: string
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

/**
 * A word that says the write leaves something gone or overwritten.
 *
 * The rule used to read one word, `delete`, and only in one position: the last
 * hyphen part of the last word of a command path. Measured on the orthanc 0.7.11 agent-manifest the plugin pins
 * (541 command names, 260 of them mutation or local): 25 writes the old rule
 * read, 51 carry a word in this table. The 26 it missed split two ways. 15
 * asked nobody outside yolo — `marketplace installation uninstall` ("the plan
 * previews what is deleted"), `streams stream reset` ("Clear all records from
 * the stream on a branch"), `dataset transactions abort` ("discard its
 * changes"), `devops draft abort` ("Drop a draft"), `alias clear` ("Delete all
 * saved aliases"), `alias remove`, the two `project …remove…`,
 * `repository imports remove`, `dev-console scope remove`,
 * `media-sets input-schema remove`, `connectivity code-import remove-importer`,
 * `data-health check replace`, `orchestration schedules replace`,
 * `admin org replace`. 11 more asked only with the `--apply` their
 * `operator_approval` condition names, so the same call without it ran:
 * `resource remove-markings`, `resource-role revoke`,
 * `global-branch remove-repo`, `global-branch remove-resources`,
 * `repository checks required remove`, `branch-protection repo unprotect`,
 * `admin marking replace`, `admin group member remove`, `workshop module
 * revert`, `solution-design node remove`, `solution-design edge remove`. The act
 * is the same; the ask is keyed on the act, not on the word orthanc chose.
 *
 * `purge`, `discard`, `destroy`, `truncate`, `wipe`, `erase`, `repair` and
 * `overwrite` name no command on 0.7.11: they cover a rename before the next
 * pin. `repair` and `overwrite` are the words the parity cycle of 2026-11-22
 * named for writes it saw planned; a sync-gap repair rewrites history, so its
 * plain form in the sentence the operator reads is 'rewritten'.
 *
 * Read on every word of a command path, and on a flag name
 * (`destructiveFlag`), split on anything that is not a letter or a digit, so
 * `resource permanently-delete`, `project remove-orgs`, `delete_object` and a
 * future `orthanc remove resource` all count. Measured on the 541 names of
 * 0.7.11, every destructive word sits in the last word of its path, so reading
 * the whole path asks nothing new today and covers a name that puts the verb
 * first. A positional or a branch name carries nothing, and so does a value
 * except where it is an enum written in caps (`--transaction-type DELETE`), the
 * way Orthanc writes its enumerated values: `--mode keep-outputs`,
 * `--branch delete-me` and `alias remove delete` say nothing about what the
 * write erases, and an option value that names the act (destructiveValue). Orthanc
 * declares the options of its writes in that manifest — 990 on 0.7.11, 573 of them
 * with a value, 17 of them with the values they accept — so the value lane is read
 * against the declaration where one exists. One over-read stays on purpose: a word
 * that starts with a hyphen is read as an option even where the option before it
 * takes a value (`--description "-remove the old rows"` asks). Orthanc may take that
 * word as the value or refuse it, the guard cannot tell from argv alone, and the two
 * answers cost different things: reading too much costs a prompt, reading too little
 * costs the ask.
 *
 * `set`, `update`, `add`, `close`, `cancel`, `pause` and `restore` stay out:
 * they change or stop something that is still there, and the `auto` guard
 * judges them. A `remove`, `revoke` or `unprotect` that only drops a reference
 * is in: it is the same word, and the guard cannot tell a reference from a
 * record.
 *
 * The table carries each word with what it leaves, in the plain form the
 * operator and the model are told, and `modeGuidance` builds its sentence from
 * that second column, so the wording an operator reads cannot fall behind the
 * rule that asked them (pinned by destructive.test.ts D11).
 */
export const DESTRUCTIVE_WORDS = [
  ['delete', 'deleted'],
  ['remove', 'removed'],
  ['uninstall', 'uninstalled'],
  ['purge', 'purged'],
  ['discard', 'discarded'],
  ['clear', 'cleared'],
  ['reset', 'reset'],
  ['revert', 'reverted'],
  ['replace', 'replaced'],
  ['repair', 'rewritten'],
  ['overwrite', 'overwritten'],
  ['truncate', 'truncated'],
  ['abort', 'aborted'],
  ['revoke', 'revoked'],
  ['unprotect', 'unprotected'],
  ['destroy', 'destroyed'],
  ['wipe', 'wiped'],
  ['erase', 'erased'],
] as const satisfies ReadonlyArray<readonly [string, string]>

const TERMS = new Set<string>(DESTRUCTIVE_WORDS.map(([term]) => term))

/** 'deleted, removed, …, destroyed or erased', for the guidance sentence. */
function destructiveWords(): string {
  const forms = DESTRUCTIVE_WORDS.map(([, form]) => form)
  return `${forms.slice(0, -1).join(', ')} or ${forms.at(-1)}`
}

/** The destructive word in a command path or a flag name, or null. One word per
 * run of letters and digits, so `-`, `_` and a space all split a name and the
 * leading `--` of a flag carries nothing: `permanently-delete`, `remove-orgs`,
 * `delete_object` and `--remove-check` all read. Case is ignored. An argument
 * reaches this only as a flag name, so a value, a positional or a branch name
 * carries nothing into the answer. */
export function destructiveTermIn(name: string): string | null {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? []
  return words.find(word => TERMS.has(word)) ?? null
}

/** A flag whose name says what the write removes: `--remove`, `--remove-check`,
 * `--remove-resource`, `--delete-project`, `--delete-object-type`. The flags are
 * not in the pinned snapshot, so this is measured against the binary the pin
 * names, and re-run that way before the pin moves:
 *
 *   gh release download v0.7.11 --repo zaycruz/orthanc --pattern '*linux-gnu.tar.gz*'
 *   tar xzf orthanc-x86_64-unknown-linux-gnu.tar.gz && ./orthanc --agent agent-manifest \
 *     | jq -r '.data.commands[] | .path as $p | .args[]? | [.flag] | @tsv' | sort -u
 *
 * On 0.7.11 six flag names carry a word: these five, and `--abort-on-failure`.
 * Three asked nobody (`--remove-check` on `data-health check-group update`,
 * `--remove-resource` on `devops draft set`, `--delete-project` on `marketplace
 * installation uninstall`). Two sit on a command Orthanc also marks
 * `operator_approval` (`--delete-object-type` on `global-branch deploy` and
 * `proposal merge`, `--remove` on `global-branch roles set` and `proposal
 * request-review`), so they asked with the marked flag given and ran without
 * it. Pinned as data in destructive.test.ts D13.
 * `--abort-on-failure` holds the word `abort` and erases nothing (it stops a
 * build when one job fails), so it reads as no claim; the exemption is by flag
 * name, not by command, because the name says the same thing wherever it
 * appears. Measured too: no `--no-…` flag of 0.7.11 holds a destructive word, so
 * the negation rule is for the next pin — a flag that denies what it names is
 * not a claim that the write erases.
 * The two negations that drop a protection (`--no-read-only`,
 * `--no-auto-protect-new-resources`) are marked `operator_approval` by Orthanc
 * and ask on that. */
const NON_DESTRUCTIVE_FLAGS = new Set(['--abort-on-failure'])

/** Whether `flag` names what the write removes. A flag shape, not one of the
 * exemptions, and a word of the table. */
function isDestructiveFlag(flag: string): boolean {
  return flag.startsWith('-') && !NON_DESTRUCTIVE_FLAGS.has(flag) && !flag.startsWith('--no-') && destructiveTermIn(flag) !== null
}

/** What one option of this call claims, as Orthanc declared it: its flag name,
 * the value it was given (null when it takes none), and the values it may take
 * (empty when the manifest lists none). */
type GivenFlag = { flag: string; value: string | null; values: readonly string[] }

/** Every option the call gave, read against the shapes the manifest declares for
 * this command. Orthanc's agent-manifest names the options of its writes — on
 * v0.7.11, 990 of them, 573 with a value, 417 without, and 10 commands with no
 * options at all — and `orthanc.ts` parses them into `ManifestCommand.flags`, so
 * the guard does not have to guess whether a hyphen-led word is a flag or someone's
 * value. `--flag=v` and `--flag v` are one call, including when the value starts with
 * a hyphen: the `=` form reads its remainder as an option too, so the two spellings
 * cannot ask differently. Two readings survive as a guess, both on the safe side: an
 * option the manifest does not name is still read as an option, and a word after a
 * flag whose shape is unknown is read as its value, so a pin that lost its args asks
 * more. One shape error asks less, and is worth knowing: an option that declares
 * `takes_value: false` owns no value, so the word after it is never read as one. */
function givenFlags(args: readonly string[], shapes: ReadonlyMap<string, ManifestFlag>): GivenFlag[] {
  const given: GivenFlag[] = []
  for (let index = 0; index < args.length; index += 1) {
    const text = unquote(args[index]!).trim()
    if (!text.startsWith('-')) continue
    const equals = text.indexOf('=')
    const flag = flagNameOf(text)
    const shape = shapes.get(flag)
    let value: string | null = null
    if (equals > 0) value = unquote(text.slice(equals + 1)).trim()
    else if (shape ? shape.takesValue : args[index + 1] !== undefined && !unquote(args[index + 1]!).trim().startsWith('-')) {
      value = unquote(args[index + 1] ?? '').trim()
      // `-f` shortening swallows its value (`-fvalue`), and a flag with no shape
      // and no next word owns nothing.
      if (value.startsWith('-') || value === flag) value = ''
      else index += 1
    }
    given.push({ flag, value, values: shape?.values ?? [] })
    // A value that starts with a hyphen is also an option as far as this rule is
    // concerned, so `--flag=-remove the old rows` asks where `--flag -remove the old
    // rows` asks. One spelling asking and the other silent would be a hole a caller
    // could fall into by accident.
    if (value !== null && value.startsWith('-')) given.push({ flag: value, value: null, values: [] })
  }
  return given
}

/** The flag whose name says what the write removes: `--remove`, `--remove-check`,
 * `--remove-resource`, `--delete-project`, `--delete-object-type`. */
function destructiveFlag(given: readonly GivenFlag[]): string | null {
  return given.find(entry => isDestructiveFlag(entry.flag))?.flag ?? null
}

/** An option value that names the act. Two spellings count, and the pinned surface
 * carries one of each.
 *
 * A value equal to one of the values the manifest lists for that option, when that
 * value is a word of the table: `dataset transactions start --transaction-type
 * DELETE` (its options are APPEND, UPDATE, SNAPSHOT, DELETE; the pinned entry is a
 * plain `mutation` with no `operator_approval`), and the same enum written in lower
 * case, which `marketplace installation uninstall --mode delete` really is — so
 * case is not what decides here, the declaration is. Without it, the word could only
 * be guessed from how a value looks, and a name is written every way there is.
 *
 * A value written in all caps that equals a word of the table, where the option
 * declares no values of its own: that is how Orthanc spells an enumerated value, and
 * it is not how anyone spells a name, so `--branch delete-me`, a build whose `--job`
 * is called `revert`, and a dataset called `remove` stay no claim. A caps name a
 * person chose (`--branch DELETE`) does ask, which is the safe side of that guess.
 *
 * The cue is built from the declared spelling and the flag, so no model-written text
 * reaches the dialog through this lane. What is left unread: a word in a positional
 * (a dataset RID, a schedule id) or in a value Orthanc does not enumerate, which is
 * 973 of its 990 options. A caller who erases through such a value is judged by the
 * command name, the `--force` rule, or the `auto` guard. */
function destructiveValue(given: readonly GivenFlag[]): string | null {
  for (const { flag, value, values } of given) {
    if (value === null || value === '') continue
    const word = value.toLowerCase()
    if (!TERMS.has(word)) continue
    const declared = values.some(allowed => allowed.toLowerCase() === word)
    if (declared || /^[A-Z]+$/.test(value)) return `${displayTrigger(flag)}=${values.find(allowed => allowed.toLowerCase() === word) ?? value}`
  }
  return null
}

/** The declared shapes of one command's options, by flag name. */
function flagShapes(entry: ManifestCommand | undefined): Map<string, ManifestFlag> {
  const shapes = new Map<string, ManifestFlag>()
  for (const shape of entry?.flags ?? []) shapes.set(shape.flag.toLowerCase(), shape)
  return shapes
}

/** Why a write reads as destructive, in the words the operator is told: a word
 * in the command name, a flag that names what the write removes, an option value
 * that names it, or `--force`. The answer goes into the approval dialog, the
 * debug log and the trace, and an argument is text a model wrote, so a flag is
 * shown as written only when it is spelled like a flag. Anything else is JSON
 * escaped and cut — the same contract `operatorApprovalQuestion` keeps, where a
 * newline in an arg would otherwise forge lines in the question a human
 * answers. */
function destructiveTrigger(command: string, args: readonly string[], entry: ManifestCommand | undefined): string | null {
  const word = destructiveTermIn(command)
  if (word !== null) return word
  const given = givenFlags(args, flagShapes(entry))
  const flag = destructiveFlag(given)
  if (flag !== null) return displayTrigger(flag)
  const value = destructiveValue(given)
  if (value !== null) return value
  return argsHaveForce(command, args) ? '--force' : null
}

const SHOWN_FLAG = /^--?[a-z0-9][a-z0-9-]*$/
const SHOWN_MAX = 80

function displayTrigger(flag: string): string {
  // Cut the argument first, on code points, then escape: cutting escaped text
  // can split a `\n` or a surrogate pair and leave half an escape in the dialog.
  const chars = Array.from(flag)
  const cut = chars.length > SHOWN_MAX ? `${chars.slice(0, SHOWN_MAX).join('')}…` : flag
  return SHOWN_FLAG.test(cut) ? cut : JSON.stringify(cut)
}

/** One arg as the flag it names, in any case, with or without a `=value`
 * (`--FORCE` and `--force=true` both read as `--force`). Over-matching only
 * asks more. */
function flagNameOf(arg: string): string {
  return unquote(arg).trim().toLowerCase().replace(/=.*$/, '')
}
/** True when any arg names one of these flags, in any case, with or without a
 * `=value` (`--force`, `--APPLY`, `--apply=true`). Over-matching only asks more. */
function argsNameFlag(args: readonly string[], names: readonly string[]): boolean {
  return args.some(arg => names.includes(flagNameOf(arg)))
}

// The local commands where -f is --force. Elsewhere -f is --format or --folder.
const SHORT_FORCE = new Set(['configure', 'configure profile create', 'configure delete', 'alias add', 'onboarding'])

function argsHaveForce(command: string, args: readonly string[]): boolean {
  return argsNameFlag(args, SHORT_FORCE.has(command) ? ['--force', '-f'] : ['--force'])
}

// A flag as the manifest may list it in when_all_flags.
const APPROVAL_FLAG = /^--?[a-z0-9][a-z0-9-]*$/i
const QUESTION_ARGS_MAX = 600

/** An `operator_approval` value the guard reads: `"always"` or
 * `{when_all_flags: [flags]}`, nothing else. Anything else is null: the guard
 * then asks on every call (operatorApprovalQuestion), and the manifest
 * snapshot test fails (orthanc-snapshot.test.ts). */
export type ApprovalCondition = { kind: 'always' } | { kind: 'flags'; flags: string[] }

export function readApprovalCondition(value: unknown): ApprovalCondition | null {
  if (value === 'always') return { kind: 'always' }
  const condition = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  const flags = condition?.when_all_flags
  if (
    condition !== null &&
    Object.keys(condition).length === 1 &&
    Array.isArray(flags) &&
    flags.length > 0 &&
    flags.every(flag => typeof flag === 'string' && APPROVAL_FLAG.test(flag))
  ) {
    return { kind: 'flags', flags: (flags as string[]).map(flag => flag.toLowerCase()) }
  }
  return null
}

/** The every-mode question for a call whose manifest entry carries
 * `operator_approval`, or null. `{when_all_flags: [...]}` asks when every
 * listed flag is given (argsNameFlag: any case, `=value`, any order);
 * `"always"` asks on every call. Anything else is unreadable and asks on every
 * call: a condition the guard cannot read never lets a call through. */
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
  const condition = readApprovalCondition(value)
  if (condition === null) {
    return ask("Orthanc's agent manifest marks it operator_approval in a form the Foundry guard cannot read, so it asks on every call.")
  }
  if (condition.kind === 'always') return ask("Orthanc's agent manifest marks it operator_approval.")
  const listed = condition.flags
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

/** An `operator_approval_scope` value the guard reads (orthanc CONTRACTS.md,
 * SRC-15): `"always"`, `"work-branch"`, or `{work_branch_flag, flag_aliases?}`
 * with each flag a `--long-flag`. Anything else, a missing scope included, is
 * null: the guard reads it as `"always"` and asks, and the manifest snapshot
 * test fails (orthanc-snapshot.test.ts). */
export type ApprovalScope = { kind: 'always' } | { kind: 'work-branch' } | { kind: 'flag'; flags: string[] }

export function readApprovalScope(scope: unknown): ApprovalScope | null {
  if (scope === 'always') return { kind: 'always' }
  if (scope === 'work-branch') return { kind: 'work-branch' }
  if (typeof scope !== 'object' || scope === null || Array.isArray(scope)) return null
  const record = scope as Record<string, unknown>
  if (!Object.keys(record).every(key => key === 'work_branch_flag' || key === 'flag_aliases')) return null
  const flag = record.work_branch_flag
  const aliases = record.flag_aliases ?? []
  if (typeof flag !== 'string' || !SCOPE_FLAG.test(flag)) return null
  if (!Array.isArray(aliases) || !aliases.every(alias => typeof alias === 'string' && SCOPE_FLAG.test(alias))) return null
  return { kind: 'flag', flags: [flag, ...(aliases as string[])] }
}

/** True only when the entry's operator_approval_scope (orthanc #118) shows
 * that this call lands on one global work branch, never on main:
 * `"work-branch"` with a global branch RID among the positionals and nothing
 * naming main, or `{work_branch_flag, flag_aliases?}` with that flag (or an
 * alias) holding one global branch RID. `"always"`, a missing or unreadable
 * scope, or an unreadable operator_approval, is false: yolo then asks. */
export function approvalOnWorkBranch(path: string, args: readonly string[], manifest: readonly ManifestCommand[]): boolean {
  const entry = manifest.find(found => found.path === path)
  if (entry === undefined || readApprovalCondition(entry.operatorApproval) === null) return false
  const scope = readApprovalScope(entry.operatorApprovalScope)
  if (scope === null || scope.kind === 'always') return false
  if (scope.kind === 'work-branch') {
    // Every word that is not a flag counts, whatever flag comes before it: the
    // guard does not know which flags take a value (`--yes main`).
    const words = args.filter(arg => !unquote(arg).startsWith('-'))
    return (
      words.some(arg => WORK_BRANCH_RID.test(arg)) &&
      !words.some(arg => isProtectedValue(unquote(arg))) &&
      !flagValues(args.map(arg => arg.toLowerCase()), BRANCH_FLAGS).some(isProtectedValue)
    )
  }
  return oneWorkBranchFlag(args, scope.flags)
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
    const trigger = destructiveTrigger(command, args, manifest.find(entry => entry.path === command))
    return {
      ...base,
      kind: 'mutation',
      isBranchScoped: BRANCH_REQUIRED_PATHS.has(command),
      isDestructive: trigger !== null,
      ...(trigger === null ? {} : { destructiveWhy: trigger }),
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
// The operator that ended a segment: 'fail' for `||`, the next command runs only
// when this one failed - which is what a wait that timed out does, so both are
// still paid for; 'arm' for a `case` arm's `;;` and the pattern that opens the
// next, the arms run instead of each other and only one is ever chosen; 'pipe'
// for `|`, the next command runs alongside this one; 'bg' for `&`, this command
// is left running and the line answers at once.
// Absent: the next command runs after this one (`&&`, `;`, a newline).
export type ShellJoin = 'fail' | 'arm' | 'pipe' | 'bg'

export type Segment = { words: string[]; fed: boolean; split: boolean; join?: ShellJoin }

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
  // `split` marks a segment whose command continues inside a substitution, so
  // its words are not the whole call; `join` says how the next command relates
  // to this one ('alt' for ||, 'pipe' for |, 'bg' for a job left running).
  // After `;;` the next words are the next `case` arm's pattern, up to its `)`:
  // they run nothing, and the arm they name runs instead of the arm before it.
  let armPattern = false
  const endSegment = (operator: '\n' | '$(' | '`' | '<(' | '&&' | '||' | ';;' | '|' | '&' | '' = '') => {
    endWord()
    target = null
    // A `)` closing a `case` arm's pattern is the arm's own separator: the words
    // before it name a match, they do not run, and the arm is an alternative to
    // the arm before it.
    const arm = operator === ')' && armPattern
    const join: ShellJoin | undefined =
      operator === '||' ? 'fail' : operator === ';;' || arm ? 'arm' : operator === '|' ? 'pipe' : operator === '&' ? 'bg' : undefined
    armPattern = operator === ';;' ? true : operator === ')' ? false : words.length > 0 ? false : armPattern
    if (words.length > 0) segments.push({ words, fed: false, split: operator === '$(' || operator === '`', join })
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
      endSegment('\n')
      index = skipHeredocs(index)
    } else if (/\s/.test(char)) endWord()
    else if (char === '$' && command[index + 1] === '(') {
      endSegment('$(')
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
    } else if (SHELL_OPERATORS.includes(char)) {
      // `&&`, `||` and `;;` are one operator each: the first runs the two
      // commands in sequence, the second runs the right one only when the left
      // one failed (a timed-out wait does fail, so both are still paid for), and
      // `;;` closes a `case` arm, so only one arm ever runs.
      if ((char === '&' || char === '|' || char === ';') && command[index + 1] === char) {
        index += 1
        endSegment(char === '&' ? '&&' : char === '|' ? '||' : ';;')
      } else endSegment(char === '`' || char === ')' || char === '|' || char === '&' ? char : '')
    }
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

// One Orthanc call a shell line runs, in the order the shell runs them.
type ShellCall =
  // A segment that runs Orthanc where the guard cannot read it (a variable, eval
  // or interpreter code): what it runs is unknown, so neither the ladder nor a
  // timer has anything to judge.
  | { hides: true }
  | {
      hides: false
      /** The manifest entry the words name; null when they name none. */
      entry: ManifestCommand | null
      /** Every word after the binary: the positionals and the flags, what cliWait reads. */
      args: string[]
      path: string
      known: boolean
      help: boolean
      /** The segment ended at a substitution: the call continues inside it. */
      split: boolean
      /** How many times the shell runs this command: over 1 inside a counted loop. */
      times: number
      /** How this command relates to the one before it, or 'unknown' when its
       * arguments continue inside a substitution the guard cannot read. */
      join: ShellCallJoin
    }

// Where a command sits against the one before it, for the timer that has to hold
// them all (hooks/process.ts coverShellWaits): 'seq' and 'fail' both pay for the
// wait, 'arm' and 'pipe' stand in for one another, 'bg' is not waited for, and
// 'unknown' is a call whose arguments the guard could not read.
export type ShellCallJoin = 'seq' | 'fail' | 'arm' | 'pipe' | 'bg' | 'unknown'

// `if … then A; else B; fi` runs one arm: the segment that opens with `else` or
// `elif` is an alternative to what came before it.
function joinOf(segment: Segment, index: number, segments: readonly Segment[]): ShellCallJoin {
  if (segment.split) return 'unknown'
  if (segment.join === 'bg') return 'bg'
  const before = index > 0 ? segments[index - 1]! : undefined
  if (before?.split) return 'unknown'
  return before?.join ?? 'seq'
}

const LOOP_HEADS = new Set(['for', 'while', 'until', 'select'])
// A `for x in a b c` list the guard can count; `$(ls)`, `*.json` and `$@` it cannot.
const PLAIN_WORD = /^[\w.@:+,-]+$/

/**
 * How many times each segment's command runs: 1 outside a loop, and inside a
 * `for … in a b c` body, the count of its literal list (nested loops multiply).
 * A `while`/`until` body, and a list built from a substitution or a glob, counts
 * once: the guard cannot say how often it runs, and a wait that runs past the
 * raised timeout is stopped by the host exactly as it was before this cover.
 */
function loopCounts(segments: readonly Segment[]): number[] {
  const open: number[] = []
  const counts: number[] = []
  for (const { words } of segments) {
    const head = words.find(word => !ASSIGNMENT.test(word)) ?? ''
    if (LOOP_HEADS.has(basename(head))) {
      const at = words.indexOf('in')
      const list = at < 0 ? [] : words.slice(at + 1).filter(word => word !== 'do')
      open.push(list.length > 0 && list.every(word => PLAIN_WORD.test(word)) ? list.length : 1)
      counts.push(1)
      continue
    }
    // Only a `done` in command position closes a body: `checks wait rid done` is
    // an argument, and treating it as the terminator would drop the multiplier.
    const closes = basename(words[0]) === 'done'
    counts.push(closes ? 1 : open.reduce((product, count) => product * count, 1))
    if (closes) open.splice(-1, 1)
  }
  return counts
}

/** The Orthanc calls a Bash command runs, unreadable ones marked where they sit. */
function shellCalls(command: string, manifest: readonly ManifestCommand[]): ShellCall[] {
  const segments = commandSegments(command)
  // The first words of the manifest paths: what can follow `orthanc` as a call.
  const groups = new Set(manifest.map(entry => entry.path.toLowerCase().split(/\s+/)[0] ?? ''))
  // Every value the line assigns to each variable, at any position (`export X=…`, `env X=… cmd`).
  const assignments = new Map<string, string[]>()
  for (const word of segments.flatMap(segment => segment.words)) {
    const assigned = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s.exec(word)
    if (assigned) assignments.set(assigned[1]!, [...(assignments.get(assigned[1]!) ?? []), assigned[2]!])
  }
  const calls: ShellCall[] = []
  const counts = loopCounts(segments)
  segments.forEach((segment, index) => {
    const { words } = segment
    if (hidesOrthanc(segment, command, assignments, groups)) {
      calls.push({ hides: true })
      return
    }
    const start = orthancStart(segment, groups)
    if (start < 0) return
    const call = orthancShellCall(words, start, manifest)
    calls.push({
      hides: false,
      entry: manifest.find(entry => entry.path === call.path) ?? null,
      args: words.slice(start + 1),
      ...call,
      split: segment.split,
      times: counts[index] ?? 1,
      join: joinOf(segment, index, segments),
    })
  })
  return calls
}

/**
 * What the Orthanc calls a Bash command runs, as the manifest describes them,
 * with the words after the binary and how often the shell runs each. The Bash
 * tool holds its own timer over them;
 * register.tsx turns these into waits and covers that timer (hooks/process.ts).
 * A command with no readable Orthanc call, or one the guard cannot read, brings
 * nothing: the guard answers those before the timer is read.
 */
export function shellOrthancCalls(command: string, manifest: readonly ManifestCommand[]): { command: ManifestCommand; args: string[]; times: number; join: ShellCallJoin }[] {
  return shellCalls(command, manifest).flatMap(call =>
    call.hides || !call.known || call.help || call.entry === null ? [] : [{ command: call.entry, args: call.args, times: call.times, join: call.join }],
  )
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
  for (const call of shellCalls(command, manifest)) {
    if (call.hides) {
      return refuse(null, 'This shell command runs Orthanc in a form the Foundry guard cannot read (a variable, eval or interpreter code). Run Orthanc reads as plain `orthanc …` and writes with orthanc_cli.')
    }
    if (call.path === '' && !call.help && call.split) {
      return refuse(null, 'This shell command builds an Orthanc command from a substitution or variable, which the Foundry guard cannot read. Run Orthanc reads as plain `orthanc …` and writes with orthanc_cli.')
    }
    if (call.help || call.path === '' || call.path === 'repository clone') continue
    if (!call.known) {
      return refuse(call.path, `Bash runs 'orthanc ${call.path}', which is not a command in Orthanc's agent manifest. Look it up with orthanc_help, then run it with orthanc_cli.`)
    }
    // Before the read short-circuit, and with no second gate behind it: Bash is
    // the one lane where a secret could still be piped in.
    if (call.entry !== null && isCredentialCommand(call.entry))
      return refuse(call.path, `'orthanc ${call.path}' needs a credential the operator types, so neither Bash nor orthanc_cli runs it. ${CREDENTIAL_HINT}`)
    // The manifest entry this call names, read once: the wait timer below
    // (shellOrthancCalls) judges the same entry the ladder judged here.
    if (classifyOrthancCommand(call.path, manifest) === 'read' && call.entry?.operatorApproval === undefined) continue
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
  // A destructive word outranks a read word: `get_uninstall_plan` names an
  // uninstall, and a read that reads as a write only costs a refusal.
  if (words.some(word => WRITE_WORDS.has(word)) || destructiveTermIn(inner) !== null) return 'write'
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
    const mcpWord = destructiveTermIn(inner)
    if (classifyMcpIntent(inner) === 'read') return null
    // No `destructiveWhy` here: this lane never asks, it refuses, and the refusal
    // below is the whole answer the operator and the model get.
    return {
      command: null,
      kind: 'mutation',
      isBranchScoped: false,
      hasWorkingBranch: branchIsWorking(workingBranch),
      targetsProtected: targetsProtected(input),
      // A Palantir MCP write is blocked either way (Orthanc is the only write
      // path). The word is read here so a tool named for one of the 18 acts is
      // judged as a write: at the base only `delete` and `remove` were, so
      // `mcp__palantir__purge_resources` answered 'read' and was let through with
      // no classification at all. The cost is the other direction — a read whose
      // name carries such a word is refused and told to use orthanc_cli — which
      // costs a turn, not a row, and is pinned in destructive.test.ts D10.
      isDestructive: mcpWord !== null,
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
      reason:
        `yolo mode: '${command}' writes main (it names main, master or HEAD as its branch, or works on main only, or starts a stored schedule or import that may build main). It runs only if the operator approves; otherwise pass a work branch.` +
        (classification.destructiveWhy ? ` It is also destructive (${classification.destructiveWhy}).` : ''),
    }
  }
  if (mode === 'yolo')
    return {
      outcome: 'run',
      reason: classification.destructiveWhy
        ? `yolo mode: nothing else asks; this write is destructive (${classification.destructiveWhy}) and runs with no ask`
        : 'yolo mode: nothing else asks; work stays on branches that are not main',
    }
  if (classification.isDestructive) {
    // Both claims are kept: outside yolo a write that is destructive *and* names
    // main asks once, and the operator reads why it cannot be waved through.
    const also = classification.targetsProtected ? ', and it writes main' : ''
    return { outcome: 'ask', reason: `destructive mutation '${command}' (${classification.destructiveWhy}) asks in every mode but yolo${also}${note}` }
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
      ? `Foundry approval mode: yolo. Nothing asks the operator except a write on main: a destructive write (one that leaves something ${destructiveWords()} by its name, a flag, or a flag value, or one given --force) runs at once, ` +
        'and the loop guard is off. A write that names main or master as its branch asks the operator; ' +
        'so does a release tag (repository tag create --apply) with no --branch <global branch RID>, and a write the agent manifest ' +
        'marks operator_approval (such as turning branch protection off) unless its operator_approval_scope shows it lands on one global work branch. ' +
        'If the operator declines or no one can be asked, it is blocked. Pass a work branch instead.'
      : 'Writes the agent manifest marks operator_approval, such as turning branch protection off, also ask the operator. ' +
        `A mutation is destructive, and asks the operator outside yolo, when its command name or one of its flags says something is ${destructiveWords()}, ` +
        'when a value a flag takes names such an act, either among the values Orthanc lists for that flag (`dataset transactions start --transaction-type DELETE`) or spelled in caps the way Orthanc spells an enumerated value, ' +
        'or when it is given --force. ' +
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
