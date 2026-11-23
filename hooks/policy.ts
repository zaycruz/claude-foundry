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
// An ontology scenario (orthanc 0.7.9, SRC-85) is a what-if fork whose base is
// main unless the call names one global branch: `ontology scenario create` says
// "Make a scenario on main (or on --base-branch)", and orthanc CONTRACTS.md
// keeps that base for the scenario's life. Its branch spelling is --base-branch,
// not --branch, so no other rule here sees it: without this, yolo ran a
// scenario based on main, `--base-branch main` included. Without --apply the
// command prints a plan and writes nothing, so it asks no one (as a release tag
// plan does). `ontology scenario rebase` is left alone: it edits the scenario it
// names, never its base.
const BASE_BRANCH_WRITES = new Set(['ontology scenario create'])
const BASE_BRANCH_FLAGS = ['--base-branch']
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
// A promotion into main through a proposal: a merge, an accept, an approval, a
// deploy or a pull-request merge. It is not a direct write to main — the
// proposal is — so it is not refused (zay, 2026-11-20: "the default fde mode
// should be able to do whatever it wants on a branch and raise the proposal and
// merge the proposal, just nothing direct against main or master"). Yolo runs
// one with no ask; every other mode follows the ladder, where the manifest's
// operator_approval marks ask. A release tag is not here: it asks outside yolo.
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
// Two commands hand a value to whoever runs them, and through a tool the agent is
// whoever runs them. `repository git-credential get` answers with the active
// profile's token (`password=…`, under --agent too: measured on the v0.7.11 binary,
// hooks/operator-handoff.test.ts); `compute env get` writes one environment
// variable's value to a new 0600 file or to the clipboard, and a file the agent
// names is a file the agent reads back. Orthanc marks both `kind: read-only`, so
// the read short-circuit below would run either one in every mode with no question,
// and README's promise that a token never passes through Claude would be false.
// They are refused, not asked: an approval would not make the value safe for the
// agent to hold, and the operator has a terminal. A name Orthanc renames simply
// stops matching; hooks/orthanc-snapshot.json holds the entries these names and
// kinds came from.
const OPERATOR_ONLY_COMMANDS: Readonly<Record<string, string>> = {
  'repository git-credential':
    "answers with the active profile's token (`password=…`), which git uses to fetch, push and pull; a token never passes through Claude",
  'compute env get':
    'writes the value of one environment variable of a compute module to a new file or to the clipboard, which is how the operator gets a value the command never prints',
}

/** Why this command is the operator's to run, or null. One sentence the agent can act on. */
export function operatorOnlyReason(path: string): string | null {
  // hasOwnProperty, not a plain read: `path` can be any text the agent typed
  // (`command` is free-form in orthanc_cli's schema, and a name the manifest
  // does not know reaches here unresolved), so 'constructor' or '__proto__'
  // would otherwise read an inherited Object.prototype member and print it back
  // as the reason. hooks/operator-handoff.test.ts Q9.
  if (!Object.prototype.hasOwnProperty.call(OPERATOR_ONLY_COMMANDS, path)) return null
  const why = OPERATOR_ONLY_COMMANDS[path]
  return `'orthanc ${path}' is the operator's to run: ${why}. Run it in your own terminal.`
}
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
  /** True for a promotion into main through a proposal (merge, accept, approve, deploy, pull-request merge): not a direct write to main, so yolo runs it with no ask. */
  promotion?: true
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
    // After `--` every word is a positional, so nothing there names a branch.
    if (arg === '--') return false
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

/** True when the entry says this command can print a plan instead of writing: it
 * declares `--apply`. An entry that lists no flags (an older orthanc, a partial
 * manifest) says nothing either way, and is treated as one that can, as every
 * command this rule covers does. An entry that lists flags and none is
 * `--apply` writes on every call, so the base rule applies to it on every call. */
function canPlan(entry: ManifestCommand | undefined): boolean {
  if (entry?.flags === undefined || entry.flags.length === 0) return true
  return entry.flags.some(flag => typeof flag.flag === 'string' && flag.flag.toLowerCase() === '--apply')
}

/** True only when one `--base-branch` holds one global branch RID and nothing in
 * the call could have taken that word for something else. Two shapes hide a base
 * there: everything after `--` is a positional (oneWorkBranchFlag refuses it),
 * and pflag binds a value-taking flag's value before it looks for the next flag,
 * so `--description --base-branch <rid>` sets a description and leaves the base
 * main. The manifest prices each flag of the command; a flag the entry does not
 * list may take a value, so the call is unproven and asks. */
function baseBranchOnWorkBranch(args: readonly string[], entry: ManifestCommand | undefined): boolean {
  if (!oneWorkBranchFlag(args, BASE_BRANCH_FLAGS)) return false
  const priced = new Map(
    (entry?.flags ?? [])
      .filter(flag => typeof flag.flag === 'string')
      .map(flag => [flag.flag.toLowerCase(), flag.takesValue] as [string, boolean]),
  )
  for (let index = 1; index < args.length; index += 1) {
    const previous = unquote(args[index - 1] ?? '').toLowerCase()
    // `--flag=value` binds its own value, so nothing follows it that could be swallowed.
    if (!previous.startsWith('-') || previous.includes('=')) continue
    if (priced.get(previous.split('=')[0] ?? '') === false) continue
    // The value it took may be the `=` spelling of the base flag.
    const current = (unquote(args[index] ?? '').toLowerCase().split('=')[0] ?? '').replace(/^-+/, '')
    if (BASE_BRANCH_FLAGS.some(flag => flag.replace(/^-+/, '') === current)) return false
  }
  return true
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

/** What `configure list` says about the stack a call would run on (v0.7.8). */
export type StackMark = { name: string; readOnly: boolean | null }

/** How orthanc matches a profile name (profiles.rs canonical_name): lowercase
 * alphanumerics, every other character `_`, so `RO-Test` finds the mark of `ro_test`. */
export const canonicalProfileName = (name: string): string =>
  name
    .toLowerCase()
    .split('')
    .map(character => (/[a-z0-9]/.test(character) ? character : '_'))
    .join('')

/** Orthanc's per-profile read-only mark, read: true, false, or null when the
 * entry carries something unreadable where the mark belongs. No mark at all is
 * false: a binary older than 0.7.8 has none, and it judged no write before. */
export function profileReadOnlyMark(entry: Record<string, unknown>): boolean | null {
  if (!('read_only' in entry)) return false
  const mark = entry.read_only
  return typeof mark === 'boolean' ? mark : null
}

/** True for `configure profile set <name> --no-read-only`: the clear of the mark. */
export const clearsReadOnlyMark = (path: string, args: readonly string[]) =>
  path === 'configure profile set' && argsNameFlag(args, ['--no-read-only'])

/** The stack a `configure profile set <name> …` aims at: orthanc reads the first
 * positional as the profile name (configure_profile_set.rs ProfileSetArgs). ''
 * when the call names none, so a caller falls back to the active stack. */
const readOnlyMarkTarget = (args: readonly string[]): string => {
  for (const arg of args) {
    const word = unquote(arg).trim()
    if (word !== '' && !word.startsWith('-')) return word
  }
  return ''
}

// The call as an operator sees it, in an approval question or a refusal.
const CALL_MAX = 600

/** `path arg arg`, safe to put in front of a human: control characters are
 * escaped, so an argument cannot forge lines in an approval question (the shape
 * the operator_approval question already uses), and a long inline schema is cut
 * instead of echoed on every attempt. */
export function shownCall(path: string, args: readonly string[]): string {
  const text = [path, ...args.map(arg => unquote(arg))].join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  const cut = text.length <= CALL_MAX ? text : `${text.slice(0, CALL_MAX)}… (+${text.length - CALL_MAX} more chars)`
  return JSON.stringify(cut).slice(1, -1)
}

/** A stack name in the same shape: an argument picks the name the operator reads, so
 * it goes through the same escape and cap as the call beside it. */
const shownName = (name: string): string => shownCall('', [name])

/**
 * The call's `--apply` as orthanc's own gate reads it (read_only_gate.rs:
 * `apply != Some(false)`).
 *  - false: the command declares the plain `--apply` flag and it is absent, or
 *    set false (`--apply=false`, `--apply=0|no|off`): a plan, which changes
 *    nothing and prints the request instead.
 *  - true: `--apply` or `--apply=true|1|yes`: the change goes to Foundry.
 *  - null, which reads as "will write": the entry declares no `--apply` flag, or
 *    one that takes a value (orthanc RO14 reads that as no flag), so the command
 *    writes the moment it starts. An empty `--apply=` reads as a write too.
 */
function appliesValue(entry: ManifestCommand | undefined, args: readonly string[]): boolean | null {
  const declared = entry?.flags?.find(flag => unquote(flag.flag).trim().toLowerCase() === '--apply')
  if (declared === undefined || declared.takesValue) return null
  let applied = false
  for (const arg of args) {
    const word = unquote(arg).trim().toLowerCase()
    if (word === '--apply') applied = true
    else if (word.startsWith('--apply=')) {
      const value = word.slice('--apply='.length)
      applied = !['false', '0', 'no', 'off'].includes(value)
    }
  }
  return applied
}

/**
 * Whether the call would write, on orthanc's own rule (`would_write`,
 * read_only_gate.rs, CONTRACTS.md "Read-only profiles"). Four rules, in
 * orthanc's order, and nothing else:
 *  1. no manifest entry for the path: a write (RO15);
 *  2. kind `read-only` or `local`: never a write to the stack;
 *  3. auth `none`: the command makes no Foundry call at all, so the stack cannot
 *     be written by it — the shipped manifest carries exactly one such command,
 *     `update` (kind `mutation`, auth `none`: it replaces the local binary);
 *  4. otherwise: a write unless `--apply` reads false.
 * Checked on the 0.7.7 and 0.7.11 manifests: every mutation entry declares a
 * plain `--apply` flag, none with a default or a value, so no command that exists
 * today loses its refusal, and no plan that exists today loses its run.
 */
export function wouldWriteOnStack(path: string, args: readonly string[], manifest: readonly ManifestCommand[]): boolean {
  const entry = manifest.find(found => found.path === path)
  if (entry === undefined) return true
  if (entry.kind === 'read-only' || entry.kind === 'local') return false
  if (entry.auth === 'none') return false
  return appliesValue(entry, args) !== false
}

/**
 * The read-only stack gate, which runs before the ladder and before orthanc
 * starts: zay's rule, a stack the operator marked read-only (`orthanc configure
 * profile set <name> --read-only`) takes no write. Null lets the call on to the
 * ladder. What runs on a marked stack is what orthanc's own gate runs: reads,
 * plans (the same mutation with `--apply` unset) and local commands.
 *  - marked: the applied write is refused, naming the exact call and the
 *    profile's mark, and saying what does run.
 *  - the clear of the mark (`--no-read-only`): the operator's to make, whoever
 *    the call aims at. Orthanc marks it operator_approval (scope "always"), so
 *    the ladder asks for it; with a manifest that does not, this gate asks
 *    instead, so a mark is never cleared blind. The question names the stack the
 *    call names, not the active one, so the operator is never asked to approve
 *    one thing while another runs.
 *  - the mark unreadable or `configure list` dead: a write asks, so it never
 *    runs blind; a read or a plan is not held up (orthanc RO8).
 */
export function readOnlyStackGate(
  mark: StackMark,
  path: string,
  args: readonly string[],
  manifest: readonly ManifestCommand[],
): { outcome: 'ask' | 'block'; reason: string } | null {
  const call = shownCall(path, args)
  if (!wouldWriteOnStack(path, args, manifest)) {
    // Orthanc runs the clear as a local command: with a manifest that does not mark it
    // operator_approval, nothing else would ask, so this gate does, for any target stack.
    if (clearsReadOnlyMark(path, args) && operatorApprovalQuestion(path, args, manifest) === null) {
      const target = shownName(readOnlyMarkTarget(args) || mark.name)
      return {
        outcome: 'ask',
        reason: `'${call}' clears the read-only mark on stack '${target}'. Only the operator sets or clears that mark: 'orthanc configure profile set ${target} --read-only' puts it back. The call runs only if the operator approves it.`,
      }
    }
    return null
  }
  if (mark.readOnly === null) {
    return {
      outcome: 'ask',
      reason: `orthanc configure list gives no readable read_only mark for the stack '${shownName(mark.name)}', so orthanc_cli cannot tell whether it is marked read-only. '${call}' runs only if the operator approves it; check the stack with /profile.`,
    }
  }
  if (mark.readOnly !== true) return null
  // A command with no --apply flag has no plan to leave off, so do not tell the
  // agent to make one, and in yolo nothing else bounds the retry. One with no
  // manifest entry at all is not a known command either, so say that instead.
  const entry = manifest.find(found => found.path === path)
  const how =
    entry === undefined
      ? `'${shownCall(path, [])}' is not in the command list orthanc gave, so it counts as a write and nothing of it runs.`
      : appliesValue(entry, args) !== null
        ? 'Reads and plans run: the same call with --apply left off shows what it would do.'
        : `'${shownCall(path, [])}' has no plan mode: it writes as soon as orthanc starts it, so nothing of it runs on such a stack.`
  return {
    outcome: 'block',
    reason: `Stack '${shownName(mark.name)}' is marked read-only (orthanc configure list: read_only true), so '${call}' was not run: no write runs on a read-only stack, in any approval mode. ${how} Only the operator clears the mark, with 'orthanc configure profile set ${shownName(mark.name)} --no-read-only'.`,
  }
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
/** True when the value names main, master or HEAD, however it is spelled (`refs/heads/main`, `+master`, `:HEAD`, `./main/`). */
export const isProtectedValue = (value: string) => PROTECTED_BRANCHES.includes(branchCore(value)) || branchCore(value) === 'head'

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
  const entry = manifest.find(found => found.path === command)
  const base = {
    command,
    hasWorkingBranch: branchIsWorking(workingBranch),
    // `-b` is --branch in every command, so every spelling of it names the branch.
    targetsProtected:
      MAIN_WRITES.has(command) ||
      // A scenario whose base is not provably one global branch is a scenario on main.
      (BASE_BRANCH_WRITES.has(command) &&
        (!canPlan(entry) || argsNameFlag(args, ['--apply'])) &&
        !baseBranchOnWorkBranch(args, entry)) ||
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
      ...(PROMOTIONS.has(command) ? { promotion: true as const } : {}),
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

/** One simple command: its words; fed: a heredoc or here-string feeds its stdin; split:
 * it ended at an unquoted $( or backquote; targets: the files its redirects name (the
 * Orthanc guard reads them as data, the mark-store guard reads them as write targets). */
// The operator that ended a segment: 'fail' for `||`, the next command runs only
// when this one failed - which is what a wait that timed out does, so both are
// still paid for; 'arm' for a `case` arm's `;;` and the pattern that opens the
// next, the arms run instead of each other and only one is ever chosen; 'pipe'
// for `|`, the next command runs alongside this one; 'bg' for `&`, this command
// is left running and the line answers at once.
// Absent: the next command runs after this one (`&&`, `;`, a newline).
export type ShellJoin = 'fail' | 'arm' | 'pipe' | 'bg'

// continues: the segment is the argument continuation of a command the parser
// split at a substitution's `)`, so it starts no program of its own.
export type Segment = { words: string[]; fed: boolean; split: boolean; join?: ShellJoin; targets?: string[]; stdin?: string[]; continues?: boolean }

// Code that can start another process, per interpreter.
const SPAWNS: [RegExp, RegExp][] = [
  // A call on a bare name (`exec(code)`, `system("…")`) can start a process; one on an
  // attribute (`re.compile(…)`, `json.eval…`) is that module's own function, not a process.
  [/^python/, /subprocess|\bpty\b|ctypes|pexpect|plumbum|importlib|__import__|\brunpy\b|\bgetattr\b|\bbuiltins\b|(?<![\w.])(exec|eval|compile)\s*\(|\b(import|from)\s+(sh|commands)\b|\bos\s*\.\s*(system|popen|exec|spawn|posix_spawn|fork)|\b(system|popen[234]?|exec[lv]p?e?|spawn[lv]p?e?|posix_spawnp?|forkpty)\s*\(|\bfrom\s+os\s+import\b[^\n;]*\b(system|popen|exec|spawn|posix_spawn|fork)/],
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
/** The text of a `$'…'` word from just after its quote, with bash's escapes decoded,
 * and the index of its closing quote. */
function ansiCQuoted(command: string, start: number): { text: string; end: number } {
  const simple: Record<string, string> = { a: '\x07', b: '\b', e: '\x1b', E: '\x1b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\', "'": "'", '"': '"', '?': '?' }
  let text = ''
  let index = start
  for (; index < command.length; index += 1) {
    const char = command[index]!
    if (char === "'") break
    if (char !== '\\' || index + 1 >= command.length) {
      text += char
      continue
    }
    const next = command[index + 1]!
    const hex = /^x([0-9a-fA-F]{1,2})/.exec(command.slice(index + 1))
    const octal = /^([0-7]{1,3})/.exec(command.slice(index + 1))
    const unicode = /^(?:u([0-9a-fA-F]{1,4})|U([0-9a-fA-F]{1,8}))/.exec(command.slice(index + 1))
    if (simple[next] !== undefined) {
      text += simple[next]
      index += 1
    } else if (hex !== null) {
      text += String.fromCharCode(parseInt(hex[1]!, 16))
      index += hex[0].length
    } else if (octal !== null) {
      text += String.fromCharCode(parseInt(octal[1]!, 8) & 0xff)
      index += octal[0].length
    } else if (unicode !== null) {
      const point = parseInt((unicode[1] ?? unicode[2])!, 16)
      text += point <= 0x10ffff ? String.fromCodePoint(point) : ''
      index += unicode[0].length
    } else if (next === 'c' && index + 2 < command.length) {
      text += String.fromCharCode(command.charCodeAt(index + 2) & 0x1f)
      index += 2
    } else {
      text += `\\${next}`
      index += 1
    }
  }
  return { text, end: index }
}

function shellWords(command: string): { segments: Segment[]; code: string[]; hidden: boolean } {
  const segments: Segment[] = []
  const code: string[] = []
  const heredocs: { delimiter: string; expands: boolean; tabs: boolean; owner: string[] }[] = []
  // Text fed to a command's stdin, judged once its line is complete.
  const fed: { owner: string[]; text: string }[] = []
  let words: string[] = []
  let targets: string[] = []
  let word = ''
  let quote: string | null = null
  let quoted = false
  let target: 'file' | 'herestring' | 'heredoc' | 'heredoc-tabs' | null = null
  // Words after a substitution's `)` continue the command before it as arguments.
  let continues = false
  const endWord = () => {
    if (word !== '' || quoted) {
      if (target === 'heredoc' || target === 'heredoc-tabs') {
        heredocs.push({ delimiter: word, expands: !quoted, tabs: target === 'heredoc-tabs', owner: words })
      } else if (target === 'herestring') fed.push({ owner: words, text: word })
      else if (target === 'file') targets.push(word)
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
    // A redirect with no command word (`> file`) is bash's null command with that
    // redirect: it still opens, and empties, the file. It is read as `:`.
    if (words.length === 0 && targets.length > 0) words.push(':')
    if (words.length > 0) segments.push({ words, fed: false, split: operator === '$(' || operator === '`', join, targets, continues })
    words = []
    targets = []
    // Words right after a substitution's `)` continue the command before it as
    // arguments; a `case` arm's `)` opens a command of its own.
    continues = operator === ')' && !arm
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
    if (char === '$' && command[index + 1] === "'") {
      // ANSI-C quoting: `foundr$'y'` is `foundry`, with backslash escapes decoded.
      const decoded = ansiCQuoted(command, index + 2)
      word += decoded.text
      quoted = true
      index = decoded.end
    } else if (char === '$' && command[index + 1] === '"') {
      // Locale quoting: `$"y"` is `"y"` when no translation exists.
      quote = '"'
      quoted = true
      index += 1
    } else if (
      char === '(' &&
      word !== '' &&
      '@+*?!'.includes(word.at(-1)!) &&
      !(word === '!' && words.every(item => SHELL_KEYWORDS.has(item) || ASSIGNMENT_WORD.test(item)))
    ) {
      // An extglob group (`+(f)oundry`, `!(x)`) is part of the word, as bash reads it
      // under `shopt -s extglob`; without it bash refuses the line anyway. At command
      // position `!(…)` is bash's negation of a subshell and is read as that.
      let depth = 0
      let last = index
      for (; last < command.length; last += 1) {
        if (command[last] === '(') depth += 1
        else if (command[last] === ')' && (depth -= 1) === 0) break
      }
      // A substitution inside the group still runs (`+($(cmd))`), so it is read.
      code.push(...substitutionsIn(command.slice(index, last + 1)))
      word += command.slice(index, last + 1)
      index = last
    } else if (char === "'" || char === '"') {
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
  for (const segment of segments) {
    segment.fed = owners.has(segment.words)
    const stdin = fed.filter(item => item.owner === segment.words).map(item => item.text)
    if (stdin.length > 0) segment.stdin = stdin
  }
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
// Heads whose following words are one command line the shell runs (eval, watch …).
// ssh runs its command on another host: sshCommandStart resolves it instead.
const LINE_RUNNERS = new Set(['eval', 'watch', 'tmux', 'screen', 'parallel'])
const CODE_FLAG = /^-[A-Za-z]*[cS]$/
const NESTING_LIMIT = 3
// Words after which a later word is the program that runs (`docker exec -i c sh`).
const LAUNCHERS = new Set([
  'exec', 'run', 'ssh', 'sudo', 'doas', 'env', 'xargs', 'nohup', 'timeout', 'nice', 'stdbuf', 'setsid', 'chroot',
  'unshare', 'nsenter', 'flock', 'time', 'command', 'caffeinate',
])
// A segment hidesOrthanc refuses whenever the line names orthanc.
const UNREADABLE: Segment = { words: ['$'], fed: false, split: false, continues: false }

/** The words of a segment that the shell runs as code: the value after -c
 * (sh -c, bash -lc, su -c, npx -c), env -S, and everything after eval, watch
 * or tmux. ssh runs its command on another host (sshCommandStart); free-text
 * heads (git, echo, grep, …) run none of their words. */
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
  'builtin', 'stdbuf', 'then', 'do', 'else', '!', '{', 'setsid', 'npx',
  // Shell keywords whose next word is a command: `if orthanc …; then`, `while orthanc …`.
  'if', 'elif', 'while', 'until', 'coproc', '(',
])
// Flags of the wrappers that take the next word as their value (`sudo -u tester`,
// `xargs -I {}`, `nice -n 10`). A glued value (`-I{}`, `--signal=KILL`) is part
// of the flag word already; an unlisted flag takes no separate value.
const WRAPPER_VALUE_FLAGS: Readonly<Record<string, readonly string[]>> = {
  sudo: ['-C', '-D', '-R', '-T', '-g', '-p', '-r', '-u', '--chdir', '--close-from', '--group', '--other-user', '--prompt', '--role', '--type', '--user'],
  doas: ['-g', '-u', '--group', '--user'],
  env: ['-S', '-u', '--split-string', '--unset'],
  timeout: ['-k', '-s', '--kill-after', '--signal'],
  xargs: ['-E', '-I', '-J', '-L', '-P', '-R', '-S', '-d', '-j', '-l', '-n', '-s'],
  nice: ['-n', '--adjustment'],
  stdbuf: ['-e', '-i', '-o', '--error', '--input', '--output'],
  exec: ['-a', '-l'],
  time: ['-a', '-f', '-o', '--append', '--format', '--output'],
  caffeinate: ['-u', '-w'],
  npx: ['-c', '-p', '--call', '--package'],
}
const INDIRECT = new Set(['eval', 'source', '.'])
const CODE_RUNNERS = /^(python[0-9.]*|node|deno|bun|ruby|perl|osascript|awk)$/

// Heads that name orthanc without running it (`grep orthanc`, `cd orthanc`).
const NON_EXECUTING = new Set([
  'grep', 'egrep', 'fgrep', 'rg', 'ag', 'cat', 'bat', 'less', 'more', 'head', 'tail', 'wc', 'ls', 'cd', 'pushd',
  'man', 'which', 'whereis', 'type', 'echo', 'printf', 'git', 'make', 'file', 'stat', 'open', 'code', 'vim',
  'nano', 'brew', 'mkdir', 'rm', 'cp', 'mv', 'touch', 'tree', 'du', 'diff', 'cargo', 'sed', 'awk',
])

/** The index of a segment's command word: past assignments (`X=… cmd`), wrapper
 * words, and the flags, flag values and durations those wrappers take
 * (`env`, `sudo -u tester orthanc …`, `timeout 60 orthanc …`); `find … -exec CMD`
 * resolves to CMD. -1 when the segment starts no program of its own: a flag
 * before any word is the argument continuation of a command the parser split at
 * a substitution, and a segment of only assignments runs nothing. */
function commandWord(words: readonly string[]): number {
  let index = 0
  let wrapper = ''
  while (index < words.length) {
    const word = words[index]!
    if (ASSIGNMENT.test(word)) {
      index += 1
      continue
    }
    // `!` negates a command's exit status: the command word follows it.
    if (word === '!') {
      index += 1
      continue
    }
    const name = basename(word)
    if (name === 'find') {
      // find -exec CMD … ; runs CMD: the word after -exec/-execdir is the command word.
      const exec = words.findIndex((found, at) => at >= index && (found === '-exec' || found === '-execdir'))
      return exec >= 0 && exec + 1 < words.length ? exec + 1 : -1
    }
    if (WRAPPERS.has(name)) {
      wrapper = name
      index += 1
      continue
    }
    if (word.startsWith('-')) {
      if (wrapper === '') return -1
      index += (WRAPPER_VALUE_FLAGS[wrapper] ?? []).includes(word) ? 2 : 1
      continue
    }
    // A duration in its own word: `timeout 60`, `timeout 5m`, `nice 10`.
    if (wrapper !== '' && /^[0-9.]+[smhd]?$/i.test(word)) {
      index += 1
      continue
    }
    return index
  }
  return -1
}

// ssh's flags that take the next word as their value; the destination follows them.
const SSH_VALUE_FLAGS = ['-b', '-e', '-F', '-i', '-J', '-l', '-o', '-p', '-w', '-W']

/** Where a segment's ssh command for the remote host starts: past `ssh`, its
 * flags and the destination. -1 when the segment runs no ssh, or an ssh with no
 * command (it opens a remote shell). */
function sshCommandStart(segment: Segment): number {
  const index = commandWord(segment.words)
  if (index < 0 || basename(segment.words[index]!) !== 'ssh') return -1
  let at = index + 1
  while (at < segment.words.length) {
    const word = segment.words[at]!
    if (SSH_VALUE_FLAGS.includes(word)) {
      at += 2
      continue
    }
    if (word.startsWith('-')) {
      at += 1
      continue
    }
    break
  }
  return at + 1 < segment.words.length ? at + 1 : -1
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

/** Where a segment starts a real Orthanc call: at its command word (assignments
 * and wrappers resolved), when that word is Orthanc itself — `orthanc`, a path
 * to it (`/opt/bin/orthanc`, `target/debug/orthanc`) or `$ORTHANC_BIN`. -1
 * otherwise: a word orthanc anywhere past the command word is an argument (a
 * repo named zaycruz/orthanc, a `--bin` value), not a call. */
function orthancStart(segment: Segment, groups: ReadonlySet<string>): number {
  if (segment.continues) return -1
  const { words } = segment
  const index = commandWord(words)
  if (index < 0) return -1
  if (isOrthancWord(words[index]!)) return index
  // A launcher runs a later word as its program (`flock LOCK orthanc …`,
  // `nsenter -t 1 orthanc …`, `docker exec c orthanc …`): an orthanc word after
  // one that starts a call is a real call. Only after a launcher, so an argument
  // of any other command (a repo named zaycruz/orthanc) stays data.
  for (let position = index + 1; position < words.length; position += 1) {
    if (!isOrthancWord(words[position]!)) continue
    if (!words.slice(index, position).some(earlier => LAUNCHERS.has(basename(earlier)))) continue
    if (startsCall(words, position, groups)) return position
  }
  return -1
}

/** True when a segment runs Orthanc in a form the parser cannot read: a
 * variable in command position that may hold the binary, eval, or interpreter
 * code that can start a process. `command` is the whole shell line;
 * `assignments` holds every value the line gives each variable. A segment
 * whose command word is Orthanc itself is readable (orthancStart) and a
 * concrete other command word runs no Orthanc, whatever its arguments name. */
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
  if (segment.continues) return false
  const index = commandWord(words)
  if (index < 0) return false
  const head = words[index]!
  if (isOrthancWord(head)) return false
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
  if (INDIRECT.has(basename(head))) return rest.some(word => NAMES_ORTHANC.test(word))
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
function shellCalls(command: string, manifest: readonly ManifestCommand[], depth = 0): ShellCall[] {
  const segments = commandSegments(command, depth)
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
    if (start < 0) {
      // ssh runs a command on another host: what it runs there is read like a line of its own.
      const at = sshCommandStart(segment)
      if (at > 0 && depth < NESTING_LIMIT) calls.push(...shellCalls(segment.words.slice(at).join(' '), manifest, depth + 1))
      return
    }
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
// The guard decides "this runs orthanc" from the command word of each simple
// command (assignments and wrappers resolved), never from a substring anywhere
// in the line: the word in an argument, a repo name, a path, a flag value, a
// heredoc body or a JSON payload is data. It refuses a command word that is
// Orthanc, and a form it cannot read: eval, a variable as the command word,
// code fed to a shell or interpreter, or the remote command of an ssh.
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
    // The other direction, and Bash prints what a command prints straight back to
    // the agent: the two operator-only commands answer with a value, so they are
    // refused here too, ahead of the same read short-circuit.
    const operatorOnly = operatorOnlyReason(call.path)
    if (operatorOnly !== null) return refuse(call.path, operatorOnly)
    // The manifest entry this call names, read once: the wait timer below
    // (shellOrthancCalls) judges the same entry the ladder judged here.
    if (classifyOrthancCommand(call.path, manifest) === 'read' && call.entry?.operatorApproval === undefined) continue
    return refuse(call.path, `Orthanc writes run through orthanc_cli, where the branch rule and approval ladder apply, not Bash. Run '${call.path}' with orthanc_cli.`)
  }
  return null
}

// A Foundry MCP server, in any spelling the operator typed into their config: the
// name says palantir or foundry (`Palantir`, `palantir-mcp`, `foundry_tools`,
// `palantirFoundry`). The test is a substring, the same width the plugin's own
// tracer uses, because a word boundary would miss the glued and camelCase names:
// `[^a-z]` under `/i` also excludes `A`-`Z`, so a boundary rule leaves
// `palantirFoundry`, `FoundryMCP` and `palantirfoundry` — the host form this repo
// itself writes in `register.tsx` and `telemetry.test.ts` — running with no ladder
// while the trace still calls them Foundry. A gate narrower than the trace is the
// defect this table exists to close (measured on e01f1dd: `mcp__Palantir__delete_object`
// and `mcp__foundry_tools__delete_object` ran in all four modes).
const FOUNDRY_MCP_NAME = /(?:palantir|foundry)/i
const MCP_PREFIX = 'mcp__'
// The trace has always read the prefix case-insensitively, so the guard does too.
// `MCP__Palantir__delete_object` is the same call spelled with the caps-lock on.
const MCP_PREFIX_RE = /^mcp__/i

/** `mcp__<server>__<tool>` as its two parts; null when the name is not an MCP tool. */
function mcpToolParts(tool: string): { server: string; inner: string } | null {
  if (!MCP_PREFIX_RE.test(tool)) return null
  const rest = tool.slice(MCP_PREFIX.length)
  const split = rest.indexOf('__')
  if (split < 1 || split + 2 > rest.length) return null
  return { server: rest.slice(0, split), inner: rest.slice(split + 2) }
}

/** True for an MCP tool that reaches Foundry: its server or its own name says so. */
export function foundryMcpTool(tool: string): { inner: string } | null {
  const parts = mcpToolParts(tool)
  if (parts === null)
    // A name without the `mcp__<server>__<tool>` shape: read the rest as the tool,
    // so the guard and the trace see the same set of names. The prefix test ignores
    // case, as the trace's does, or `MCP__Palantir__delete_object` would be traced
    // as Foundry and never gated.
    return MCP_PREFIX_RE.test(tool) && FOUNDRY_MCP_NAME.test(tool.slice(MCP_PREFIX.length))
      ? { inner: tool.slice(MCP_PREFIX.length) }
      : null
  return FOUNDRY_MCP_NAME.test(parts.server) || FOUNDRY_MCP_NAME.test(parts.inner) ? { inner: parts.inner } : null
}

/**
 * The one answer to "does this call touch Foundry", for the guard and for the
 * trace. A second copy of the name test is how the two drift apart: a call the
 * trace called Foundry while the guard did not ran with no ladder.
 */
export function touchesFoundryTool(tool: string, input: Record<string, unknown>): boolean {
  if (tool === ORTHANC_CLI || tool === ORTHANC_HELP) return true
  if (tool === 'Bash') return /\borthanc\b/.test(typeof input.command === 'string' ? input.command : '')
  return foundryMcpTool(tool) !== null
}

// The verbs this plugin already treats as writes elsewhere. `MAIN_ONLY_WRITES` holds
// `ontology object-upsert` and `dataset transactions start`, the denied set the stream
// and auth commands, `PROMOTIONS` `proposal accept`. An MCP tool naming one of those
// verbs is a write too. Without them a name like
// `view_branch_and_revoke_protection` hits only its read verb and runs with no ladder.
// The list is a vocabulary and will never be complete; that is why an unreadable name
// fails closed instead of running.
const WRITE_WORDS = new Set(['accept', 'add', 'apply', 'archive', 'approve', 'build', 'cancel', 'close', 'create', 'decline', 'delete', 'deploy', 'destroy', 'drop', 'edit', 'grant', 'install', 'merge', 'post', 'promote', 'protect', 'publish', 'purge', 'put', 'reject', 'remove', 'rename', 'reset', 'restart', 'revert', 'revise', 'revoke', 'rollback', 'rotate', 'set', 'start', 'stop', 'submit', 'sync', 'terminate', 'truncate', 'unprotect', 'update', 'upload', 'upsert', 'write'])
const AMBIGUOUS_WORDS = new Set(['call', 'execute', 'invoke', 'run', 'trigger'])
const READ_WORDS = new Set(['check', 'describe', 'get', 'health', 'inspect', 'list', 'preview', 'query', 'read', 'search', 'view'])

/** Words in a tool name: split on separators and on letter case, so `deleteObjects`,
`delete_objects` and `DeleteObjects` all give `delete` and `objects`. */
function mcpWords(name: string): string[] {
  return name.split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/).map(word => word.toLowerCase()).filter(word => word !== '')
}

/** Every word either splitter can find in a tool name. */
function mcpAllWords(inner: string): string[] {
  return [...inner.toLowerCase().split(/[^a-z]+/), ...mcpWords(inner)]
}

/**
 * What a Foundry MCP tool name says about itself. A write or an ambiguous verb wins,
 * read the second, and anything else is `unknown`, which the guard refuses.
 *
 * The read answer is deliberately narrower than the write answer. A name counts as a
 * read only when the plain separator split — the one that shipped at e01f1dd — finds
 * the read verb: `list_objects`, `get-object`, `search data`. CamelCase is used to
 * find writes (`deleteObjects`, `listAndUpsertRows`), never to let a call through,
 * because camelCase is also how a compound name hides its second verb: splitting on
 * case for the read answer turned `listAndUpsertRows` into a plain `list` and the
 * guard ran a write it used to refuse (found in review of this change, and the reason
 * the two answers are not symmetric). A camelCase read such as `listObjects` is
 * refused with a reason. Nothing in this plugin lets an operator allow one by hand:
 * the block holds in every mode.
 *
 * The write answer is the UNION of both splits, and it has to be. The separator split
 * cuts on digits and the case split does not, so `list_and_delete2objects` shows the
 * verb `delete` only to the separator split. Reading only the case-split words hid a
 * write verb that e01f1dd saw, and the guard ran the write (also found in review).
 */
export function classifyMcpIntent(inner: string): 'read' | 'write' | 'unknown' {
  const coarse = inner.toLowerCase().split(/[^a-z]+/)
  const words = mcpAllWords(inner)
  // A destructive word outranks a read word: `get_uninstall_plan` names an
  // uninstall, and a read that reads as a write only costs a refusal.
  if (words.some(word => WRITE_WORDS.has(word)) || destructiveTermIn(inner) !== null) return 'write'
  if (words.some(word => AMBIGUOUS_WORDS.has(word))) return 'unknown'
  if (coarse.some(word => READ_WORDS.has(word))) return 'read'
  return 'unknown'
}

/** What the guard says about a blocked Foundry MCP tool: only what the name shows. */
function mcpIntentError(tool: string, intent: 'read' | 'write' | 'unknown'): string {
  if (intent === 'write') return `${tool} writes to Foundry outside Orthanc, with no branch. Orthanc is the only write path: use orthanc_cli with --branch.`
  return `${tool} is a Foundry call the guard cannot read, so nothing runs. A name with plain separated words (list_objects) reads; a camelCase name does not. Orthanc is the write path: orthanc_cli with --branch.`
}

/** A Foundry call the guard will not run and asks no one about: one it cannot
 * read, or one that belongs to the operator. Blocked in every mode; `error` is
 * what the agent sees, so it names the call and where it does run. */
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
    // Before the read short-circuit: these two are `read-only` in the manifest,
    // and what they print or write is the whole point of the call.
    const operatorOnly = operatorOnlyReason(resolved.path)
    if (operatorOnly !== null) return unreadableCall(input, workingBranch, operatorOnly)
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
  // The plugin's own discovery tool reads only the manifest; it is named under the
  // plugin's own server, which is a Foundry name.
  if (tool === ORTHANC_HELP) return null
  const foundryMcp = foundryMcpTool(tool)
  if (foundryMcp !== null) {
    const inner = foundryMcp.inner
    const intent = classifyMcpIntent(inner)
    if (intent === 'read') return null
    const mcpWord = destructiveTermIn(inner)
    return {
      command: null,
      kind: 'mutation',
      isBranchScoped: false,
      hasWorkingBranch: branchIsWorking(workingBranch),
      targetsProtected: targetsProtected(input),
      // Read by name too, so a tool named for one of the destructive acts is judged
      // as destructive, not only one whose name says `delete` (destructive.test.ts D10).
      isDestructive: mcpWord !== null || mcpAllWords(inner).includes('delete'),
      error: mcpIntentError(tool, intent),
    }
  }
  return null
}

/** The fix the agent can actually apply, in the flag this command takes: a
 * scenario has no --branch, and telling it to pass one sends it back to the
 * same ask (the loop guard is off in yolo). A write that takes no branch at all
 * gets no branch advice. */
function workBranchFix(command: string | null): string {
  if (command !== null && BASE_BRANCH_WRITES.has(command)) return 'otherwise pass --base-branch <global branch RID>, or create one with \'global-branch create agent/<name>\''
  if (command !== null && (MAIN_WRITES.has(command) || MAIN_ONLY_WRITES.has(command))) return ''
  return 'otherwise pass a work branch'
}

/** The yolo ask for a scenario: the fork writes neither main nor its base, so
 * what the operator is approving is the choice of main as that base. */
function scenarioBaseReason(command: string): string {
  return `'${command}' is a scenario based on main: its --base-branch is missing, or is not one global branch RID. The scenario writes neither main nor that base, so the call to approve is which branch the work forks from; ${workBranchFix(command)}.`
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
  // when the call is shown to land on one global work branch. A promotion
  // (zay, 2026-11-20: "raise the proposal and merge the proposal") asks in
  // every mode but yolo too. These come before yolo's early run, so nothing
  // that lands on main runs unasked.
  const yolo = mode === 'yolo'
  if (classification.release && !(yolo && classification.releaseOnWorkBranch)) {
    return { outcome: 'ask', reason: classification.release }
  }
  if (classification.operatorApproval && !(yolo && (classification.operatorApprovalOnWorkBranch || classification.promotion))) {
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
        (classification.command !== null && BASE_BRANCH_WRITES.has(classification.command)
          ? `yolo mode: ${scenarioBaseReason(command)}`
          : `yolo mode: '${command}' writes main (it names main, master or HEAD as its branch, or works on main only, or starts a stored schedule or import that may build main). It runs only if the operator approves; ${workBranchFix(classification.command)}`) +
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
      reason: `'${command}' targets a protected baseline (main/master branch or the production ontology).${workBranchFix(classification.command) === '' ? '' : ` ${workBranchFix(classification.command)}.`}${note}`,
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
    'passes --branch <global branch RID> (ri.branch..branch.…; create one with global-branch create agent/<name>; `ontology scenario create` spells its branch --base-branch); ' +
    'dataset, stream and build writes pass --branch <work branch>; code goes to a work branch and a pull request. ' +
    'Writes without a branch and default-branch pushes are blocked in every mode. ' +
    'Promotions — merging, accepting or approving a proposal, global-branch deploy, repository pull-request merge — ' +
    'are allowed (they land through a proposal, never directly on main). ' +
    'A write that names main, master or HEAD as its branch, or works on main only, or is an ontology scenario based on main, asks the operator in every mode. ' +
    (mode === 'yolo'
      ? `Foundry approval mode: yolo. Nothing asks the operator except a write on main: a destructive write (one that leaves something ${destructiveWords()} by its name, a flag, or a flag value, or one given --force) runs at once, ` +
        'and the loop guard is off. A promotion runs with no ask. A write that names main or master as its branch asks the operator; ' +
        'so does a release tag (repository tag create --apply) with no --branch <global branch RID>, and a write the agent manifest ' +
        'marks operator_approval (such as turning branch protection off) unless its operator_approval_scope shows it lands on one global work branch, ' +
        'and so does an ontology scenario based on main (`ontology scenario create --apply` with no --base-branch <global branch RID>). ' +
        'If the operator declines or no one can be asked, it is blocked. Pass a work branch instead.'
      : 'Promotions follow the ladder like any other write. ' +
        'Writes the agent manifest marks operator_approval, such as turning branch protection off, also ask the operator. ' +
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
  return resolvedPath(path, cwd, home).toLowerCase()
}

/** The absolute path as written, case kept. The mark-store guard needs the case: a
 * glob such as `[!F]oundry` matches `foundry` in bash, and only the written case shows
 * that. A segment without glob characters is still compared without case. */
function resolvedPath(path: string, cwd: string, home: string): string {
  const expanded = path.trim().replace(/^~(?=\/|$)/, home)
  const absolute = expanded.startsWith('/') ? expanded : `${cwd.replace(/\/$/, '')}/${expanded}`
  const parts: string[] = []
  for (const part of absolute.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }
  return `/${parts.join('/')}`
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

// Orthanc keeps each stack's read_only mark in profile-settings.json in its config
// dir: `$XDG_CONFIG_HOME/foundry`, else `~/.config/foundry` (src/profile_settings.rs,
// profiles.rs config_dir), deliberately outside the credential store. The directory
// is the unit that matters, because the obvious ways to erase a mark name no file at
// all: `rm -rf <dir>`, `mv <dir> /tmp/x`, `rm -rf ~/.config`,
// `rm ~/.config/*/profile-settings.json`, `find ~ -name 'foundr*' -delete`, a tar or
// rsync unpacked over it. So the guard anchors on the resolved config directory and on
// every directory above it, and a path token may carry a glob on any segment. The same
// file name under any other directory is left alone.
// The commands that may name the store, because they only read the files they name.
// The list says what is safe, so a command nobody thought of (`sort -o`, `curl -o`,
// `ex`, `gio trash`) is refused rather than let through. A reader with a flag that
// writes a file or runs a program is not one (`less -o`, `file -C`).
const STORE_READERS = new Set([
  'cat', 'tac', 'ls', 'stat', 'file', 'wc', 'head', 'tail', 'less', 'more', 'grep', 'egrep', 'fgrep', 'jq',
  'diff', 'cmp', 'md5sum', 'sha1sum', 'sha256sum', 'sha512sum', 'shasum', 'cksum', 'du', 'df', 'realpath',
  'readlink', 'dirname', 'basename', 'echo', 'printf', 'test', '[', '[[', 'true', 'false', ':', 'pwd', 'cd',
  'pushd', 'popd', 'which', 'type', 'strings', 'hexdump', 'od', 'column', 'nl', 'id', 'whoami', 'date', 'sleep',
  // Text filters: they read files or stdin and write stdout only.
  'tr', 'cut', 'paste', 'sort', 'join', 'comm', 'fold', 'fmt', 'expand', 'unexpand', 'rev', 'seq', 'zcat',
  'printenv', 'uname',
])
// The flags with which a reader writes a file or runs a program: short flags (also
// bundled, `-ro`), long options with every abbreviation GNU accepts (`--o`, `--out=`),
// and `+command` for the pagers.
const READER_WRITE_FLAG: Record<string, { short?: RegExp; long?: string[]; plus?: boolean }> = {
  less: { short: /^-[A-Za-z]*[oO]/, long: ['log-file', 'LOG-FILE'], plus: true },
  more: { plus: true },
  file: { short: /^-[A-Za-z]*C/, long: ['compile'] },
  date: { short: /^-[A-Za-z]*s/, long: ['set'] },
  sort: { short: /^-[A-Za-z]*[oT]/, long: ['output', 'compress-program', 'temporary-directory'] },
}
const GIT_WRITE_FLAG = { short: /^-[A-Za-z]*O/, long: ['output', 'open-files-in-pager', 'exec', 'upload-pack', 'receive-pack', 'ext-diff', 'textconv'] }
/** Whether a word is one of these writing flags. */
function writingFlag(word: string, flags: { short?: RegExp; long?: string[]; plus?: boolean }): boolean {
  if (word.startsWith('--')) {
    const name = word.slice(2).split('=')[0]!
    return name !== '' && (flags.long ?? []).some(option => option.startsWith(name))
  }
  if (flags.plus === true && word.startsWith('+')) return true
  return flags.short !== undefined && word.startsWith('-') && flags.short.test(word)
}
// A program named by a path counts only from a standard directory: `/tmp/cat` is
// whatever someone put there.
const STANDARD_BIN = /^(?:\/usr\/local|\/usr|\/opt\/homebrew|)\/s?bin\/[^/]+$/
// Shell words that open or close a construct; the command is the word after them.
const SHELL_KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}', 'fi', 'done', 'esac', 'in', '(', ')'])
// Keywords whose words are data to bind or match (`for f in …`, `case x in`).
const BINDING_KEYWORDS = new Set(['for', 'select', 'case'])
// A find that only prints: tests, options and the print actions. Any other primary
// (`-delete`, `-exec`, `-ok`, `-fprint`, `-fls`, one added later) makes it a writer.
const FIND_READ_PRIMARY = new Set([
  '-name', '-iname', '-path', '-ipath', '-wholename', '-iwholename', '-regex', '-iregex', '-regextype', '-lname',
  '-ilname', '-type', '-xtype', '-maxdepth', '-mindepth', '-depth', '-print', '-print0', '-printf', '-ls',
  '-size', '-mtime', '-mmin', '-atime', '-amin', '-ctime', '-cmin', '-newer', '-anewer', '-cnewer', '-newermt',
  '-perm', '-user', '-group', '-uid', '-gid', '-nouser', '-nogroup', '-empty', '-readable', '-writable',
  '-executable', '-prune', '-not', '-o', '-or', '-a', '-and', '-true', '-false', '-follow', '-xdev', '-mount',
  '-noleaf', '-daystart', '-samefile', '-inum', '-links', '-quit', '-warn', '-nowarn', '-ignore_readdir_race',
  '-L', '-H', '-P',
])
// A git that writes only its own repository: these subcommands, with no flag that
// writes a file or runs a program. `git rm`, `git checkout`, `git clean` and the rest
// write the work tree and are refused.
const GIT_READ_SUBCOMMAND = new Set([
  'log', 'show', 'diff', 'status', 'grep', 'blame', 'rev-parse', 'ls-files', 'ls-tree', 'cat-file', 'describe',
  'shortlog', 'rev-list', 'branch', 'tag', 'remote', 'commit', 'add', 'fetch', 'push', 'reflog', 'whatchanged',
  'help', 'version', 'name-rev', 'merge-base', 'for-each-ref', 'show-ref', 'count-objects', 'check-ignore',
])
// Options git takes before its subcommand, and whether each takes the next word.
const GIT_GLOBAL_OPTION = /^(?:-C|--git-dir|--work-tree|--namespace)$/
const GIT_GLOBAL_FLAG = /^(?:--no-pager|-P|--bare|--no-replace-objects|--literal-pathspecs|--git-dir=.*|--work-tree=.*|--namespace=.*)$/

/** Whether one simple command only reads: its program (after assignments and shell
 * keywords) is a reader, used without a flag that writes or runs. A wrapper (`sudo`,
 * `nice`, `time`, `xargs`) or anything unknown is not a reader. */
function readsOnly(words: readonly string[]): boolean {
  let head = 0
  let assigns = false
  while (head < words.length && (ASSIGNMENT_WORD.test(words[head]!) || SHELL_KEYWORDS.has(words[head]!))) {
    if (ASSIGNMENT_WORD.test(words[head]!)) assigns = true
    head += 1
  }
  if (head >= words.length) return true
  // A variable set for the command changes what it runs (`GIT_EXTERNAL_DIFF=…`,
  // `LESSOPEN=…`, `PATH=…`), so a reader with one is not a reader.
  if (assigns) return false
  const word = words[head]!
  if (word.includes('/') && !STANDARD_BIN.test(word)) return false
  const program = basename(word)
  if (BINDING_KEYWORDS.has(program)) return true
  const rest = words.slice(head + 1)
  if (program === 'find') return rest.every(word => !word.startsWith('-') || FIND_READ_PRIMARY.has(word) || /^-O[0-9]$|^-D$/.test(word))
  if (program === 'git') {
    let index = 0
    while (index < rest.length && (GIT_GLOBAL_OPTION.test(rest[index]!) || GIT_GLOBAL_FLAG.test(rest[index]!))) {
      index += GIT_GLOBAL_OPTION.test(rest[index]!) ? 2 : 1
    }
    const sub = rest[index]
    return sub !== undefined && GIT_READ_SUBCOMMAND.has(sub) && !rest.slice(index + 1).some(word => writingFlag(word, GIT_WRITE_FLAG))
  }
  if (!STORE_READERS.has(program)) return false
  const flags = READER_WRITE_FLAG[program]
  return flags === undefined || !rest.some(word => writingFlag(word, flags))
}

const MARK_FILE_NAMES = ['profile-settings.json', 'profile-settings.lock']
// A search that picks files by name or path pattern, rather than by the directory it
// was pointed at.
const NAME_LIMIT_FLAG = /^-(?:i?name|path|i?regex)(?:$|=)/i
const ASSIGNMENT_WORD = /^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/

/** `foundr*`, `found?y` and `[f]oundry` name `foundry` once the shell expands them. A
 * bracket expression is read with bash's grammar, because `rm -rf ~/.config/[f]oundry`
 * is the oldest way to write a path so that a plain text search misses it. */
type CodeRange = [number, number]

/** POSIX classes as code point ranges (bash's ASCII ranges, `globasciiranges`). */
const POSIX_CLASS: Record<string, CodeRange[]> = {
  alpha: [[65, 90], [97, 122]],
  alnum: [[48, 57], [65, 90], [97, 122]],
  ascii: [[0, 127]],
  blank: [[9, 9], [32, 32]],
  cntrl: [[0, 31], [127, 127]],
  digit: [[48, 57]],
  graph: [[33, 126]],
  lower: [[97, 122]],
  print: [[32, 126]],
  punct: [[33, 47], [58, 64], [91, 96], [123, 126]],
  space: [[9, 13], [32, 32]],
  upper: [[65, 90]],
  word: [[48, 57], [65, 90], [95, 95], [97, 122]],
  xdigit: [[48, 57], [65, 70], [97, 102]],
}

/** One bracket expression from just after its `[`, as bash reads it: an optional `!` or
 * `^`; a `]` first in the set is a member; `\x` is the character x; `a-b` is a range
 * (empty when a > b); `[:name:]` is a class, `[=c=]` and `[.c.]` are the character c,
 * and either can end a range. A name the guard does not know (`[:foo:]`,
 * `[.hyphen.]`) is read as "any character" in a plain set and as nothing in a negated
 * one, so it only ever matches more. Undefined when the `]` that closes it is missing:
 * bash then reads the `[` as itself. */
function bracketClass(pattern: string, start: number): { negate: boolean; ranges: CodeRange[]; any: boolean; end: number } | undefined {
  let cursor = start
  let negate = false
  if (pattern[cursor] === '!' || pattern[cursor] === '^') {
    negate = true
    cursor += 1
  }
  const ranges: CodeRange[] = []
  let any = false
  // One member at the cursor: a single code point, a class, or an unknown name.
  const member = (): { point?: number; classRanges?: CodeRange[]; unknown?: boolean; next: number } | undefined => {
    const character = pattern[cursor]
    if (character === undefined) return undefined
    if (character === '[') {
      const kind = pattern[cursor + 1]
      if (kind === ':' || kind === '=' || kind === '.') {
        const close = pattern.indexOf(`${kind}]`, cursor + 2)
        if (close >= 0) {
          const name = pattern.slice(cursor + 2, close)
          const next = close + 2
          if (kind === ':') return POSIX_CLASS[name] === undefined ? { unknown: true, next } : { classRanges: POSIX_CLASS[name], next }
          const points = [...name]
          return points.length === 1 ? { point: points[0]!.codePointAt(0)!, next } : { unknown: true, next }
        }
      }
    }
    if (character === '\\' && cursor + 1 < pattern.length) return { point: pattern.codePointAt(cursor + 1)!, next: cursor + 2 }
    const point = pattern.codePointAt(cursor)!
    return { point, next: cursor + String.fromCodePoint(point).length }
  }
  let first = true
  while (cursor < pattern.length) {
    if (pattern[cursor] === ']' && !first) return { negate, ranges, any, end: cursor }
    first = false
    const low = member()
    if (low === undefined) return undefined
    cursor = low.next
    if (low.point !== undefined && pattern[cursor] === '-' && pattern[cursor + 1] !== ']' && cursor + 1 < pattern.length) {
      cursor += 1
      const high = member()
      if (high === undefined) return undefined
      cursor = high.next
      if (high.point !== undefined) {
        if (low.point <= high.point) ranges.push([low.point, high.point])
      } else if (high.unknown === true) any = true
      else {
        ranges.push([low.point, low.point], [45, 45], ...(high.classRanges ?? []))
      }
      continue
    }
    if (low.point !== undefined) ranges.push([low.point, low.point])
    else if (low.classRanges !== undefined) ranges.push(...low.classRanges)
    else any = true
  }
  return undefined
}

const codeUnit = (point: number) => `\\u${Math.min(point, 0xffff).toString(16).padStart(4, '0')}`

/** A bracket expression as a regex character class. */
function bracketRegex(set: { negate: boolean; ranges: CodeRange[]; any: boolean }): string {
  const body = set.ranges.map(([low, high]) => (low === high ? codeUnit(low) : `${codeUnit(low)}-${codeUnit(high)}`)).join('')
  // An unknown name adds nothing to a negated set, and everything to a plain one.
  if (set.negate) return body === '' ? '[\\s\\S]' : `[^${body}]`
  if (set.any) return '[\\s\\S]'
  return body === '' ? '[^\\s\\S]' : `[${body}]`
}

/** Compiled patterns, so a brace word with hundreds of names compiles each once. */
const GLOB_CACHE = new Map<string, [RegExp, RegExp]>()

function globMatches(pattern: string, name: string): boolean {
  if (!/[*?[]|[@+!]\(/.test(pattern)) return pattern.toLowerCase() === name.toLowerCase()
  const [exact, folded] = GLOB_CACHE.get(pattern) ?? globRegexes(pattern)
  // bash matches a glob against the real name case by case, so `[!F]oundry` names
  // `foundry`; a case-insensitive disk (macOS) can also resolve a differently-cased
  // name. Either match counts, which never refuses less than bash would.
  return exact.test(name) || folded.test(name)
}

function globRegexes(pattern: string): [RegExp, RegExp] {
  let body = ''
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]!
    if ('@+*?!'.includes(character) && pattern[index + 1] === '(') {
      // An extglob group (`+(f)`, `!(x)`, `@(a|b)`) is read as any text: it can only
      // match more than bash does, never less.
      let depth = 0
      let last = index + 1
      for (; last < pattern.length; last += 1) {
        if (pattern[last] === '(') depth += 1
        else if (pattern[last] === ')' && (depth -= 1) === 0) break
      }
      if (last < pattern.length) {
        body += '[\\s\\S]*'
        index = last
        continue
      }
    }
    if (character === '*') body += '[\\s\\S]*'
    else if (character === '?') body += '[\\s\\S]'
    else if (character === '\\' && index + 1 < pattern.length) {
      index += 1
      body += codeUnit(pattern.codePointAt(index)!)
    } else if (character === '[') {
      const set = bracketClass(pattern, index + 1)
      if (set === undefined) body += '\\['
      else {
        body += `(?:${bracketRegex(set)})`
        index = set.end
      }
    } else body += codeUnit(pattern.codePointAt(index)!)
  }
  const compiled: [RegExp, RegExp] = [new RegExp(`^${body}$`), new RegExp(`^${body}$`, 'i')]
  if (GLOB_CACHE.size > 8192) GLOB_CACHE.clear()
  GLOB_CACHE.set(pattern, compiled)
  return compiled
}

/** bash brace expansion: `mv ~/.config/foundry{,.bak}` and
 * `rm -rf ~/.config/{foundry,x}` name the store although no word holds it whole. Comma
 * lists and every sequence bash expands (`{a..z}`, `{z..a}`, `{a..z..2}`, `{01..10}`),
 * nested. A group bash would not expand is left as written, as bash leaves it.
 *
 * How many names a brace word can produce, and the guard's budget for listing them.
 * Past the budget the varying part is read as a shape instead, which is the safe side. */
const BRACE_BUDGET = 4096

function braceCandidates(word: string): string[] {
  const expanded = expandBraces(word, { left: BRACE_BUDGET })
  return expanded === undefined ? [braceShape(word)] : expanded
}

/** Every name the word can expand to, or undefined when there are too many. Ranges are
 * counted before they are built, so a million-item range costs nothing. */
function expandBraces(word: string, budget: { left: number }): string[] | undefined {
  const open = word.indexOf('{')
  if (open < 0) return [word]
  let close = -1
  let depth = 0
  for (let index = open; index < word.length; index += 1) {
    if (word[index] === '{') depth += 1
    else if (word[index] === '}' && (depth -= 1) === 0) {
      close = index
      break
    }
  }
  const parts = close < 0 ? undefined : braceParts(word.slice(open + 1, close))
  if (parts === 'overflow') return undefined
  // A group bash does not expand (`{x}`, `{}`, an unclosed `{`) stays as written, and
  // expansion goes on after its `{`: `a{x}b{1,2}` is `a{x}b1 a{x}b2` and
  // `{foundr{x,y}}` is `{foundrx} {foundry}`.
  if (parts === undefined) {
    const rest = expandBraces(word.slice(open + 1), budget)
    return rest === undefined ? undefined : rest.map(tail => `${word.slice(0, open + 1)}${tail}`)
  }
  if (parts.length > budget.left) return undefined
  const out: string[] = []
  for (const part of parts) {
    const nested = expandBraces(`${word.slice(0, open)}${part}${word.slice(close + 1)}`, budget)
    if (nested === undefined) return undefined
    budget.left -= nested.length
    if (budget.left < 0) return undefined
    out.push(...nested)
  }
  return out
}

/** The pieces of one brace group as bash splits it: two or more comma-separated parts
 * at its top level, or a sequence. Undefined when bash leaves the group as written. */
function braceParts(body: string): string[] | 'overflow' | undefined {
  const parts = splitTopLevel(body, ',')
  if (parts.length >= 2) return parts
  return rangeParts(body)
}

/** The word as a shape, when listing its names would cost more than the answer is worth:
 * each brace group becomes as many `?` as its shortest name, plus a `*` when the names
 * differ in length. So `foundr{a..z}{a..z}{a..z}` reads as `foundr??` (nine characters,
 * never the seven of `foundry`), while a list of five thousand names that holds the store
 * still reads as something that can be it. Nested groups and a group spanning a `/` lose
 * the shape and fall back to a wildcard. */
function braceShape(word: string): string {
  let out = ''
  let depth = 0
  let group = ''
  for (const character of word) {
    if (character === '{') {
      if (depth === 0) group = ''
      else group += character
      depth += 1
      continue
    }
    if (character === '}' && depth > 0) {
      depth -= 1
      if (depth === 0) {
        const shape = groupShape(group)
        out += shape === undefined ? '*' : shape
        continue
      }
    }
    if (depth === 0) out += character
    else group += character
  }
  return out
}

/** `?` per character of the shortest name in a group, and a `*` when they differ. */
function groupShape(body: string): string | undefined {
  if (body.includes('{') || body.includes('/')) return undefined
  if (splitTopLevel(body, ',').length < 2) {
    const range = rangeSpec(body)
    if (range === undefined) return undefined
    if (range.count <= BigInt(BRACE_BUDGET)) {
      const names = rangeParts(body) as string[]
      const lengths = names.map(name => name.length)
      const shortest = Math.min(...lengths)
      return '?'.repeat(shortest) + (Math.max(...lengths) === shortest ? '' : '*')
    }
    return '?'.repeat(range.shortest) + (range.uniform ? '' : '*')
  }
  const parts = splitTopLevel(body, ',')
  if (parts.length === 0) return undefined
  const lengths = parts.map(part => part.length)
  const shortest = Math.min(...lengths)
  return '?'.repeat(shortest) + (Math.max(...lengths) === shortest ? '' : '*')
}

/** The pieces of `{a,{b,c}}` at the top level of one brace group. */
function splitTopLevel(body: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const character of body) {
    if (character === '{') depth += 1
    else if (character === '}') depth -= 1
    if (character === separator && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }
    current += character
  }
  parts.push(current)
  return parts
}

/** A bash sequence expression `{x..y}` or `{x..y..step}`, as bash reads it: integers
 * (zero-padded when either end starts with `0` or `-0`) or single ASCII letters, in
 * either direction, with any step (its sign is ignored and 0 means 1). A letter range
 * walks every character code between its ends, so `{Y..b}` passes `[`, `\\` and `_`
 * as bash does. Anything else is not a range and stays as written, as in bash. */
type Range = { count: bigint; at: (index: bigint) => string; shortest: number; uniform: boolean }

function rangeSpec(body: string): Range | undefined {
  const match = /^([+-]?\d+|[a-zA-Z])\.\.([+-]?\d+|[a-zA-Z])(?:\.\.([+-]?\d+))?$/.exec(body)
  if (match === null) return undefined
  const [, first = '', last = '', stepText] = match
  const rawStep = stepText === undefined ? 1n : BigInt(stepText.replace(/^\+/, ''))
  const step = rawStep === 0n ? 1n : rawStep < 0n ? -rawStep : rawStep
  const numeric = /\d/.test(first)
  if (numeric !== /\d/.test(last)) return undefined
  if (!numeric) {
    const from = BigInt(first.charCodeAt(0))
    const to = BigInt(last.charCodeAt(0))
    const down = to < from
    const span = down ? from - to : to - from
    return {
      count: span / step + 1n,
      at: index => String.fromCharCode(Number(down ? from - index * step : from + index * step)),
      shortest: 1,
      uniform: true,
    }
  }
  const from = BigInt(first.replace(/^\+/, ''))
  const to = BigInt(last.replace(/^\+/, ''))
  const down = to < from
  const span = down ? from - to : to - from
  const padded = /^-?0\d/.test(first) || /^-?0\d/.test(last)
  const width = padded ? Math.max(first.length, last.length) : 0
  const format = (value: bigint) => {
    if (!padded) return value.toString()
    if (value < 0n) return `-${(-value).toString().padStart(width - 1, '0')}`
    return value.toString().padStart(width, '0')
  }
  return {
    count: span / step + 1n,
    at: index => format(down ? from - index * step : from + index * step),
    // With padding every name is at least `width` long; without it, a range that crosses
    // the single digits has names of one character.
    shortest: padded ? width : 1,
    uniform: false,
  }
}

/** The names of a range, or 'overflow' when there are more than the budget. */
function rangeParts(body: string): string[] | 'overflow' | undefined {
  const range = rangeSpec(body)
  if (range === undefined) return undefined
  if (range.count > BigInt(BRACE_BUDGET)) return 'overflow'
  return Array.from({ length: Number(range.count) }, (_value, index) => range.at(BigInt(index)))
}

/** The words a line runs, as the shell runs them and with what it substitutes in
 * place: `~` in every form bash reads (`~`, `~+`, `~-`, `~login`), `$HOME`,
 * `$XDG_CONFIG_HOME` and the variables the command itself assigns, with bash's
 * `${NAME:-x}`, `${NAME%/}` and other operators (done twice, so
 * `D=$HOME/.config/foundry` then `rm -rf "$D"` reads as one path), and braces are
 * expanded. Where bash's answer depends on what the guard cannot know (`~-`, another
 * login's home, a pattern operator), every answer it could give is kept, so the word
 * can only name more. An unknown variable is left as written. The text a heredoc or a
 * here-string feeds a command is kept apart as `stdin`, split into words. */
function runWords(command: string, home: string, configHome: string, cwd = '/'): { words: string[]; targets: string[]; stdin: string[] }[] {
  const config = configHome.trim() === '' ? `${home}/.config` : configHome.trim()
  const segments = commandSegments(command)
  const assigned = new Map<string, string>()
  const homeText = home === '' ? '~' : home
  for (const segment of segments)
    for (const word of segment.words) {
      const assign = ASSIGNMENT_WORD.exec(word)
      if (assign !== null && assign[1] !== undefined) assigned.set(assign[1], assign[2] ?? '')
    }
  // `printf -v NAME FORMAT ARGS…` assigns too: the format with each `%s`-like
  // conversion filled from the arguments (`printf -v d '%s/.config/foundry' ~`).
  for (const segment of segments) {
    const words = segment.words
    const at = words.indexOf('printf')
    if (at < 0) continue
    const flag = words[at + 1] ?? ''
    const name = flag === '-v' ? words[at + 2] : flag.startsWith('-v') ? flag.slice(2) : undefined
    if (name === undefined || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue
    const rest = words.slice(at + (flag === '-v' ? 3 : 2))
    const args = rest.slice(1).map(arg => arg.replace(/^~(?=\/|$)/, homeText))
    assigned.set(name, (rest[0] ?? '').replace(/%%|%[-+ #0-9.]*[a-zA-Z]/g, conversion => (conversion === '%%' ? '%' : (args.shift() ?? ''))))
  }
  // Where `~+` and `~-` can point: the session's directory, home, and every directory
  // the line moves into.
  const visited = new Set<string>([cwd])
  for (const segment of segments)
    segment.words.forEach((word, index) => {
      const next = segment.words[index + 1]
      if ((word === 'cd' || word === 'pushd') && next !== undefined && !next.startsWith('-'))
        visited.add(resolvedPath(next.replace(/^~(?=\/|$)/, homeText), cwd, home))
    })
  // What a name can hold. `PWD` and `OLDPWD` (and `$(pwd)`) can be any directory
  // the line visits, or home.
  const values = (name: string): string[] | undefined =>
    name === 'HOME'
      ? [homeText]
      : name === 'XDG_CONFIG_HOME'
        ? [config]
        : name === 'PWD' || name === 'OLDPWD'
          ? [homeText, ...visited]
          : assigned.has(name)
            ? [assigned.get(name)!]
            : undefined
  // `~`, `~+` (the working directory), `~-` (the last one) and `~login` (that login's
  // home: the one beside ours, and ours too, since the guard cannot read the password
  // file) at the start of a word or of an assignment's value.
  const tildes = (word: string): string[] => {
    const match = /^((?:[^=~]*=)?)~([^/:]*)(.*)$/s.exec(word)
    if (match === null) return [word]
    const [, before = '', login = '', rest = ''] = match
    if (login === '') return [`${before}${homeText}${rest}`]
    if (login === '+' || login === '-') return [homeText, ...visited].map(where => `${before}${where}${rest}`)
    if (!/^[A-Za-z0-9._-]+$/.test(login)) return [word]
    const beside = home === '' ? `/home/${login}` : `${home.replace(/\/[^/]*\/?$/, '')}/${login}`
    return [`${before}${homeText}${rest}`, `${before}${beside}${rest}`]
  }
  // `$NAME`, `$(pwd)` and `` `pwd` `` are written as `${NAME}` / `${PWD}`, so one
  // scanner reads every form.
  const braced = (word: string) =>
    word
      .replace(/\$\(\s*pwd\s*\)|`\s*pwd\s*`/g, '${PWD}')
      .replace(/\$([A-Za-z_][A-Za-z0-9_]*|[1-9@*])/g, (_whole, name: string) => `\${${name}}`)
  // `${NAME op word}`, nested ones too. A known name gives its value, with bash's
  // operator applied (`:+` gives the word, a trim gives the trimmed value and the
  // value). `${!NAME}` gives the value of the name NAME holds. An unknown name with a
  // default (`${NOPE:-x}`, `${NOPE=x}`) gives the default; `${NOPE:+x}` gives the word.
  // Anything unknown (a name, a positional parameter, an array element) inside a
  // longer word can hold any text there, the empty text included, so it also gives `*`
  // (`foundr${NOPE}y` is `foundry` in bash when NOPE is unset).
  const PARAMETER_LIMIT = 64
  const parameters = (word: string): string[] => {
    const start = word.indexOf('${')
    if (start < 0) return [word]
    let depth = 0
    let end = -1
    for (let index = start; index < word.length; index += 1) {
      if (word.startsWith('${', index)) {
        depth += 1
        index += 1
      } else if (word[index] === '}' && (depth -= 1) === 0) {
        end = index
        break
      }
    }
    if (end < 0) return [word]
    const head = word.slice(0, start)
    const whole = word.slice(start, end + 1)
    // An unknown expansion inside a longer word can be any text there; one that is the
    // whole word is left as written (`rm -rf "$f"`: a variable the line does not set).
    const any = word.length > whole.length ? '*' : ''
    const tails = parameters(word.slice(end + 1))
    const inner = word.slice(start + 2, end)
    const indirect = /^!([A-Za-z_][A-Za-z0-9_]*)$/.exec(inner)
    const pointed = indirect === null ? undefined : assigned.get(indirect[1]!)
    const match = /^([A-Za-z_][A-Za-z0-9_]*)(:?[-=?+]|%%?|##?|[/:^,@])?([\s\S]*)$/.exec(
      pointed !== undefined && /^[A-Za-z_][A-Za-z0-9_]*$/.test(pointed) ? pointed : inner,
    )
    const known = match === null ? undefined : values(match[1]!)
    const op = match?.[2] ?? ''
    const operand = match?.[3] ?? ''
    const choices: { text: string; open: boolean }[] = []
    if (match === null || (known === undefined && !['', ':-', '-', ':=', '=', ':+', '+'].includes(op))) {
      choices.push({ text: whole, open: false }, { text: any, open: false })
    } else if (known === undefined) {
      if (op === '') choices.push({ text: whole, open: false }, { text: any, open: false })
      else if (op === ':+' || op === '+') choices.push({ text: operand, open: true }, { text: '', open: false })
      else choices.push({ text: operand, open: true }, { text: whole, open: false }, { text: any, open: false })
    } else {
      for (const value of known) {
        if (op === ':+' || op === '+') choices.push({ text: operand, open: true })
        else if (op.startsWith('%') || op.startsWith('#')) choices.push({ text: trimmed(value, op, operand), open: false }, { text: value, open: false })
        else choices.push({ text: value, open: false })
      }
    }
    const results = new Set<string>()
    for (const choice of choices)
      for (const text of choice.open ? tildes(choice.text).flatMap(parameters) : [choice.text])
        for (const tail of tails) {
          if (results.size >= PARAMETER_LIMIT) return [...results]
          results.add(`${head}${text}${tail}`)
        }
    return [...results]
  }
  const once = (word: string) => tildes(word).map(braced).flatMap(parameters)
  const substitute = (word: string) => [...new Set(once(word).flatMap(once))].slice(0, PARAMETER_LIMIT)
  const expand = (word: string) => substitute(word).flatMap(braceCandidates)
  return segments.map(segment => ({
    words: segment.words.flatMap(expand),
    targets: (segment.targets ?? []).flatMap(expand),
    stdin: (segment.stdin ?? []).flatMap(text => text.split(/\s+/)).filter(piece => piece !== '').flatMap(expand),
  }))
}

/** `${NAME%pat}`, `${NAME%%pat}`, `${NAME#pat}`, `${NAME##pat}`: the value with the
 * shortest or longest matching suffix or prefix removed. */
function trimmed(text: string, op: string, pattern: string): string {
  const cuts = Array.from({ length: text.length + 1 }, (_value, index) => index)
  if (op.startsWith('%')) {
    const order = op === '%' ? cuts.reverse() : cuts
    for (const cut of order) if (globMatches(pattern, text.slice(cut)) || pattern === text.slice(cut)) return text.slice(0, cut)
    return text
  }
  const order = op === '#' ? cuts : cuts.reverse()
  for (const cut of order) if (globMatches(pattern, text.slice(0, cut)) || pattern === text.slice(0, cut)) return text.slice(cut)
  return text
}

/** The directories a command works in: the session's, the target of any `cd` or `pushd`
 * it makes (a bare `cd` means the home directory), and the parent of every path it
 * names. */
function mentionedDirs(segments: readonly string[][], cwd: string, home: string): Set<string> {
  const dirs = new Set<string>([cwd.replace(/\/+$/, '') || '/'])
  const add = (path: string) => {
    const found = resolvedPath(path.replace(/\\/g, '/').replace(/\/+$/, ''), cwd, home)
    dirs.add(found)
    const cut = found.lastIndexOf('/')
    if (cut > 0) dirs.add(found.slice(0, cut))
  }
  for (const words of segments)
    words.forEach((word, index) => {
      if (word === 'cd' || word === 'pushd') {
        const next = words[index + 1]
        add(next === undefined || next.startsWith('-') ? (home === '' ? '~' : home) : next)
        return
      }
      for (const piece of [word, ...pathPieces(word)]) if (piece.includes('/')) add(piece)
    })
  return dirs
}
/** Whether a path pattern names the store, something under it, or a directory holding
 * it: `rm -rf ~/.config` clears a mark as surely as `rm -rf ~/.config/foundry` does.
 * Compared segment by segment, so the glob may sit on any one of them
 * (`rm ~/.config/found?y`, `rm -rf ~/.config/foundr*`, a pattern one segment deeper
 * than the store). A pattern shorter than the
 * store path is a directory above it, which is exactly what is refused. */
function pathReachesStore(pattern: string, dir: string, inside = false): boolean {
  const parts = pattern.split('/').filter(part => part !== '' && part !== '.')
  const target = dir.split('/').filter(part => part !== '' && part !== '.')
  // Only the store or a path in it: a directory above it does not count.
  if (inside && parts.length < target.length) return false
  // `/`, or a `.` that resolves to it, holds everything, the store included.
  if (parts.length === 0) return target.length > 0
  if (target.length === 0) return false
  const depth = Math.min(parts.length, target.length)
  for (let index = 0; index < depth; index += 1) if (!globMatches(parts[index]!, target[index]!)) return false
  return true
}

/** Whether a bare token (no directory in it) can be the store directory or one of its
 * mark files: `foundr*`, `profile-s*`, `profile-settings.json`. */
function bareNamesStore(token: string, dir: string): boolean {
  const storeBase = dir.slice(dir.lastIndexOf('/') + 1)
  return globMatches(token, storeBase) || MARK_FILE_NAMES.some(name => globMatches(token, name))
}

const REACHING = new WeakMap<Set<string>, string[]>()

/** The directories a command works in that can lead to the store. */
function reachingDirs(mentioned: Set<string>, cwd: string, dir: string): string[] {
  const known = REACHING.get(mentioned)
  if (known !== undefined) return known
  const found = [...mentioned, cwd].filter(where => pathReachesStore(where, dir))
  REACHING.set(mentioned, found)
  return found
}

/** Where a token was written from: an absolute or `$`-prefixed path stands on its own;
 * a relative one resolves at each directory the command says it is working in, which is
 * how `cd ~ && rm -rf .config` names `~/.config`. */
function storePaths(token: string, cwd: string, home: string, mentioned: Set<string>, dir: string): string[] {
  if (/^(?:\/|~|\$)/.test(token)) return [resolvedPath(token, cwd, home)]
  // Without a `..`, `<where>/<token>` keeps every segment of `<where>`, so it can reach
  // the store only from a directory that does. Filtering the directories first keeps a
  // word of thousands of names from being tried against thousands of directories.
  const climbs = token.split('/').includes('..')
  return (climbs ? [...mentioned, cwd] : reachingDirs(mentioned, cwd, dir)).map(where => resolvedPath(`${where.replace(/\/+$/, '')}/${token}`, cwd, home))
}

/** Whether one word reaches the mark store, anything under it, or a directory holding
 * it. A name with no directory in it counts only where the command (or the session)
 * stands, so `rm /tmp/profile-settings.json` and `rm -rf $STORE` (an unknown variable)
 * stay free. */
function namesStore(token: string, cwd: string, home: string, dir: string, mentioned: Set<string>, inside = false): boolean {
  const written = token.replace(/\\/g, '/')
  // `/` on its own is the root, and the root holds the store; a relative `.` is the
  // working directory, which the resolution below already handles.
  const path = written.replace(/\/+$/, '') || (written.startsWith('/') ? '/' : '')
  if (path === '') return false
  // A `--flag=` prefix is stripped too, because `tar -C=<store>` says the same thing
  // to the shell as `tar -C <store>`, and a path can sit inside the argument of a
  // function call (`glob("~/...")`) rather than be the whole word.
  const spellings = [path, path.replace(/^--?[A-Za-z0-9_.+-]+=/, ''), ...pathPieces(path)].filter(spelling => spelling !== '')
  return spellings.some(spelling => storePaths(spelling, cwd, home, mentioned, dir).some(where => pathReachesStore(where, dir, inside)))
}

/** The path-shaped pieces inside a word: what a shell would pass to `open` when the
 * word is a call around a string, rather than a bare path. */
function pathPieces(word: string): string[] {
  return [...word.matchAll(/(?<=^|[\s"'`;:()|&<>=,])(?:~|\/)[^\s"'`;:()|&<>]*/g)].map(match => match[0]!)
}

export const PROFILE_STORE_WRITE_REASON =
  'orthanc keeps each stack read_only mark in its own config dir (~/.config/foundry/profile-settings.json), so the plugin writes nothing there and only the operator edits it. Ask the operator to run orthanc configure profile set <name> --read-only or --no-read-only: an agent that rewrites or removes that file gets past both the plugin gate and orthanc own read-only gate.'

/** Where orthanc keeps its profiles: `configHome` if set, else `<home>/.config`, plus `foundry`. */
const profileStoreDir = (home: string, configHome = ''): string =>
  resolvedPath(`${configHome.trim() === '' ? (home === '' ? '~/.config' : `${home}/.config`) : configHome.trim()}/foundry`, '/', home)

/**
 * Why a call must not write into orthanc's config dir, or null. The read-only mark
 * lives only in `profile-settings.json` there, so anything that rewrites or removes
 * that file (or the directory holding it, or a directory above it) clears a mark and
 * skips both gates. A verb has to meet the store in the same command segment, so reads
 * that merely name it (`cat`, `ls`, `jq`, `git log --grep`, a `find` with no `-delete`)
 * and a redirect out to another directory are left alone. A copy of the directory is
 * refused: `cp a b` and `cp b a` are one shape. A path built at run time inside an
 * interpreter (`python3 -c "os.remove(os.path.join(...))"`) is not caught: this reads a
 * command line, not a shell.
 */
/**
 * Why a call must not write into orthanc's config dir, or null. The read-only mark
 * lives only in `profile-settings.json` there, so anything that rewrites or removes
 * that file (or the directory holding it, or a directory above it) clears a mark and
 * skips both gates. The command line is read the way a shell reads it: words are split
 * on whitespace and operators with quotes and backslashes only protecting them, `~`,
 * `$HOME`, `$XDG_CONFIG_HOME` and variables the command assigns are put in, braces are
 * expanded, and a name pattern matches with glob characters including bracket classes.
 * So the store is met as the shell meets it: `rm -rf ~/.config/[f]oundry`,
 * `mv ~/.config/foundry{,.bak}`, `rm -rf ~/.config/fo""undry` and `cd && rm -rf
 * .config` all name it. A verb has to meet it in the same segment, so reads that merely
 * name it (`cat`, `ls`, `jq`, `git log --grep`, a `find` with no `-delete`) and a
 * redirect out to another directory are left alone. A copy of the directory is refused:
 * `cp a b` and `cp b a` are one shape. Two limits stay visible: a path built at run
 * time inside an interpreter (`python3 -c "os.remove(os.path.join(...))"`) is not a
 * command-line word, and a variable the command does not assign cannot be read.
 */
export function profileStoreWriteReason(
  tool: string,
  input: Record<string, unknown>,
  cwd = '/',
  home = '',
  configHome = '',
): string | null {
  const dir = profileStoreDir(home, configHome)
  const inside = (path: string) => pathReachesStore(resolvedPath(path.replace(/\\/g, '/'), cwd, home), dir)
  const paths = [input.file_path, input.notebook_path, input.path].filter((value): value is string => typeof value === 'string')
  if (FILE_WRITERS.has(tool) && paths.some(path => inside(path))) return PROFILE_STORE_WRITE_REASON
  if (tool !== 'Bash' || typeof input.command !== 'string') return null
  // The line as written, and the lines bash can make of it before it splits words: a
  // backslash-newline joined (`foun\<newline>dry`), and a command substitution
  // replaced by the output it plainly gives (`foundr$(:)y`, `$(echo ~/.config)`). Each
  // form can only add a refusal, so the line runs only when every form would.
  for (const line of storeLineForms(input.command, home))
    if (storeLineWriteReason(line, cwd, home, configHome, dir) !== null) return PROFILE_STORE_WRITE_REASON
  return null
}

/** The forms of a line bash reads the same way: as written, with each
 * backslash-newline outside single quotes removed, and with each command
 * substitution outside single quotes replaced by its output: what `echo` or `printf`
 * prints, `${PWD}` for `pwd`, nothing for `:` or `true`, and `*` (any text) for
 * anything else. */
function storeLineForms(command: string, home: string): string[] {
  const joined = (text: string) => {
    let out = ''
    let single = false
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]!
      if (single) {
        out += char
        if (char === "'") single = false
      } else if (char === "'") {
        single = true
        out += char
      } else if (char === '\\' && text[index + 1] === '\n') index += 1
      else if (char === '\\') {
        out += char + (text[index + 1] ?? '')
        index += 1
      } else out += char
    }
    return out
  }
  const output = (body: string, inside: boolean): string => {
    const words = commandSegments(body)[0]?.words ?? []
    const atHome = (word: string) => word.replace(/^~(?=\/|$)/, home === '' ? '~' : home)
    if (words[0] === 'pwd') return '${PWD}'
    if (words[0] === 'echo') return words.slice(1).filter(word => !/^-[neE]+$/.test(word)).map(atHome).join(' ')
    if (words[0] === 'printf') return (words.length > 2 ? words.slice(2) : [words[1] ?? '']).map(atHome).join(' ')
    if (words.length === 0 || [':', 'true', 'false'].includes(words[0]!)) return ''
    // Output the guard cannot know can be any text inside a word; a substitution that
    // is the whole word is left to the line as written.
    return inside ? '*' : ''
  }
  const substituted = (text: string) => {
    let out = ''
    let single = false
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index]!
      if (single) {
        out += char
        if (char === "'") single = false
        continue
      }
      if (char === "'") {
        single = true
        out += char
        continue
      }
      if (char === '\\') {
        out += char + (text[index + 1] ?? '')
        index += 1
        continue
      }
      const substitution = text[index + 2] === '(' ? null : substitutionAt(text, index)
      if (substitution === null) {
        out += char
        continue
      }
      const edge = /^$|[\s;|&(<>"]$/
      const inside = !edge.test(out.slice(-1)) || !edge.test(text[substitution.end + 1] ?? '') && text[substitution.end + 1] !== ')'
      out += output(substitution.body, inside)
      index = substitution.end
    }
    return out
  }
  const forms = new Set([command])
  let current = command
  for (let round = 0; round < 3; round += 1) {
    const next = substituted(joined(current))
    if (next === current) break
    forms.add(joined(current))
    forms.add(next)
    current = next
  }
  return [...forms]
}

function storeLineWriteReason(command: string, cwd: string, home: string, configHome: string, dir: string): string | null {
  const input = { command }
  const segments = runWords(input.command, home, configHome, cwd)
  const raw = commandSegments(input.command)
  const every = (segment: { words: string[]; targets: string[]; stdin: string[] }) => [...segment.words, ...segment.targets, ...segment.stdin]
  const allWords = segments.flatMap(every)
  const mentioned = mentionedDirs(segments.map(segment => [...segment.words, ...segment.targets]), cwd, home)
  const reaches = (words: readonly string[]) => words.some(word => namesStore(word, cwd, home, dir, mentioned))
  const names = (segment: { words: string[]; targets: string[]; stdin: string[] }) => {
    // A search limited by a name or path pattern reaches the mark only when that
    // pattern can name it: `find ~ -name 'profile-*.png' -delete` takes someone
    // else's screenshots and leaves the mark alone, while
    // `find ~ -name 'profile-*.json' -delete` and `find ~ -name 'foundr*' -delete` do
    // not.
    const limited = segment.words.some(word => NAME_LIMIT_FLAG.test(word))
    if (limited && !segment.words.some(word => bareNamesStore(word, dir))) return false
    return reaches(every(segment))
  }
  // A command that can change a file: anything but a reader, a redirect into the
  // store, or a redirect to a path the guard cannot read (`: > "$f"`).
  const writes = (segment: { words: string[]; targets: string[]; stdin: string[] }) =>
    !readsOnly(segment.words) ||
    segment.targets.some(target => /[$`]/.test(target) || namesStore(target, cwd, home, dir, mentioned))
  // Per simple command: a writer that names the store, anything in it, or a directory
  // above it (`rm -rf ~/.config`), however the word is spelled (globs, braces,
  // quoting, `~` forms, variables the line sets), from a relative name after a `cd`,
  // or through text fed to its stdin (`xargs rm <<< …`).
  if (segments.some(segment => names(segment) && writes(segment))) return PROFILE_STORE_WRITE_REASON
  // Across the line: the store (or a path in it) named anywhere, and a writer anywhere,
  // because a pipe, a variable, a loop or a substitution can carry the path from one
  // to the other (`ls -d <store> | while read d; do rm -rf "$d"; done`).
  const named = allWords.some(word => namesStore(word, cwd, home, dir, mentioned, true))
  if (named && segments.some(writes)) return PROFILE_STORE_WRITE_REASON
  // A directory above the store carried to another command, by a pipe, a command
  // substitution or a loop's words (`echo ~/.config | xargs rm -rf`,
  // `rm -rf $(echo ~/.config)`, `for d in ~; do rm -rf "$d/.config"; done`).
  const substitutes = /\$\(|`|<\(/.test(input.command)
  const carries = (segment: { words: string[]; targets: string[]; stdin: string[] }, index: number) =>
    substitutes || raw[index]?.join === 'pipe' || segment.words.some(word => BINDING_KEYWORDS.has(word))
  if (segments.some((segment, index) => carries(segment, index) && names(segment)) && segments.some(writes))
    return PROFILE_STORE_WRITE_REASON
  // A pattern naming the mark file or the store directory, with the writer in another
  // segment: `find ~ -name profile-settings.json | xargs -d '\n' rm`.
  if (allWords.some(word => bareNamesStore(word, dir)) && segments.some(writes) && reaches(allWords))
    return PROFILE_STORE_WRITE_REASON
  return null
}
