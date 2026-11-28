// Every command of the tied surface, against the branch rule and the Bash rule.
//
// The other guard tests pick their commands by hand: Y4, Y13 and Y16 name the
// branch writes they checked, Y12 checks Bash on a few, Y18 lists the seven
// commands that name a branch as a positional. This file asks the same questions
// of every command in hooks/orthanc-manifest.snapshot.ts, the manifest the guard
// is tied to, so the commands nobody thought to name are covered by the tie that
// moves them, not by the next person who thinks to look.
//
// How far each arm reaches depends on what the pin holds. It keeps `path`, `kind`
// and `input` for every command, and option flags only on the entries that carry
// an approval key or that the guard judges by a flag (`repository clone`,
// `dev-console sdk install`); `credential_store` and positionals are dropped.
//  - BS1 and BS2 reach every command: `--branch` is matched by name, not by the
//    command's declaration.
//  - BS3 reads a command's own declared branch flags, so it sees the marked
//    entries only. That is where Orthanc would mark a new branch write, and where
//    a renamed `--branch` would show up.
//  - No arm reaches a positional branch. `main` was tried in a positional slot
//    across the surface and reported 816 calls, every one a command taking `main`
//    as a *name* (`admin group create main`): with no positionals in the pin, the
//    sweep cannot tell the two apart. Y18 names the seven that take a branch
//    positionally, and FND-21 asks the pin to keep each entry's arguments, which
//    is the change that would let this arm exist.
//
// Decisions come from the two pure functions the ladder runs (`classifyCall` and
// `ladderDecision`, read the way yolo.test.ts reads them), with the auto guard
// answered Approve: `run` means the call reaches Orthanc with no question, `ask`
// that the operator is asked, `block` that the guard refuses it. Reading the
// ladder rather than driving the tool is what keeps 12,216 calls inside the
// runner's budget: the same sweep through `$.tool.call` ran past the two minutes
// a file gets, and the run died without a report.
//
// Two things no arm here reaches, so the next reader does not trust the sweep
// further than it goes:
//  - A write that another command runs for you. `watch -n1 orthanc automate mute
//    <rid> --apply` runs the write, and BS4 passes while it does: the guard reads
//    the command word (`watch`), so `orthanc …` is an argument, and WRAPPERS in
//    policy.ts lists `env`, `timeout`, `xargs` and friends but not the runners
//    that exec their own arguments. Measured at this commit: `watch`, `entr`,
//    `at`, `systemd-run`, `steady`, `pueue`, `ts`, `unbuffer`, `retry`,
//    `tmux new-session -d`, `screen -dm` and `expect -c` all run it; `parallel`,
//    `ssh <host> …`, `nohup`, `bash -c` and a plain redirect do not.
//  - A branch that only looks like main. `--branch origin/main`,
//    `--branch refs/remotes/origin/main` and a name with a zero-width space in it
//    run in yolo, and that is right: each names a different branch, and Orthanc
//    would not touch `main` for it. `refs/heads/main`, `./main`, `main.`,
//    `:main`, `MAIN` and `Main` are `main`, and each of those asks or blocks.
//
// Ways this can fail, written before the code. Each arm was measured with the
// rule it depends on taken out of hooks/policy.ts, one mutation per run, each
// reverted before the next. HEAD runs 846 pass, 0 fail; the totals name the other
// files' tests too, which the same mutation breaks.
//  BS1 In yolo, a write that names main, master or HEAD as its branch reaches
//      Orthanc on some command of the surface. With `BRANCH_FLAGS` minus
//      `--branch`: 417 calls named, 65 tests fail. With the `--allow-default-branch`
//      refusal out of `branchRuleReason`: 139 calls, 9 tests. With the branch
//      *name* test out of both places that read it (`isBranchFlag`, which serves
//      `targetsProtected`, and the `flagValues(args, BRANCH_FLAGS)` line beside
//      it): 2178 calls, 24 tests. Taking only one of those two out changes
//      nothing: the class is matched twice today, and that redundancy had no test
//      before this file.
//  BS2 The ladder loosens, and the same call runs unasked in ask-always,
//      allow-edits or auto. The same three mutations: 330, 110 and 1758 calls in
//      allow-edits, and the same in auto. ask-always reports 0 under all of them,
//      because the ladder asks there for any write, so it has no hole to show.
//  BS3 A command whose own declared flags name a branch takes main on one of
//      them with no ask in yolo. The both-matchers mutation names 3.
//  BS4 An Orthanc write in Bash runs instead of going to orthanc_cli, on any
//      command of the surface. The Bash write refusal turned off: BS4 names 247
//      writes (`orthanc admin group create …` is the first), BS6 names 1240
//      lines, and 55 tests fail.
//  BS5 The other direction: a plain read in Bash is blocked, so the agent loses
//      the read lane zay asked for ("reads as plain `orthanc …`"). Only the two
//      reads whose whole answer is a secret stay refused, named below.
//      `admin group get` made operator-only: BS5 names it, 10 tests fail.
//  BS3c A branch named in a flag the write does not land on (a proposal's merge
//      target, a pull request's base, the base a branch moves from, a build's
//      fallback) flips from the answer the guard gives today. This test pins each
//      answer, so the decision changes on purpose and not by accident. Read off
//      the guard: four run in yolo as the promotion path, two are refused.
//  BS6 A word that spells a version opens the Bash write lane. `help` in policy.ts
//      counted any word spelling `-V` or `--version`, and read nothing else on the
//      line. Not hypothetical: `ontology action-type-set-function-version`
//      *requires* `--version`, and `functions query execute` takes it, so an agent
//      that spelled its command the way Orthanc asks ran a write with no branch
//      rule and no ladder, in every mode, while the same call through orthanc_cli
//      was refused. The gate now reads `helpVerb`; the shell case is K7 in
//      shell-guard.test.ts and the version-only line is U13 in self-update.test.ts.
//      Gate changed back to `help`: BS6 names 1004 calls, and K7 and U13 fail
//      with it, 8 tests. That is what origin/main ships today, so BS6 is the test
//      that keeps the fix shipped.
//  BS6b The same carve-out, the other way: `-h`, `--help` and `orthanc help …`
//      stay reads. A guard that refuses a usage print sends the agent to
//      orthanc_cli for text orthanc_cli answers the same way.
//  A sweep that reports hundreds of leaks at once must still report. The first
//      version returned every leaking call in one array, and the runner printed
//      "its run ended without a report" instead. Hence a count, then eight.
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

// Flags that hold a branch and are not the branch the write lands on. The sweep
// would otherwise report them, and BS3c below is where each one's real answer is
// written down instead: a proposal's source branch (`--branch-rid`, which takes a
// global branch RID, so `main` is not a value it can hold), a proposal's merge
// target (`--merge-to`, whose declared default *is* `main`), a pull request's
// target (`--base-branch`), the base a repo branch moves from (`--from`), and a
// build's fallback (`--fallback-branch`). Naming a branch is not writing it: each
// of these is the promotion path zay kept open on 2026-11-20 ("raise the proposal
// and merge the proposal, just nothing direct against main or master"), except
// `--fallback-branch`, which the guard refuses outright.
//
// `--branch` is not on this list, and no command may run a `--branch main` with
// no question, in yolo or anywhere else.
const NAMES_A_BRANCH_NOT_WRITTEN: Readonly<Record<string, readonly string[]>> = {
  'global-proposal create': ['--branch-rid', '--merge-to'],
  'repository pull-request create': ['--base-branch', '--head-commitish'],
  'repository branch update-from-base': ['--from'],
  'orchestration builds create': ['--fallback-branch'],
}

/** True when the only branch-naming flags in this call are ones the write does
 * not land on. `--branch` never qualifies, in BS1, BS2 or BS3. */
const allowedToNameMain = (path: string, args: readonly string[]) =>
  (NAMES_A_BRANCH_NOT_WRITTEN[path] ?? []).some(flag => args.includes(flag))

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

const everySpellingOfMain = (entry: ManifestCommand) => [
  // The flag the branch rule reads, in each spelling Y16 walks.
  ...MAINS.flatMap(main => FLAG_FORMS(main)),
  // The default branch asked for by name rather than by value. The guard refuses
  // this flag wherever it appears (policy.ts `branchRuleReason`), so trying it on
  // a command that never declares it cannot report a call Orthanc would run.
  ['--allow-default-branch'],
]

test('BS1: in yolo, no command of the tied surface runs a write that names its branch main', () => {
  // The pin is the whole surface, so a sweep this wide has writes in it.
  expect(WRITES.length > 200).toBe(true)
  nothingRan(runsUnasked('yolo', everySpellingOfMain))
})

for (const mode of ['ask-always', 'allow-edits', 'auto'] as const) {
  test(`BS2: in ${mode}, a write naming its branch main never runs unasked, on any command of the surface`, () => {
    nothingRan(runsUnasked(mode, everySpellingOfMain))
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

// What the guard decides today about a branch named in a flag that is not the
// branch a write lands on. Each row was read off the guard, not argued: run it
// wrong and this test fails, so the decision has to be looked at and changed on
// purpose. `run` here means yolo reaches Orthanc with no question, which is the
// promotion path zay kept open: the write those calls propose is
// `global-branch deploy` or `repository pull-request merge`, and both ask outside
// yolo. `block` means the guard refuses the call in every mode.
const BRANCH_NOT_THE_TARGET: ReadonlyArray<{ path: string; args: string[]; want: 'run' | 'block' | 'ask' }> = [
  { path: 'global-proposal create', args: ['Ship it', '--branch-rid', 'ri.branch..branch.00000000-0000-4000-8000-000000000001', '--merge-to', 'main', '--apply'], want: 'run' },
  { path: 'repository pull-request create', args: ['T', '--base-repository-rid', RID, '--head-commitish', 'agent/work', '--base-branch', 'refs/heads/master', '--apply'], want: 'run' },
  { path: 'repository branch update-from-base', args: [RID, '--from', 'main', '--apply'], want: 'run' },
  { path: 'repository pull-request merge', args: [RID, '--expect-head', 'abc123', '--apply', '--yes'], want: 'run' },
  { path: 'orchestration builds create', args: ['plan', '--fallback-branch', 'main', '--apply'], want: 'block' },
  { path: 'repository push', args: [RID, RID, 'refs/heads/agent/work', '--allow-default-branch'], want: 'block' },
]

test('BS3c: a branch named in a flag the write does not land on is decided on purpose', () => {
  const seen = BRANCH_NOT_THE_TARGET.map(
    row => `${row.want}  ${row.path} ${row.args.slice(1, 4).join(' ')}  ::  ${outcome('yolo', row.path, row.args)}`,
  )
  expect(seen).toEqual(BRANCH_NOT_THE_TARGET.map(row => `${row.want}  ${row.path} ${row.args.slice(1, 4).join(' ')}  ::  ${row.want}`))
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

// A word that spells a version is not a read of documentation, and it must not
// open the Bash write lane: `help` in policy.ts counted `-V` and `--version`, and
// three commands declare `--version` as their own option — one requires it — so an
// agent that spelled its command correctly ran a write with no guard at all. The
// spellings below go on every write, declared or not: the pin drops the
// declarations of every command that is not marked, so it cannot say which
// commands take these flags, and the guard must not run any of them either way.
const BYPASS_WORDS = [['--version'], ['--version', 'v0.7.1'], ['--version=v0.7.1'], ['-V'], ['-V', 'v0.7.1']]

test('BS6: no version spelling opens the Bash write lane, on any command of the surface', () => {
  const escapes: string[] = []
  for (const entry of WRITES) {
    for (const extra of BYPASS_WORDS) {
      const line = ['orthanc', entry.path, ...call(entry, extra)].join(' ')
      if (classifyCall('Bash', { command: line }, SURFACE, null) === null) escapes.push(line)
    }
  }
  expect(escapes.length).toBe(0)
  expect(escapes.slice(0, 8)).toEqual([])
})

test('BS6b: `-h`, `--help` and `orthanc help …` stay reads, on any command of the surface', () => {
  // The other half: the fix must not turn a usage print into a refusal.
  const refused: string[] = []
  for (const entry of WRITES) {
    for (const line of [
      ['orthanc', entry.path, '--help'].join(' '),
      ['orthanc', entry.path, '-h'].join(' '),
      ['orthanc', 'help', entry.path].join(' '),
    ]) {
      if (classifyCall('Bash', { command: line }, SURFACE, null) !== null) refused.push(line)
    }
  }
  expect(refused.length).toBe(0)
  expect(refused.slice(0, 8)).toEqual([])
})

test('BS5: Bash runs every read of the tied surface except the two that answer with a secret', () => {
  const blocked = SURFACE.filter(entry => entry.kind === 'read-only')
    .filter(entry => classifyCall('Bash', { command: ['orthanc', entry.path, RID, RID].join(' ') }, SURFACE, null) !== null)
    .map(entry => entry.path)
  expect(blocked.sort()).toEqual([...SECRET_READS].sort())
})
