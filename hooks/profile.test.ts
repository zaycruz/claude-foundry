// --profile in orthanc_cli args: a write stays on the stack the operator picked.
//
// The operator picks the stack with /profile, and orthanc_cli passes it as
// `--profile <stack>` before the command. orthanc reads the last --profile it
// is given (checked on 0.7.7: `orthanc --profile <active> admin user current
// --profile other` reads profile `other`). So a `--profile` in the call's own
// args moves the call to another stack. FDE mode refused this; outside FDE,
// yolo and allow-edits ran such a write with no ask (plugin 0.6.0). The
// operator's rule: writes go to the stack the operator picked, and some stacks
// are read-only. `configure use` and `configure set-default` change orthanc's
// default stack, which the next session starts on when nothing else names one.
//
// Ways this can fail, written before the code:
//  P1 In any mode, an orthanc_cli write with `--profile X` or `--profile=X` in
//     its args runs, or asks the operator, instead of being refused before
//     orthanc starts.
//  P2 The same flag inside the `command` string ("dataset create --profile x")
//     gets past the check, because only `args` is read.
//  P3 A write the operator could run before (no --profile, or a value that only
//     contains the word, such as `--name profile`) is now refused.
//  P4 A read with --profile is refused. Reads on another stack are allowed.
//  P5 In any mode the agent changes orthanc's default stack through orthanc_cli
//     (`configure use`, `configure set-default`), instead of being refused
//     before orthanc starts. `configure list` still runs.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const CLI = 'mcp__foundry__orthanc_cli'
const FOLDER = 'ri.compass.main.folder.00000000-0000-4000-8000-000000000000'
const DATASET = 'ri.foundry.main.dataset.00000000-0000-4000-8000-000000000000'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const MANIFEST = envelope({
  commands: [
    { path: 'configure list', kind: 'local', args: [] },
    { path: 'configure use', kind: 'local', args: [] },
    { path: 'configure set-default', kind: 'local', args: [] },
    { path: 'dataset create', kind: 'mutation', args: [] },
    { path: 'dataset schema set', kind: 'mutation', args: [] },
    { path: 'dataset get', kind: 'read-only', args: [] },
  ],
})

type Harness = { calls: string[]; asked: string[] }

function harness(on: On, mode: Mode): Harness {
  const h: Harness = { calls: [], asked: [] }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  on('process.run', (_$, e) => {
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
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
const ran = (h: Harness, command: string) => h.calls.filter(line => line.startsWith(command))

for (const mode of MODES) {
  test(`P1: in ${mode} mode a write with --profile in its args is refused, asks no one and never reaches orthanc`, async ($, on) => {
    const h = harness(on, mode)
    for (const args of [
      ['--parent-folder', FOLDER, '--name', 'd', '--profile', 'other', '--apply'],
      ['--parent-folder', FOLDER, '--name', 'd', '--profile=other', '--apply'],
      ['--profile', 'other', '--parent-folder', FOLDER, '--name', 'd', '--apply'],
    ]) {
      const out = await call($, 'dataset create', args)
      expect(out.deny).toContain('/profile')
    }
    const branched = await call($, 'dataset schema set', [DATASET, '--branch', 'agent-x', '--profile', 'other', '--apply'])
    expect(branched.deny).toContain('/profile')
    expect(h.asked).toEqual([])
    expect(ran(h, 'dataset create')).toEqual([])
    expect(ran(h, 'dataset schema set')).toEqual([])
  })

  test(`P2: in ${mode} mode --profile inside the command string is refused too`, async ($, on) => {
    const h = harness(on, mode)
    const out = await call($, 'dataset create --profile other', ['--parent-folder', FOLDER, '--name', 'd', '--apply'])
    expect(out.deny).toContain('/profile')
    expect(ran(h, 'dataset create')).toEqual([])
  })
}

test('P3: in yolo a write with no --profile, or a value that only contains the word, still runs', async ($, on) => {
  const h = harness(on, 'yolo')
  expect((await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'profile', '--apply'])).deny).toBe(undefined)
  expect((await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'd', '--apply'])).deny).toBe(undefined)
  expect(ran(h, 'dataset create').length).toBe(2)
})

for (const mode of MODES) {
  test(`P5: in ${mode} mode configure use and set-default are refused, asking no one; configure list runs`, async ($, on) => {
    const h = harness(on, mode)
    expect((await call($, 'configure use', ['other'])).deny).toContain('/profile')
    expect((await call($, 'configure set-default', ['other'])).deny).toContain('/profile')
    expect((await call($, 'configure', ['use', 'other'])).deny).toContain('/profile')
    expect(ran(h, 'configure use')).toEqual([])
    expect(ran(h, 'configure set-default')).toEqual([])
    expect(h.asked).toEqual([])
    const before = ran(h, 'configure list').length
    expect((await call($, 'configure list')).deny).toBe(undefined)
    expect(ran(h, 'configure list').length).toBe(before + 1)
  })

  test(`P4: in ${mode} mode a read with --profile runs`, async ($, on) => {
    const h = harness(on, mode)
    expect((await call($, 'dataset get', [DATASET, '--profile', 'other'])).deny).toBe(undefined)
    expect(ran(h, 'dataset get').length).toBe(1)
    expect(h.asked).toEqual([])
  })
}
