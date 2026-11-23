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
//
// Synthetic stack only: placeholder RIDs, no stack data, nothing on disk.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { renderCommand } from './orthanc'
import { SNAPSHOT } from './orthanc-manifest.snapshot'
import { classifyCall, ladderDecision, type ManifestCommand } from './policy'

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

test('LW8: the pinned manifest still calls both commands read-only, so orthanc can still mislabel them', () => {
  type Entry = { path: string; kind: string }
  const commands = (SNAPSHOT as unknown as { commands: Entry[] }).commands
  for (const path of ['repository clone', 'dev-console sdk install']) {
    const entry = commands.find(candidate => candidate.path === path)
    expect({ path, entry: entry === undefined ? 'missing' : entry.kind }).toEqual({ path, entry: 'read-only' })
  }
})

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

test('LW9: in ask-always a --force clone waits for the operator, and nothing else asks', async ($, on) => {
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

test('LW9: a plain clone in yolo still runs with no ask', async ($, on) => {
  const h = harness(on, 'yolo')
  h.answer = 'throw'
  expect((await cliCall($, 'repository clone', [REPO, './repo'])).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(ran(h, 'repository clone').length).toBe(1)
})
