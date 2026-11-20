// The agent cannot replace the tool it is being guarded by.
//
// `orthanc update` is Orthanc's self-update. Read off the released binary
// (0.7.11, orthanc-x86_64-unknown-linux-gnu.tar.gz, sha256
// d746a6bfa6837b93333bafc7439c790386971c6f9068c6d7b4b97ae3c99bbb31):
//
//   {"path":"update","kind":"local"}  — no operator_approval, no scope
//     --apply    "Replace the binary; without it, print the plan"
//     --check    "Print the plan only, with data.update_available"
//     --channel  stable | nightly ("built from main")
//     --version  "Install this stable release …; a lower version than this one needs --yes"
//     --yes      "Confirm a downgrade, or a nightly whose notes name no commit"
//     --plugin   "After the binary, also update the foundry plugin for Claude Code
//                 (foundry@claude-foundry)"
//
// Both files it writes are the ones the guard reads its rules from. The
// `kind` / `operator_approval` marks the ladder judges every call by come from
// that binary (hooks/manifest.ts re-reads the manifest exactly because the
// binary can change under a session), and the ladder itself is this plugin. One
// call moves the session onto a build of orthanc main, an older release, or a
// newer plugin — with no say from the operator, and no Foundry branch involved,
// so yolo's "nothing on the branch asks" carve-out was never about it. Bash
// already refused it (a `local` command that is not a read): the leak is
// orthanc_cli, where allow-edits ran it and yolo ran it with no question.
// The plugin also pins min_orthanc (hooks/orthanc-snapshot.json: 0.7.11), and
// nothing stopped an agent from walking the installed binary under its own
// floor: orthanc 0.7.7 ships 482 commands against 0.7.11's 541, and none of its
// entries carry the `operator_approval_scope` the yolo rule reads.
//
// Ways this can fail, written before the code:
//  U1 orthanc_cli runs an update in some mode: a bare `update`, `--apply`,
//     `--apply --plugin`, `--apply --channel nightly`, or a downgrade with
//     `--version <older> --yes`. It is refused before Orthanc starts, in every
//     mode, with no one asked.
//  U2 The rule keys on a flag, so another spelling of `--apply`, or the words
//     split between `command` and `args`, gets through to the binary.
//  U3 The refusal catches a call that is not an update: a Foundry read, a local
//     read (`version`, `configure list`), or a command that only ends in the
//     word (a dataset named "status-update") is refused with it.
//  U4 Bash runs it. It was refused in 0.6.3; it stays refused, in every mode.
//  U5 The refusal says only "no", so the agent retries the call, asks the
//     operator to approve it, or reaches for the installer itself. It names the
//     command and who runs it.
//  U6 A write the guard knows as a read: the read list names
//     `ai-fde tools list`, which orthanc-source 7f81c11 removed (the AI FDE web
//     client became the only backend). A stale name reads as a current one, and
//     a write that comes back under it is allowed as a read.
//  U7 The read list drifts from the surface again: every local command the
//     guard reads is one the pinned Orthanc ships, and every local read it
//     ships is on the list.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { classifyOrthancCommand, LOCAL_READS, type ManifestCommand, requiresBranch } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const DATASET = 'ri.foundry.main.dataset.00000000-0000-0000-0000-000000000000'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

// The `kind: local` entries of `orthanc agent-manifest` on the released 0.7.11,
// plus two calls that must not be caught by the update rule.
const LOCAL_COMMANDS: { path: string; args: unknown[] }[] = [
  { path: 'version', args: [] },
  { path: 'hello', args: [] },
  { path: 'agent-manifest', args: [] },
  { path: 'capabilities', args: [] },
  { path: 'completion show', args: [{ flag: '--shell', kind: 'option', takes_value: true }] },
  { path: 'configure list', args: [] },
  { path: 'alias list', args: [] },
  { path: 'alias show', args: [{ kind: 'positional', name: 'name' }] },
  { path: 'alias resolve', args: [{ kind: 'positional', name: 'name' }] },
  { path: 'alias export', args: [] },
  { path: 'smoke schedule', args: [] },
  { path: 'update', args: [{ flag: '--apply', kind: 'option', takes_value: false }] },
  { path: 'auth delete', args: [] },
  { path: 'configure use', args: [{ kind: 'positional', name: 'profile' }] },
  { path: 'alias add', args: [{ kind: 'positional', name: 'name' }] },
  { path: 'completion install', args: [{ flag: '--shell', kind: 'option', takes_value: true }] },
]

const MANIFEST = envelope({
  commands: [
    ...LOCAL_COMMANDS.map(entry => ({ ...entry, kind: 'local' })),
    { path: 'ontology list', kind: 'read-only', args: [] },
    { path: 'dataset create', kind: 'mutation', args: [{ flag: '--apply', kind: 'option', takes_value: false }] },
  ],
})

type Harness = { calls: string[]; asked: string[] }

function harness(on: On, mode: Mode): Harness {
  const h: Harness = { calls: [], asked: [] }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  on('process.run', (_$, e) => {
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    const line = words.join(' ')
    h.calls.push(line)
    if (line === 'agent-manifest') return reply(MANIFEST)
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
    return reply(envelope({ ran: line }))
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/tester' : undefined }))
  on('env.set', () => ({ value: {} }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } as never }))
  on('fs.read', (_$, e) => {
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test: no surface' } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_$, e) => {
    const call = e as unknown as { tool: string; questions?: { question: string }[] }
    if (call.tool !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = call.questions?.[0]?.question ?? ''
    h.asked.push(question)
    return { result: { questions: call.questions, answers: { [question]: 'Approve' } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const call = ($: Engine, command: string, args: string[] = []) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const shell = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ deny?: string }>
const ran = (h: Harness, command: string) => h.calls.filter(line => line.startsWith(command))

// Every spelling of the call that would replace the binary.
const UPDATE_CALLS: [string, string[]][] = [
  ['update', []],
  ['update', ['--apply']],
  ['update', ['--apply', '--plugin']],
  ['update', ['--apply', '--channel', 'nightly']],
  ['update', ['--apply', '--version', 'v0.7.1', '--yes']],
  ['update', ['--APPLY']],
  ['update', ['--apply=true']],
  ['update', ['--check']],
  ['update --apply', []],
]

for (const mode of MODES) {
  test(`U1 U2: in ${mode} mode no spelling of orthanc update reaches the binary, and no one is asked`, async ($, on) => {
    const h = harness(on, mode)
    for (const [command, args] of UPDATE_CALLS) {
      const out = await call($, command, args)
      expect(out.deny).toContain('operator')
    }
    expect(h.calls.filter(line => line.split(' ')[0] === 'update')).toEqual([])
    expect(h.asked).toEqual([])
  })
}

for (const mode of MODES) {
  test(`U4: in ${mode} mode orthanc update in Bash is refused`, async ($, on) => {
    harness(on, mode)
    expect((await shell($, 'orthanc update --apply')).deny).toContain('orthanc_cli')
    expect((await shell($, 'orthanc update')).deny).toContain('orthanc_cli')
  })
}

test('U3: the refusal catches only update; reads, other local commands and a name that ends in the word still run', async ($, on) => {
  const h = harness(on, 'yolo')
  for (const read of ['version', 'configure list', 'agent-manifest']) {
    expect((await call($, read)).deny).toBe(undefined)
  }
  expect((await call($, 'ontology list')).deny).toBe(undefined)
  expect((await call($, 'dataset create', ['--parent-folder', 'ri.compass.main.folder.00000000-0000-0000-0000-0000000000aa', '--name', 'status-update', '--apply'])).deny).toBe(undefined)
  expect((await call($, 'auth delete')).deny).toBe(undefined)
  expect(ran(h, 'update').length).toBe(0)
})

test('U5: the refusal names the call and who runs it, so the agent does not retry it or run the installer', async ($, on) => {
  harness(on, 'yolo')
  const out = await call($, 'update', ['--apply', '--plugin'])
  const reason = out.deny ?? ''
  expect(reason).toContain('orthanc update --apply')
  expect(reason).toContain('plugin')
  // The guard's own rule: a blocked call is reported, never worked around.
  expect(reason).toMatch('terminal')
})

// U6 and U7: the guard's local read list against the pinned Orthanc surface.
const SURFACE: ManifestCommand[] = LOCAL_COMMANDS.map(entry => ({ path: entry.path, kind: 'local' }))
const READ_LIST = [...LOCAL_READS]

test('U6 U7: the read list names only local commands Orthanc 0.7.11 ships, and reads every one it does', async () => {
  const localReads = SURFACE.filter(entry => LOCAL_READS.has(entry.path)).map(entry => entry.path)
  expect(localReads.sort()).toEqual(READ_LIST.sort())
  for (const path of READ_LIST) expect(classifyOrthancCommand(path, SURFACE)).toBe('read')
  // The removed command is off the list: a name Orthanc no longer ships is not a read.
  expect(READ_LIST).not.toContain('ai-fde tools list')
  for (const path of ['update', 'auth delete', 'configure use', 'alias add', 'completion install']) {
    expect(classifyOrthancCommand(path, SURFACE)).toBe('mutation')
  }
  // Pinning that the rule is a command list, so a new local write is a mutation:
  // nothing here is also a branch-required write.
  expect(SURFACE.every(entry => !requiresBranch(entry.path))).toBe(true)
})
