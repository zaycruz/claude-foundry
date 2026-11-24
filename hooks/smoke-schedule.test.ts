// `orthanc smoke --schedule` says `kind: read-only` in the agent manifest, and it is
// not a read of anything: it installs a daily job on the machine the agent works on.
//
// Measured with orthanc 0.7.11 (the installed binary) and $HOME pointed at an empty
// folder, so nothing of the operator's was touched. On Linux the call ends in a
// usage error, and the files are written before that error:
//
//   $ HOME=<empty> orthanc --agent --non-interactive smoke --schedule
//   {"errors":[{"message":"launchctl bootstrap failed: No such file or directory (os error 2)","type":"usage-error"}],…}   exit 1
//   $ find <empty> -mindepth 1
//   <empty>/.orthanc-smoke
//   <empty>/Library/LaunchAgents/com.raava.orthanc.smoke.plist     ← the job, with the live binary's path baked in
//
// On macOS the same call returns `mode: installed`: `launchctl bootstrap gui/<uid>
// ~/Library/LaunchAgents/com.raava.orthanc.smoke.plist`, which runs `orthanc smoke`
// every day at 09:00 local through the default profile (orthanc refuses `--profile`
// for it, so it cannot be pointed at a scratch profile). It is not undone
// by anything in the session: the agent that ran it leaves the machine with a
// recurring job. `--unschedule` boots that job out and `remove_file`s the plist:
//
//   $ HOME=<empty> orthanc --agent --non-interactive smoke --unschedule
//   {"data":{"label":"com.raava.orthanc.smoke","mode":"removed","plist_removed":true},…}   exit 0
//
// The two calls this rule must leave alone were measured the same way. Plain
// `smoke` runs the checks, and src/smoke.rs:5 says of them: "It mutates nothing;
// every check is a read or a rejected write" (not run here: it reads a live
// stack). The status read answered with the job's state and asked for nothing:
//
//   $ HOME=<empty> orthanc --agent --non-interactive smoke schedule
//   {"data":{"installed":false,"loaded":false,"plist_present":true,…},"errors":[],…}   exit 0
//
// Source (orthanc-source origin/main 42f9118, src/smoke.rs): `install_schedule`
// create_dir_all → std::fs::write(plist_path) → Command::new("launchctl")
// bootstrap; `remove_schedule` → launchctl bootout → std::fs::remove_file. The
// manifest entry is `kind: read-only` with `--schedule` and `--unschedule` as
// switches (orthanc 0.7.11 and 0.7.13 both).
//
// Ways this can fail, written before the code:
//  SS1 `orthanc_cli smoke --schedule` is read as a read: no ladder, no ask, in
//      every mode, and no run trace saying a job was installed. (Measured on main
//      before the rule: ['run','run','run','run'], asked = none.)
//  SS2 `--unschedule` is the same call's delete half: boots the job out and removes
//      the plist, and must be judged with it.
//  SS2b `--force` is destructive by the plugin's own rule, whatever the command, so
//      a call carrying it asks in `allow-edits` and `auto` too (yolo still runs it):
//      the local-write class and the destructive class stay two separate reasons.
//  SS2c Orthanc refuses `--profile` with `--schedule` (src/smoke.rs:287), and the
//      plugin's profile gate blocks the call in every mode before that: nothing
//      runs. Pinned, because the sentence it gets names a stack this call has none
//      of, and a gate that stops blocking it must be a decision, not a drift.
//  SS3 Bash runs `orthanc smoke --schedule` through the shell, where no ladder
//      applies at all: refused in every mode, pointed at orthanc_cli.
//  SS4 The rule over-reads. Plain `orthanc smoke` runs the checks (reads, and the
//      plugin's own surface for them) and `orthanc smoke schedule` shows whether the
//      job is loaded; both stay reads in the ladder and in Bash.
//  SS5 The operator's question, the Bash refusal and the reason a run leaves behind
//      name what is installed (a daily launchd job, the default profile), not
//      'a mutation waits for approval' (the pattern of LW10/LW16).
//  SS6 `orthanc_help` says it on the `smoke` page, so the agent learns it there
//      instead of spending a call, and on no other page.
//  SS7 modeGuidance names the command in all four modes: a rule the model is not
//      told reads as a hang (destructive.test.ts D11, local-write.test.ts LW17).
//  SS8 The shipped manifest pin still mislabels it — `smoke` is `read-only`,
//      `smoke schedule` is `local` — so a rename, or an orthanc-side mark that
//      makes this rule redundant, fails here loudly (the shape of LW8, without the
//      flag data: this rule reads the call's own argv, not the pinned flags).
//  SS9 The flag is matched however the agent spells it: before or after another
//      word, quoted, and with the two flags together (clap rejects that pair, and
//      a call that runs nothing is still not read as a plan). `--schedule` takes no
//      value, so `--schedule=true` is a spelling the binary refuses: it keeps the
//      write rather than quietly dropping to a read.
//  SS10 In yolo the call runs — the class `repository clone --force` is in
//      (local-write.test.ts LW1/LW2): a write to this machine, not a Foundry branch
//      write, so it asks outside yolo and runs in yolo. No branch rule applies to
//      it: `smoke` is not branch-scoped, and a `--branch` it does not define must
//      not be read as a write aimed at main.
//  SS13 `smoke` has no plan switch, so a `--dry-run` in front of `--schedule`
//      must not talk the guard out of the write. Measured on the installed
//      binary: `smoke --dry-run --schedule` answers `unexpected argument
//      '--dry-run' found`, so the call runs nothing — and a guard that read it
//      as a plan would call a refused call a read, and run it in Bash. The
//      exemption is read from the entry: an entry that does list `--dry-run`
//      (as `repository clone` and `dev-console sdk install` do) keeps its plan.
//  SS14 The exemption comes from the entry, not from the word. The same command
//      with an entry that does declare `--dry-run` reads as a plan, and
//      `--schedule` alone still asks.
//
// One more measured fact, because it decides what an approval through the mod can
// do. orthanc_cli runs every call on the session's stack (`hooks/register.tsx`
// passes `--profile <active>` into argv), and the schedule refuses any profile:
//
//   $ orthanc --agent --non-interactive --profile default smoke --schedule
//   {"errors":[{"message":"the scheduled smoke runs the default profile; configure the
//     default instead","type":"usage-error"}],…}                                      exit 1
//   $ find <empty-home> -mindepth 1
//   (nothing)
//
// So through orthanc_cli the install stops at that refusal, and it stops before
// anything is written. `--unschedule` has no such check (`remove_schedule` takes
// no profile: `mode: removed`, `plist_removed: true` above), so the way to take a
// job down stays open. The rule still matters: `smoke --schedule` with no stack
// in the session, and the same call in Bash, are the paths that would install.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { renderCommand } from './orthanc'
import { SNAPSHOT } from './orthanc-manifest.snapshot'
import { classifyCall, ladderDecision, modeGuidance, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]
const READ = [null, null, null, null]

// The entries as orthanc 0.7.13 declares them, plus the reads a rule that
// over-reads would catch with them.
const MANIFEST: ManifestCommand[] = [
  { path: 'agent-manifest', kind: 'local' },
  { path: 'smoke', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--schedule', takesValue: false }, { flag: '--unschedule', takesValue: false }] },
  { path: 'smoke schedule', kind: 'local' },
  { path: 'version', kind: 'local' },
  { path: 'repository list', kind: 'read-only', auth: 'bearer-token' },
  { path: 'sql export', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--out', takesValue: true }] },
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

test('SS1: orthanc_cli smoke --schedule is judged a write, not a read', () => {
  expect(cli('smoke', ['--schedule'])).toEqual(['ask', 'run', 'run', 'run'])
})

test('SS2: --unschedule is judged with it, in every position the agent can put it in', () => {
  for (const args of [['--unschedule'], ['--schedule']]) {
    expect({ args, modes: cli('smoke', args) }).toEqual({ args, modes: ['ask', 'run', 'run', 'run'] })
  }
})

// `--force` reads as destructive by the plugin's own rule, whatever the command,
// so a call that carries it asks in `allow-edits` and `auto` as well as in
// `ask-always`. yolo still runs it (destructive writes run there), so this is a
// second, separate reason on top of the local one — pinned so the two classes
// cannot be collapsed into one another.
test('SS2b: smoke --force --schedule also reads as destructive, and asks in every mode but yolo', () => {
  expect(cli('smoke', ['--force', '--schedule'])).toEqual(['ask', 'ask', 'ask', 'run'])
})

// Orthanc itself refuses `--profile` with `--schedule` ("the scheduled smoke runs
// the default profile", src/smoke.rs:287), and the plugin's profile gate gets
// there first: the call is blocked in every mode, so nothing runs and no agent
// finds a way to install the job on a stack of its own choosing. The sentence it
// gets names a stack, which this call has none of; a block with that sentence is
// the safe direction, and is pinned here so a future profile-gate change notices.
test('SS2c: smoke --profile probe --schedule is blocked in every mode, not run', () => {
  expect(cli('smoke', ['--profile', 'probe', '--schedule'])).toEqual(['block', 'block', 'block', 'block'])
})

test('SS3: Bash runs no scheduled-smoke install in any mode and points at orthanc_cli', () => {
  for (const command of ['orthanc smoke --schedule', 'orthanc smoke --unschedule', "orthanc smoke '--schedule'", 'orthanc --profile probe smoke --schedule']) {
    expect({ command, modes: bash(command) }).toEqual({ command, modes: ['block', 'block', 'block', 'block'] })
  }
  expect(reasonOf('Bash', { command: 'orthanc smoke --schedule' }, 'yolo')).toContain('orthanc_cli')
})

test('SS4: the checks and the status read are still reads, in the ladder and in Bash', () => {
  expect(cli('smoke', [])).toEqual(READ)
  expect(cli('smoke schedule', [])).toEqual(READ)
  expect(bash('orthanc smoke')).toEqual(READ)
  expect(bash('orthanc smoke schedule')).toEqual(READ)
  // A read that writes a data file is still a read (operator-handoff.test.ts Q6).
  expect(cli('sql export', ['select 1', '--out', '/tmp/x.csv'])).toEqual(READ)
  expect(cli('repository list', [])).toEqual(READ)
})

test('SS5: the ask, the refusal and the reason of a run say what job gets installed', () => {
  const asked = ladderDecision('ask-always', classifyCall(CLI, { command: 'smoke', args: ['--schedule'] }, MANIFEST, null)!, {
    action: 'ask',
    reason: 'guard says no',
  }).reason
  expect(asked).toContain('launchd')
  expect(asked).toContain('daily')
  expect(asked).toContain('--schedule')
  expect(reasonOf('Bash', { command: 'orthanc smoke --schedule' }, 'auto')).toContain('launchd')
  // In yolo nothing else said anything, so the trace line is all the operator sees.
  const ranReason = ladderDecision('yolo', classifyCall(CLI, { command: 'smoke', args: ['--schedule'] }, MANIFEST, null)!).reason
  expect(ranReason).toContain('launchd')
  expect(ladderDecision('allow-edits', classifyCall(CLI, { command: 'smoke', args: ['--unschedule'] }, MANIFEST, null)!).reason).toContain('launchd')
})

test('SS6: orthanc_help says it on the smoke page, and on no other page', () => {
  expect(renderCommand(MANIFEST[1]!, null)).toContain('this machine')
  expect(renderCommand(MANIFEST[2]!, null)).not.toContain('this machine')
  for (const entry of MANIFEST.slice(3)) expect(renderCommand(entry, null)).not.toContain('this machine')
})

test('SS7: every mode tells the model this command is judged as a write', () => {
  for (const mode of MODES) {
    const guidance = modeGuidance(mode)
    expect({ mode, said: guidance.includes('write this machine instead of Foundry') }).toEqual({ mode, said: true })
    expect({ mode, named: guidance.includes('smoke --schedule') }).toEqual({ mode, named: true })
  }
})

test('SS8: the pinned manifest still mislabels smoke, and still calls the status read local', () => {
  const commands = (SNAPSHOT as unknown as { commands: { path: string; kind: string }[] }).commands
  const kindOf = (path: string) => commands.find(entry => entry.path === path)?.kind ?? 'missing'
  expect({ path: 'smoke', kind: kindOf('smoke') }).toEqual({ path: 'smoke', kind: 'read-only' })
  expect({ path: 'smoke schedule', kind: kindOf('smoke schedule') }).toEqual({ path: 'smoke schedule', kind: 'local' })
})

test('SS9: the flag is matched however it is spelled, and a refused spelling keeps the write', () => {
  for (const args of [['--schedule'], ['--schedule', '--unschedule'], ['--schedule=true'], ['--SCHEDULE'], ["'--schedule'"]]) {
    expect({ args, modes: cli('smoke', args) }).toEqual({ args, modes: ['ask', 'run', 'run', 'run'] })
  }
})

test('SS10: in yolo the call runs, with no branch advice attached to it', () => {
  // The local-write class: yolo runs it (LW1, LW2), and the ask is not about a branch.
  const scheduled = classifyCall(CLI, { command: 'smoke', args: ['--schedule'] }, MANIFEST, null)!
  expect(ladderDecision('yolo', scheduled).outcome).toBe('run')
  const declined = classifyCall(CLI, { command: 'smoke', args: ['--schedule'] }, MANIFEST, null)!
  const reason = ladderDecision('ask-always', declined, { action: 'ask', reason: 'guard says no' }).reason
  expect(reason.includes('Pass a work branch')).toBe(false)
  expect(reason.includes('work branch')).toBe(false)
})

test('SS13: a --dry-run in front of --schedule is still the write, because smoke declares no plan switch', () => {
  // Measured: orthanc refuses the flag for this command ('unexpected argument
  // '--dry-run' found'), so no plan exists to exempt.
  for (const args of [['--dry-run', '--schedule'], ['--schedule', '--dry-run'], ['--dry-run', '--unschedule']]) {
    expect({ args, modes: cli('smoke', args) }).toEqual({ args, modes: ['ask', 'run', 'run', 'run'] })
  }
  expect(bash('orthanc smoke --dry-run --schedule')).toEqual(['block', 'block', 'block', 'block'])
})

test('SS14: the plan exemption is read from the entry, not guessed from the flag', () => {
  // The same guard, an entry that does declare the switch the way clone and
  // sdk install do: then a standing --dry-run is a plan, and the read short-
  // circuit applies. Pinned so a future orthanc that gives smoke a plan switch
  // gets the exemption by declaring it, not by the guard learning to guess.
  const withPlan: ManifestCommand[] = [
    MANIFEST[0]!,
    { ...MANIFEST[1]!, flags: [{ flag: '--schedule', takesValue: false }, { flag: '--unschedule', takesValue: false }, { flag: '--dry-run', takesValue: false }] },
  ]
  const planned = (args: string[]) => {
    const classified = classifyCall(CLI, { command: 'smoke', args }, withPlan, null)
    // null is the read short-circuit: nothing to ask, so nothing to report.
    if (classified === null) return READ
    return MODES.map(mode => ladderDecision(mode, classified, { action: 'approve', reason: 'guard model absent' }).outcome)
  }
  expect(planned(['--dry-run', '--schedule'])).toEqual(READ)
  expect(planned(['--schedule'])).toEqual(['ask', 'run', 'run', 'run'])
})

test('SS11: through the real hooks, ask-always asks once and nothing runs until the operator approves', async ($, on) => {
  const h = harness(on, 'ask-always')
  h.answer = 'throw'
  const denied = await cliCall($, 'smoke', ['--schedule'])
  expect(typeof denied.deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).toContain('launchd')
  expect(ran(h, 'smoke')).toEqual([])
  h.answer = 'Approve'
  expect((await cliCall($, 'smoke', ['--schedule'])).deny).toBe(undefined)
  expect(ran(h, 'smoke --schedule').length).toBe(1)
})

test('SS12: through the real hooks, a plain smoke run in yolo asks no one', async ($, on) => {
  const h = harness(on, 'yolo')
  h.answer = 'throw'
  expect((await cliCall($, 'smoke', [])).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(ran(h, 'smoke').length).toBe(1)
})
