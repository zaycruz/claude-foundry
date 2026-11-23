// Two commands whose manifest entry says `kind: read-only` — nothing on Foundry
// changes — and whose flags say the call writes the machine the agent works on.
// The read short-circuit ran both in every approval mode and in Bash, with no
// ladder, no ask and no trace as a write.
//
// Measured on the sha-256-verified orthanc v0.7.12 release binary (archive
// 1983c18a179c54ef1b4f9b18c50acd3db9c364d61f3d5e7cbfa73eea06c0e424, built from
// commit 7b54958) and read out of orthanc-source origin/main:
//  - `repository clone <rid> <dir> --force`: src/repository_git.rs `run_clone`
//    calls `std::fs::remove_dir_all(target)` on a non-empty target, then
//    `git clone` into it. Without --force a non-empty target is a usage error,
//    so a plain clone writes only where nothing was.
//  - `dev-console sdk install --yes | --target <dir>`: src/dev_console_local.rs
//    runs the steps src/dev_console_local_support.rs builds — `npm install
//    --registry … <name>@<version>` or `python3 -m pip install …` — of a package
//    name and version taken from the application's SDK definition response. The
//    install scripts of a package the server named run as this agent's user.
//    With neither --yes nor --target, and with --dry-run, both commands print
//    the plan and run nothing.
//
// This is not "any read with a file flag": `sql export --out f.csv`,
// `ontology bulk-get --out f.json` and `global-branch diff --output f` write a
// data file and stay reads (hooks/operator-handoff.test.ts Q6). The line is
// drawn at a call that deletes something already there or runs another program.
//
// Ways this can fail, written before the code:
//  LW1 `orthanc_cli repository clone … --force` runs as a read: a local
//      directory tree is gone with no ask in any mode. It is judged by the
//      ladder; yolo runs it (zay, 2026-11-17: deletes run in yolo).
//  LW2 The rule reads one position: `--force` first, last, or after the
//      positional, or `--force=<v>`, is missed.
//  LW3 The rule eats the ordinary clone. The plugin's own skill tells the agent
//      to run `orthanc repository clone <rid> <dir>` as plain orthanc; a plain
//      clone stays a read in the ladder and in Bash.
//  LW4 Bash runs the --force clone anyway: every mode blocks it and points at
//      orthanc_cli, and orthanc never starts.
//  LW5 `dev-console sdk install` is judged with each flag that makes it run
//      (--target ./app, --target=./app, --yes), and stays a read with none of
//      them, or with --dry-run — orthanc returns before the local step.
//  LW6 A read that writes a data file still runs in every mode: the rule is
//      these two commands, not "a read that touches the disk".
//  LW7 `orthanc_help` says it on the page the agent is reading, so the agent is
//      not sent to spend a call finding out; a page for another command says
//      nothing about it.
//  LW8 The two names and their `read-only` kind are pinned against
//      hooks/orthanc-manifest.snapshot.ts, so a rename — or an orthanc-side mark
//      that makes this rule redundant — fails here loudly instead of silently.
//  LW9 Through the real hooks: ask-always asks once, orthanc never starts until
//      the operator approves, and after approval the call runs.
//  LW10 The operator's question and the Bash refusal carry the fact the rule
//      exists to state (what the call does locally), so the ask is not just
//      'a mutation waits for approval'. Measured on the v0.7.12 binary: orthanc
//      refuses `--dry-run=false` ('unexpected value … no more were expected'), so
//      the plan exemption reads the switch exactly, and a spelled value keeps the
//      write rather than quietly dropping to a read.
//  LW12 The plan exemption reads the switch and nothing else: `--force
//      --dry-run` in either order is the plan orthanc prints, `--target
//      --dry-run` is that option's value (an install into a folder named
//      `--dry-run`), `--dry-run=false` is a spelling the binary refuses, and
//      `--target=./app --dry-run` binds its own value and leaves the switch.
//  LW14 The same answers hold against a manifest that no longer lists these
//      flags: an option whose shape the guard cannot read owns the word after
//      it, so the unknown shape asks rather than plans (the rule
//      `baseBranchOnWorkBranch` applies to the same pflag hazard).
//  LW15 The question names the call's own words, so the operator sees which
//      folder is deleted and which application's packages are installed — not
//      only that some folder goes.
//  LW16 The same sentence is in the reason a run leaves behind (the trace line is
//      all the operator sees afterwards for a write yolo ran with no ask).
//  LW17 modeGuidance, the sentence the model is told every turn, names the two
//      commands in all four modes: a rule the model is not told reads as a hang
//      (hooks/destructive.test.ts D11).
//  LW19 A long argv is cut, and JSON escaping keeps an argument from starting a
//      line of its own in the question the operator reads.
//  LW18 The yolo ask for a `--branch main --force` clone does not tell the agent
//      to pass a work branch: that flag is a Code Repository branch, and a
//      branch changes nothing about what the call deletes.
//  LW11 A Code Repository branch named main, or HEAD, on a plain clone stays a
//      read: its --branch is not a Foundry branch (FDE mode pins nothing to a
//      clone, hooks/register.tsx fdeGate). With --force the same call is judged
//      by --force, not by the branch it pulls.
//
// Synthetic stack only: placeholder RIDs, no stack data, nothing on disk.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { renderCommand } from './orthanc'
import { SNAPSHOT } from './orthanc-manifest.snapshot'
import { classifyCall, ladderDecision, modeGuidance, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const REPO = 'ri.code.main.repo.c0000000-0000-4000-8000-0000000000c4'
const APP = 'ri.foundry.main.deployed-app.c0000000-0000-4000-8000-0000000000c5'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

// The two commands as orthanc 0.7.12 declares them, plus the reads a rule that
// over-reads would catch with them.
const MANIFEST: ManifestCommand[] = [
  { path: 'agent-manifest', kind: 'local' },
  { path: 'repository clone', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--branch', takesValue: true }, { flag: '--force', takesValue: false }, { flag: '--dry-run', takesValue: false }] },
  { path: 'dev-console sdk install', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--yes', takesValue: false }, { flag: '--target', takesValue: true }, { flag: '--dry-run', takesValue: false }, { flag: '--format', takesValue: true }] },
  { path: 'sql export', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--out', takesValue: true }] },
  { path: 'ontology bulk-get', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--out', takesValue: true }, { flag: '--force', takesValue: false }] },
  { path: 'global-branch diff', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--output', takesValue: true }] },
  { path: 'repository list', kind: 'read-only', auth: 'bearer-token' },
]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const MANIFEST_TEXT = envelope({ commands: MANIFEST.map(entry => ({ path: entry.path, kind: entry.kind, args: [] })) })

/** 'run' as null: the guard has no classification for the call, so nothing asks and it runs. */
const decide = (mode: Mode, tool: string, input: Record<string, unknown>) => {
  const classified = classifyCall(tool, input, MANIFEST, 'agent/foundry-fix-12')
  return classified === null ? null : ladderDecision(mode, classified, { action: 'approve', reason: 'guard model absent' }).outcome
}
const cli = (command: string, args: string[]) => MODES.map(mode => decide(mode, CLI, { command, args }))
const bash = (command: string) => MODES.map(mode => decide(mode, 'Bash', { command }))
const reasonOf = (tool: string, input: Record<string, unknown>, mode: Mode) => {
  const classified = classifyCall(tool, input, MANIFEST, null)
  if (classified === null) return ''
  return ladderDecision(mode, classified, { action: 'approve', reason: 'guard model absent' }).reason
}

test('LW1: a --force clone is judged as a write; yolo runs it and no other mode does', () => {
  expect(cli('repository clone', [REPO, './repo', '--force'])).toEqual(['ask', 'ask', 'ask', 'run'])
})

test('LW2: --force counts in every position the agent can put it in', () => {
  for (const args of [
    ['--force', REPO, './repo'],
    [REPO, '--force', './repo'],
    [REPO, './repo', '--force'],
  ]) {
    expect({ args, modes: cli('repository clone', args) }).toEqual({ args, modes: ['ask', 'ask', 'ask', 'run'] })
  }
})

test('LW3: a plain clone is still a read, in the ladder and in Bash', () => {
  expect(cli('repository clone', [REPO, './repo'])).toEqual([null, null, null, null])
  expect(cli('repository clone', [REPO, './repo', '--dry-run'])).toEqual([null, null, null, null])
  expect(bash('orthanc repository clone ri.code.main.repo.c0000000-0000-4000-8000-0000000000c4 ./repo')).toEqual([null, null, null, null])
})

test('LW4: Bash runs no --force clone in any mode and points at orthanc_cli', () => {
  expect(bash(`orthanc repository clone ${REPO} ./repo --force`)).toEqual(['block', 'block', 'block', 'block'])
  expect(reasonOf('Bash', { command: `orthanc repository clone ${REPO} ./repo --force` }, 'yolo')).toContain('orthanc_cli')
})

test('LW5: sdk install is judged with each flag that makes it run, and stays a plan without them', () => {
  for (const args of [['--target', './app'], ['--target=./app'], ['--yes'], ['ri.app', '--yes', '--format', 'json']]) {
    expect({ args, modes: cli('dev-console sdk install', args) }).toEqual({ args, modes: ['ask', 'run', 'run', 'run'] })
  }
  for (const args of [[APP], ['--dry-run'], [APP, '--dry-run', '--yes'], [APP, '--target', './app', '--dry-run']]) {
    expect({ args, read: cli('dev-console sdk install', args) }).toEqual({ args, read: [null, null, null, null] })
  }
})

test('LW6: a read that writes a data file still runs in every mode', () => {
  expect(cli('sql export', ['select 1', '--out', '/tmp/x.csv'])).toEqual([null, null, null, null])
  expect(cli('ontology bulk-get', ['--all', '--out', '/tmp/x.json', '--force'])).toEqual([null, null, null, null])
  expect(cli('global-branch diff', ['ri.branch..branch.abc', '--output', '/tmp/x.json'])).toEqual([null, null, null, null])
  expect(cli('repository list', [])).toEqual([null, null, null, null])
})

test('LW7: orthanc_help says it on the page of each command, and on no other', () => {
  expect(renderCommand(MANIFEST[1]!, null)).toContain('deletes')
  expect(renderCommand(MANIFEST[2]!, null)).toContain('npm')
  for (const entry of MANIFEST.slice(3)) {
    const page = renderCommand(entry, null)
    expect(page.includes('deletes') || page.includes('npm install')).toBe(false)
  }
})

// The two facts this guard rests on, read out of the manifest the plugin ships
// with: each entry still says `read-only` (orthanc can still mislabel it), and
// the flag that makes the call write this machine is still there, still spelled
// this way, and `--dry-run` is still a switch. scripts/orthanc-tie.mjs keeps
// these two entries' flags in the pin for exactly this test — an entry with no
// approval key carries no flags otherwise. A rename, a dropped flag, or a
// `--dry-run` that starts taking a value fails here instead of leaving the
// guard under-reading with the suite green.
type Pinned = { path: string; kind: string; args?: { flag: string; takes_value: boolean }[] }
const PINNED_SHAPE: Record<string, { kind: string; flags: [string, boolean][] }> = {
  'repository clone': { kind: 'read-only', flags: [['--force', false], ['--dry-run', false]] },
  'dev-console sdk install': { kind: 'read-only', flags: [['--yes', false], ['--target', true], ['--dry-run', false]] },
}

test('LW8: the pinned manifest still mislabels both, with the flags this rule reads', () => {
  const commands = (SNAPSHOT as unknown as { commands: Pinned[] }).commands
  for (const [path, want] of Object.entries(PINNED_SHAPE)) {
    const entry = commands.find(candidate => candidate.path === path)
    expect({ path, entry: entry === undefined ? 'missing' : entry.kind }).toEqual({ path, entry: want.kind })
    const given = new Map((entry?.args ?? []).map(flag => [flag.flag, flag.takes_value]))
    for (const [flag, takesValue] of want.flags) {
      expect({ path, flag, declared: given.get(flag) ?? 'missing' }).toEqual({ path, flag, declared: takesValue })
    }
  }
})

test('LW10: the ask and the Bash refusal say what the call does to this machine', () => {
  const clone = reasonOf('Bash', { command: `orthanc repository clone ${REPO} ./repo --force` }, 'auto')
  expect(clone).toContain('deletes what is already in the target folder')
  const install = reasonOf('Bash', { command: `orthanc dev-console sdk install ${APP} --target ./app` }, 'auto')
  expect(install).toContain('npm or pip install')
  const asked = classifyCall(CLI, { command: 'repository clone', args: [REPO, './repo', '--force'] }, MANIFEST, null)!
  expect(ladderDecision('ask-always', asked, { action: 'ask', reason: 'guard says no' }).reason).toContain('deletes what is already in the target folder')
  const planned = classifyCall(CLI, { command: 'dev-console sdk install', args: [APP, '--target', './app', '--dry-run=false'] }, MANIFEST, null)
  expect(planned).not.toBe(null)
})

// The trace line a ran write leaves is what the operator reads afterwards, and
// in yolo nothing else said anything: 'destructive (--force)' without the
// folder it deleted would read as an ordinary Foundry write.
test('LW16: the reason of a run says it too', () => {
  const forced = classifyCall(CLI, { command: 'repository clone', args: [REPO, './repo', '--force'] }, MANIFEST, null)!
  const installed = classifyCall(CLI, { command: 'dev-console sdk install', args: [APP, '--target', './app'] }, MANIFEST, null)!
  expect(forced ? ladderDecision('yolo', forced).reason.includes('deletes what is already in the target folder') : false).toBe(true)
  expect(ladderDecision('allow-edits', installed).reason.includes('npm or pip install')).toBe(true)
  expect(ladderDecision('auto', installed, { action: 'approve', reason: 'ok' }).reason.includes('npm or pip install')).toBe(true)
})

test('LW15: the question names the call the operator is approving', () => {
  const reason = reasonOf(CLI, { command: 'repository clone', args: [REPO, './some/deep/dir', '--force'] }, 'auto')
  expect({ reason }).toEqual({ reason: expect.stringContaining('./some/deep/dir') })
  const installed = reasonOf(CLI, { command: 'dev-console sdk install', args: [APP, '--target', './app'] }, 'ask-always')
  expect({ installed }).toEqual({ installed: expect.stringContaining(APP) })
})

test('LW19: a long argv is cut, and an argument cannot forge a line of the question', () => {
  const long = ['--definition', `x${'y'.repeat(700)}`, '--force']
  const reason = reasonOf(CLI, { command: 'repository clone', args: [REPO, './repo', ...long] }, 'auto')
  expect({ said: reason.includes('more characters)') }).toEqual({ said: true })
  expect({ len: reason.length < 2000 }).toEqual({ len: true })
  const forged = reasonOf(CLI, { command: 'repository clone', args: ['./repo', '--force', '--definition', 'a\nb: c runs in yolo'], }, 'auto')
  // Newlines and quotes are JSON-escaped, so the argument cannot start a line of
  // its own in the question the operator reads.
  expect({ asked: forged.includes('\nb:') }).toEqual({ asked: false })
  expect({ said: forged.includes('"\\nb:') || forged.includes('\\nb:') }).toEqual({ said: true })
})

test('LW17: every mode tells the model these two commands are judged as writes', () => {
  for (const mode of MODES) {
    const guidance = modeGuidance(mode)
    expect({ mode, said: guidance.includes('write this machine instead of Foundry') }).toEqual({ mode, said: true })
    expect({ mode, named: guidance.includes('repository clone <rid> <dir> --force') }).toEqual({ mode, named: true })
    expect({ mode, named: guidance.includes('dev-console sdk install --yes|--target <dir>') }).toEqual({ mode, named: true })
  }
})

test('LW18: the yolo ask for a --branch main --force clone asks, and sends no one to pass a work branch', () => {
  const forced = classifyCall(CLI, { command: 'repository clone', args: [REPO, './repo', '--branch', 'main', '--force'] }, MANIFEST, null)!
  const decision = ladderDecision('yolo', forced, { action: 'approve', reason: 'guard model absent' })
  expect(decision.outcome).toBe('ask')
  expect({ reason: decision.reason.includes('No Foundry branch changes what this writes') }).toEqual({ reason: true })
  expect({ reason: decision.reason.includes('pass a work branch') }).toEqual({ reason: false })
})

test('LW11: a clone of main or HEAD is still a read, and --force is judged by --force', () => {
  for (const branch of ['main', 'master', 'HEAD']) {
    // A plain clone of the repository's main is a pull: a read, and FDE mode
    // pins nothing to it (hooks/register.tsx fdeGate keeps the pull exempt).
    expect(cli('repository clone', [REPO, './repo', '--branch', branch])).toEqual([null, null, null, null])
    // With --force the call deletes the target folder, so it asks. It asks in
    // yolo too: the guard reads a branch flag naming main and cannot tell from
    // argv that this one is a Code Repository branch. That over-read costs a
    // prompt, the under-read would cost the directory.
    expect(cli('repository clone', [REPO, './repo', '--branch', branch, '--force'])).toEqual(['ask', 'ask', 'ask', 'ask'])
  }
})

test('LW12: the plan switch is the switch, not a word that happens to say it', () => {
  // Both orders ask only for a plan: orthanc returns before remove_dir_all /
  // execute_step when dry_run is set (src/repository_git.rs, dev_console_local.rs).
  expect(cli('repository clone', [REPO, './repo', '--force', '--dry-run'])).toEqual([null, null, null, null])
  expect(cli('repository clone', [REPO, './repo', '--dry-run', '--force'])).toEqual([null, null, null, null])
  // --dry-run after a value-taking option is that option's value: an install into
  // a folder named `--dry-run`. That is the write, not the plan.
  expect(cli('dev-console sdk install', [APP, '--target', '--dry-run'])).toEqual(['ask', 'run', 'run', 'run'])
  // The binary refuses a value on this switch, so a spelled value is not a plan.
  expect(cli('dev-console sdk install', [APP, '--target', './app', '--dry-run=false'])).toEqual(['ask', 'run', 'run', 'run'])
  // A flag that binds its own value leaves the next word free: this is the plan
  // orthanc prints (dev_console_local.rs line 172).
  expect(cli('dev-console sdk install', [APP, '--target=./app', '--dry-run'])).toEqual([null, null, null, null])
})

// LW14: a manifest that stopped describing these flags must not talk the guard
// out of the write. Every other argv reader in hooks/policy.ts asks more when a
// flag has no shape (`givenFlags`, `positionals`, `baseBranchOnWorkBranch`);
// reading an undeclared `--target` as valueless would answer 'plan' and let the
// npm install through Bash, allow-edits, auto and yolo.
const BLIND_MANIFEST: ManifestCommand[] = MANIFEST.map(entry =>
  entry.path === 'repository clone' || entry.path === 'dev-console sdk install' ? { ...entry, flags: [] } : entry,
)
const blind = (command: string, args: string[]) =>
  MODES.map(mode => ladderDecision(mode, classifyCall(CLI, { command, args }, BLIND_MANIFEST, null)!, { action: 'approve', reason: 'guard model absent' }).outcome)

test('LW14: with no flag shapes in the manifest, the plan spelling still asks', () => {
  expect(blind('dev-console sdk install', [APP, '--target', '--dry-run'])).toEqual(['ask', 'run', 'run', 'run'])
  expect(blind('repository clone', [REPO, './repo', '--branch', '--dry-run', '--force'])).toEqual(['ask', 'ask', 'ask', 'run'])
  // The write-flag test itself needs no shapes: a bare --force is a write with or
  // without a manifest that describes it.
  expect(blind('repository clone', [REPO, './repo', '--force'])).toEqual(['ask', 'ask', 'ask', 'run'])
})

// One harness per test: the kit forbids registering hooks after the first $ call.
const BASH_LOCAL_WRITES: readonly [string, string, string, string][] = [
  ['clone --force', `orthanc repository clone ${REPO} ./repo --force`, 'repository clone', 'deletes what is already in the target folder'],
  ['sdk install --target', `orthanc dev-console sdk install ${APP} --target ./app`, 'dev-console sdk install', 'npm or pip install'],
]
for (const mode of MODES) {
  for (const [name, command, prefix, why] of BASH_LOCAL_WRITES) {
    test(`LW13: in ${mode}, Bash denies ${name}, asks no one and starts no orthanc`, async ($, on) => {
      const h = harness(on, mode)
      h.answer = 'throw'
      const denied = (await $.tool.call({ tool: 'Bash', command } as never)) as { deny?: string }
      expect({ command, denyType: typeof denied.deny }).toEqual({ command, denyType: 'string' })
      expect({ command, namesWhy: (denied.deny ?? '').includes(why) }).toEqual({ command, namesWhy: true })
      expect({ command, asked: h.asked }).toEqual({ command, asked: [] })
      expect({ command, started: ran(h, prefix) }).toEqual({ command, started: [] })
    })
  }
}

type Harness = { calls: string[]; asked: string[]; answer: string; store: Map<string, unknown> }

function harness(on: On, mode: Mode): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve', store: new Map<string, unknown>([['approvalMode', mode]]) }
  on('process.run', (_$, e) => {
    const words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    h.calls.push(words.join(' '))
    if (words.join(' ') === 'agent-manifest') return { value: { exitCode: 0, stdout: MANIFEST_TEXT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: envelope({ ran: words.join(' ') }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: {} }
  })
  on('store.get', (_$, e) => ({ value: h.store.get(e.key) }))
  on('store.set', (_$, e) => {
    h.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } as never }))
  on('fs.read', (_$, e) => {
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test: no surface' } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('classic.SubagentStart', () => ({}))
  on('tool.call', (_$, e) => {
    const call = e as unknown as { tool: string; questions?: { question: string }[] }
    if (call.tool !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = call.questions?.[0]?.question ?? ''
    h.asked.push(question)
    return { result: { questions: call.questions, answers: { [question]: h.answer } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const cliCall = ($: Engine, command: string, args: string[]) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, prefix: string) => h.calls.filter(call => call.startsWith(prefix))

test('LW9a: in ask-always a --force clone waits for the operator, and nothing else asks', async ($, on) => {
  const h = harness(on, 'ask-always')
  h.answer = 'throw'
  const denied = await cliCall($, 'repository clone', [REPO, './repo', '--force'])
  expect(typeof denied.deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'repository clone')).toEqual([])
  h.answer = 'Approve'
  expect((await cliCall($, 'repository clone', [REPO, './repo', '--force'])).deny).toBe(undefined)
  expect(ran(h, 'repository clone').length).toBe(1)
})

test('LW9b: a plain clone in yolo still runs with no ask', async ($, on) => {
  const h = harness(on, 'yolo')
  h.answer = 'throw'
  expect((await cliCall($, 'repository clone', [REPO, './repo'])).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(ran(h, 'repository clone').length).toBe(1)
})
