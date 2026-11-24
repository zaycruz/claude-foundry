// Every command of the tied surface, against the branch rule and the Bash rule.
//
// The other guard tests pick their commands by hand: Y4, Y13 and Y16 name the
// branch writes they checked, Y12 checks Bash on a few, Y18 lists the seven
// commands that name a branch as a positional. This file asks the same questions
// of every command in hooks/orthanc-manifest.snapshot.ts, the surface the guard
// is tied to, so the commands nobody thought to name are covered by the tie that
// moves them, not by the next person who thinks to look.
//
// What the pin holds decides how far each arm reaches. It keeps `path` and `kind`
// for every command, and the option flags only on the entries that carry an
// approval key or that the guard judges by a flag (`repository clone`,
// `dev-console sdk install`). So:
//  - BS1 and BS2 reach every command, because `--branch` is matched by name, not
//    by the command's declaration (policy.ts `targetsProtected`).
//  - BS3 reads a command's own declared branch flags, so it covers the entries
//    whose flags the pin keeps: every write Orthanc marks `operator_approval`,
//    which is where a branch write with a new spelling would show up.
//  - No arm can read a *positional* branch: the pin drops positionals, so the
//    seven names stay with Y18. Keeping each entry's branch-carrying args (flag
//    and positional) in the pin would close that gap and BS3 with it; that moves
//    the pin and the release job's file format, so it is not in this pull request.
//
// Decisions come from the two pure functions the ladder runs (`classifyCall` and
// `ladderDecision`, read as yolo.test.ts reads them), with the auto guard answered
// Approve: `run` means the call reaches Orthanc with no question, `ask` that the
// operator is asked, `block` that the guard refuses it. Reading the ladder rather
// than driving the tool is what keeps a sweep of this size (about 12,000 calls)
// inside the test runner's time: the same sweep through `$.tool.call` took the
// file's whole budget and more.
//
// What no arm here reaches, so the next reader does not trust the sweep further
// than it goes:
//  - A write that another command runs for you. `watch -n1 orthanc automate mute
//    <rid> --apply` runs the write, and BS4 passes while it does: the guard reads
//    the command word (`watch`), so `orthanc …` is an argument, and WRAPPERS in
//    policy.ts names `env`, `timeout`, `xargs` and friends but not the runners
//    that exec their own arguments. Measured on this commit: `watch`, `entr`,
//    `at`, `systemd-run`, `steady`, `pueue`, `ts`, `unbuffer`, `retry`,
//    `tmux new-session -d`, `screen -dm` and `expect -c` all run it; `parallel`,
//    `ssh <host> …`, `nohup`, `bash -c` and a plain redirect do not.
//  - A branch the pin shows only as a positional (FND-21 asks for the pin to keep
//    arguments). Y18 names the seven commands that take one.
//  - A branch that only looks like main. `--branch origin/main`,
//    `--branch refs/remotes/origin/main` and a name with a zero-width space in it
//    run in yolo, and that is right: each is a different branch, and Orthanc
//    would not touch `main` for it. `refs/heads/main`, `./main`, `main.`,
//    `:main`, `MAIN` and `Main` are `main`, and each of those asks or blocks.
//
// Ways this can fail, written before the code. Each arm was measured with the
// rule it depends on taken out of hooks/policy.ts:
//  BS1 In yolo, a write that names main, master or HEAD as its branch reaches
//      Orthanc on some command of the surface.
//  BS2 The ladder loosens, and the same call runs unasked in ask-always,
//      allow-edits or auto.
//  BS3 A command whose own declared flags name a branch takes main on one of
//      them with no ask in yolo — the arm that fires when Orthanc marks a new
//      branch write, or renames `--branch` on one it already marks.
//  BS4 An Orthanc write in Bash runs instead of going to orthanc_cli, on any
//      command of the surface.
//  BS5 The other direction: a plain read in Bash is blocked, so the agent loses
//      the read lane zay asked for ("reads as plain `orthanc …`"). Only the two
//      reads whose whole answer is a secret stay refused, named below.
//
// Measured, each time with hooks/policy.ts changed and reverted again:
//  - BS1, BS2 and BS3 read the branch name from two places at once
//    (`targetsProtected`'s name test over the argv, and
//    `flagValues(args, BRANCH_FLAGS).some(isProtectedValue)` in the same
//    classification). Turning one off leaves the other, and all three stayed
//    green: the redundancy is real, and this is the file that shows it. With
//    both off, BS1 named 2178 calls, BS2 1758 in allow-edits and the same in
//    auto (ask-always asks for every write, so it has no hole to find), and BS3
//    named its own set.
//  - BS4 fires with the write refusal in shellClassification turned off: every
//    write of the surface came back in its list.
//  - BS5 fires with `admin group get` made operator-only: it named that read.
//  - A sweep that reports hundreds of leaks at once must still report: the
//    first version returned every leaking call in one array, and the runner
//    killed the file's report instead of printing it. Hence the count plus the
//    first eight calls.
import { expect, test } from 'claude-code/testing'
import { classifyCall, classifyOrthancCommand, ladderDecision, readApprovalCondition, type ApprovalMode, type ManifestCommand } from './policy'
import { manifestFrom, type Envelope } from './orthanc'
import { SNAPSHOT } from './orthanc-manifest.snapshot'

const CLI = 'mcp__foundry__orthanc_cli'
const MODES: readonly ApprovalMode[] = ['ask-always', 'allow-edits', 'auto', 'yolo']
const RID = 'ri.compass.main.folder.00000000-0000-4000-8000-000000000002'
const MAINS = ['main', 'master', 'HEAD']
// The spellings of a branch value Y16 walks, kept short here: this file walks
// them over every command, where Y16 walks all of them over one command.
const FLAG_FORMS = (value: string) => [['--branch', value], [`--branch=${value}`], ['-b', value], ['-b' + value]]

const envelope = (data: unknown): Envelope => ({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [] })

/** The surface as the hooks see it at run time: the reader that turns a manifest
 * envelope into command entries, over the pinned manifest. */
const SURFACE: readonly ManifestCommand[] = manifestFrom(envelope(SNAPSHOT))

/** Two placeholder positionals, then `extra`, then every confirmation flag the
 * command declares and its own approval flags. A plan writes nothing, so a call
 * that only plans is not this file's business: `--apply` goes in only where the
 * pin says the command declares it. */
function call(entry: ManifestCommand, extra: readonly string[]): string[] {
  const declared = (entry.flags ?? []).map(flag => flag.flag)
  const args = [RID, RID, ...extra]
  for (const flag of ['--apply', '--yes']) if (declared.includes(flag) && !args.includes(flag)) args.push(flag)
  for (const flag of readApprovalCondition(entry.operatorApproval)?.flags ?? []) if (!args.includes(flag)) args.push(flag)
  return args
}

/** The commands this file judges as writes, by the guard's own classification of
 * the call above: no local read (`capabilities`, `alias list`) is held to the
 * branch rule, and nothing the guard reads as a read is judged as a write. */
const WRITES = SURFACE.filter(entry => classifyOrthancCommand(entry.path, SURFACE, call(entry, [])) === 'mutation')

const outcome = (mode: ApprovalMode, path: string, args: readonly string[]) => {
  const classified = classifyCall(CLI, { command: path, args: [...args] }, SURFACE, null)
  if (classified === null) return 'read'
  if (classified.error) return 'block'
  return ladderDecision(mode, classified, { action: 'approve', reason: 'guard said ok' }).outcome
}

// Two commands name a branch they do not write, and run in yolo with it.
//  - `repository pull-request create --base-branch main` opens a pull request
//    *into* main; the merge is the write, and `repository pull-request merge` is
//    a promotion Y19 covers.
//  - `global-proposal create --branch-rid main` creates a proposal, and its
//    `--branch-rid` takes a global branch RID (`ri.branch..branch.…`), which
//    `main` is not. The write it proposes is `global-branch deploy`, whose own
//    `operator_approval` (`--apply`, `--yes`) asks in every mode.
// Both are the promotion path zay kept open (2026-11-20: "raise the proposal and
// merge the proposal, just nothing direct against main or master"). Naming a
// branch as `--branch` is not on this list: no command may run a `--branch main`
// with no question, in yolo or anywhere else.
const PROMOTION_TARGETS: ReadonlyArray<{ path: string; flags: readonly string[] }> = [
  { path: 'repository pull-request create', flags: ['--base-branch'] },
  { path: 'global-proposal create', flags: ['--branch-rid'] },
]
const allowedToNameMain = (path: string, flags: readonly string[]) =>
  PROMOTION_TARGETS.some(target => target.path === path && flags.some(flag => target.flags.includes(flag)))

/** Every write of the surface, every form, one mode: what would reach Orthanc.
 * Reported as a count and the first few calls: with a rule out, hundreds of
 * commands leak at once, and a diff that big is what killed this file's report on
 * the first run of the mutation checks. */
function runsUnasked(mode: ApprovalMode, forms: (entry: ManifestCommand) => string[][]) {
  const leaks: string[] = []
  for (const entry of WRITES) {
    for (const extra of forms(entry)) {
      if (allowedToNameMain(entry.path, extra)) continue
      const args = call(entry, extra)
      if (outcome(mode, entry.path, args) === 'run') leaks.push(`${entry.path} ${args.slice(2).join(' ')}`)
    }
  }
  return { count: leaks.length, first: leaks.slice(0, 8) }
}
/** The one assertion every sweep makes: nothing reached Orthanc. */
const nothingRan = (leaks: { count: number; first: string[] }) => {
  expect(leaks.count).toBe(0)
  expect(leaks.first).toEqual([])
}

const everySpellingOfMain = MAINS.flatMap(main => FLAG_FORMS(main))

test('BS1: in yolo, no command of the tied surface runs a write that names its branch main', () => {
  // The pin is the whole surface, so a sweep this wide has writes in it.
  expect(WRITES.length > 200).toBe(true)
  nothingRan(runsUnasked('yolo', () => everySpellingOfMain))
})

for (const mode of ['ask-always', 'allow-edits', 'auto'] as const) {
  test(`BS2: in ${mode}, a write naming its branch main never runs unasked, on any command of the surface`, () => {
    nothingRan(runsUnasked(mode, () => everySpellingOfMain))
  })
}

test('BS3: a command whose declared flags name a branch refuses main on them, in yolo', () => {
  const branchFlags = (entry: ManifestCommand) => (entry.flags ?? []).filter(flag => /branch/i.test(flag.flag)).map(flag => flag.flag)
  // Today the flags the marked entries declare are `--branch`; the arm is here
  // for the day one of them declares a branch under another name.
  expect([...new Set(WRITES.flatMap(entry => branchFlags(entry)))].sort()).toEqual(['--branch'])
  const forms = (entry: ManifestCommand) => branchFlags(entry).flatMap(flag => MAINS.map(main => [flag, main]))
  nothingRan(runsUnasked('yolo', forms))
})

test('BS4: Bash runs no Orthanc write of the tied surface', () => {
  const escapes: string[] = []
  for (const entry of SURFACE) {
    const args = call(entry, [])
    if (classifyOrthancCommand(entry.path, SURFACE, args) !== 'mutation') continue
    const line = ['orthanc', entry.path, ...args].join(' ')
    if (classifyCall('Bash', { command: line }, SURFACE, null) === null) escapes.push(line)
  }
  expect(escapes).toEqual([])
})

// The two reads the plugin refuses in every lane, because what they answer with
// is a credential (FND-22). Named here so BS5 fails if one of them goes runnable,
// and if a third read joins them with no decision written down.
const SECRET_READS = ['compute env get', 'repository git-credential']

test('BS5: Bash runs every read of the tied surface except the two that answer with a secret', () => {
  const blocked = SURFACE.filter(entry => entry.kind === 'read-only')
    .filter(entry => classifyCall('Bash', { command: ['orthanc', entry.path, RID, RID].join(' ') }, SURFACE, null) !== null)
    .map(entry => entry.path)
  expect(blocked.sort()).toEqual([...SECRET_READS].sort())
})
