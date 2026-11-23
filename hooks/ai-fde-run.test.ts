// FND-24: the guard's rule for `orthanc ai-fde run`, written before the fix.
//
// zay's rule (2026-11-20): in yolo the agent does anything on a branch, and
// nothing directly against main or master; outside yolo the ladder asks. Measured
// on the plugin before this change: `ai-fde run --apply` spawned with no ask in
// allow-edits and yolo, and asked once in ask-always and auto, because it is an
// ordinary branchless mutation to the ladder. A run hands Foundry's AI FDE worker
// its own tools for the whole run (and with --approve-all or its alias --yes, it
// clicks Allow on every tool that asks), so one call is many writes the guard
// never sees. Failure modes:
//  A1 yolo runs it with no ask, with or without --approve-all, --yes or --detach.
//  A2 ask-always, allow-edits and auto ask the operator once, naming the call; a
//     decline or no one to ask stops it, and an approval runs it.
//  A3 auto: the Haiku guard approving the call does not stand in for the
//     operator.
//  A4 a plan (no --apply) starts no worker, so this rule leaves it to the
//     ordinary ladder.
//  A5 the other ai-fde writes keep the ordinary ladder: allow-edits runs
//     `ai-fde threads send` at once.
//  A6 the direct-main rule does not move: a write naming main or master asks in
//     yolo too, and with no one to ask it does not run.
//  A7 Bash still runs no ai-fde run, in any mode.
//  A8 so does an ai-fde run the manifest does not list, however the path is split.
// Synthetic stack and RIDs only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { classifyCall, ladderDecision, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]
const approve = { action: 'approve', reason: 'routine branch work' } as const
const DATASET = 'ri.foundry.main.dataset.00000000-0000-0000-0000-000000000000'

const MANIFEST: ManifestCommand[] = [
  {
    path: 'ai-fde run',
    kind: 'mutation',
    flags: [
      { flag: '--thread', takesValue: true },
      { flag: '--approve-all', takesValue: false },
      { flag: '--detach', takesValue: false },
      { flag: '--timeout', takesValue: true },
      { flag: '--apply', takesValue: false },
    ],
  },
  { path: 'ai-fde threads send', kind: 'mutation' },
  { path: 'ai-fde status', kind: 'read-only' },
  { path: 'dataset files upload', kind: 'mutation', flags: [{ flag: '--branch', takesValue: true }] },
]

const decide = (mode: Mode, command: string, args: string[]) => {
  const classification = classifyCall(CLI, { command, args }, MANIFEST, 'agent/x')
  return classification === null ? 'read' : ladderDecision(mode, classification, approve).outcome
}

const RUNS: string[][] = [
  ['build the pipeline', '--apply'],
  ['build the pipeline', '--apply', '--approve-all'],
  ['build the pipeline', '--apply', '--yes'],
  ['build the pipeline', '--apply', '--detach'],
  ['build the pipeline', '--APPLY'],
]

test('A1 A2 A3: ai-fde run asks in every mode but yolo, where it runs', () => {
  for (const args of RUNS) {
    expect({ args, outcomes: MODES.map(mode => decide(mode, 'ai-fde run', args)) }).toEqual({
      args,
      outcomes: ['ask', 'ask', 'ask', 'run'],
    })
  }
  const asked = ladderDecision('allow-edits', classifyCall(CLI, { command: 'ai-fde run', args: RUNS[1]! }, MANIFEST, 'agent/x')!, approve)
  expect(asked.reason).toContain("'ai-fde run'")
  expect(asked.reason).toContain('every mode but yolo')
})

// Review of #38: orthanc 0.7.11 lists no ai-fde command unless ORTHANC_ENABLE_AI_FDE
// is set, so on that manifest `ai-fde run` resolves no entry, and a caller that
// splits the path (`command: 'ai-fde', args: ['run', …]`) must still be asked.
test('A8: an ai-fde run the manifest does not list still asks outside yolo, however the path is split', () => {
  const unlisted = MANIFEST.filter(entry => !entry.path.startsWith('ai-fde'))
  for (const [command, args] of [
    ['ai-fde', ['run', 'build the pipeline', '--apply']],
    ['ai-fde', ['RUN', 'build the pipeline', '--apply']],
    ['ai-fde run', ['build the pipeline', '--apply']],
  ] as [string, string[]][]) {
    const outcomes = MODES.map(mode => {
      const classification = classifyCall(CLI, { command, args }, unlisted, 'agent/x')
      return classification === null ? 'read' : ladderDecision(mode, classification, approve).outcome
    })
    expect({ command, args, outcomes }).toEqual({ command, args, outcomes: ['ask', 'ask', 'ask', 'run'] })
  }
})

test('A4: a plan keeps the ordinary ladder: this rule adds no ask to it', () => {
  expect(MODES.map(mode => decide(mode, 'ai-fde run', ['build the pipeline']))).toEqual(['ask', 'run', 'run', 'run'])
})

test('A5: other ai-fde writes keep the ordinary ladder', () => {
  expect(MODES.map(mode => decide(mode, 'ai-fde threads send', ['thread-1', 'hello']))).toEqual(['ask', 'run', 'run', 'run'])
  expect(MODES.map(mode => decide(mode, 'ai-fde status', ['run-1']))).toEqual(['read', 'read', 'read', 'read'])
})

test('A6: a write naming main or master asks in yolo too', () => {
  for (const branch of ['main', 'master', 'MASTER'])
    expect({ branch, yolo: decide('yolo', 'dataset files upload', [DATASET, '--branch', branch, '--file', 'a.csv']) }).toEqual({ branch, yolo: 'ask' })
})

// ---------------------------------------------------------------------------
// Through the real hook, on a synthetic stack.
// ---------------------------------------------------------------------------
const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const HOOK_MANIFEST = envelope({
  commands: [
    { path: 'configure list', kind: 'local' },
    {
      path: 'ai-fde run',
      kind: 'mutation',
      args: [
        { flag: '--approve-all', kind: 'switch', takes_value: false },
        { flag: '--detach', kind: 'switch', takes_value: false },
        { flag: '--apply', kind: 'switch', takes_value: false },
      ],
    },
    { path: 'dataset files upload', kind: 'mutation', args: [{ flag: '--branch', kind: 'option', takes_value: true }] },
  ],
})

function rig(on: On, mode: Mode) {
  const h = { ran: [] as string[], asked: [] as string[], answer: 'Approve' as string | 'throw' }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  on('process.run', (_$, e) => {
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const line = e.argv
      .slice(1)
      .filter(word => word !== '--agent' && word !== '--non-interactive')
      .join(' ')
    if (!['agent-manifest', 'configure list', 'version'].includes(line) && e.argv[0] !== 'git') h.ran.push(line)
    if (line === 'agent-manifest') return reply(HOOK_MANIFEST)
    if (line === 'version') return reply('orthanc 0.7.11\n')
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
    return reply(envelope({ ran: line }))
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
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
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"action":"approve","reason":"routine branch work"}' } }) as never)
  on('classic.SubagentStart', () => ({}))
  on('tool.call', (_$, e) => {
    const call = e as unknown as { tool: string; questions?: { question: string }[] }
    if (call.tool !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = call.questions?.[0]?.question ?? ''
    h.asked.push(question)
    if (h.answer === 'throw') throw new Error('test: no one to ask')
    return { result: { questions: call.questions, answers: { [question]: h.answer } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const call = ($: Engine, command: string, args: string[]) => $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string }>
const bash = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ deny?: string }>
const RUN = ['build the pipeline', '--apply', '--approve-all', '--detach']
const ranRun = (h: { ran: string[] }) => h.ran.filter(line => line.startsWith('ai-fde run'))

for (const mode of ['ask-always', 'allow-edits', 'auto'] as Mode[]) {
  test(`A2 A3: in ${mode}, ai-fde run asks once; declined or no one to ask, it does not run; approved, it runs`, async ($, on) => {
    const h = rig(on, mode)
    for (const answer of ['Decline', 'throw'] as (string | 'throw')[]) {
      h.answer = answer
      const before = h.asked.length
      const ran = await call($, 'ai-fde run', RUN)
      expect({ answer, denied: typeof ran.deny === 'string', asked: h.asked.length - before }).toEqual({ answer, denied: true, asked: 1 })
    }
    expect(h.asked[0]).toContain("'ai-fde run'")
    expect(ranRun(h)).toEqual([])
    h.answer = 'Approve'
    expect((await call($, 'ai-fde run', RUN)).deny).toBe(undefined)
    expect(ranRun(h)).toEqual([`ai-fde run ${RUN.join(' ')}`])
  })
}

test('A1: in yolo, ai-fde run runs with no dialog', async ($, on) => {
  const h = rig(on, 'yolo')
  h.answer = 'throw'
  expect((await call($, 'ai-fde run', RUN)).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(ranRun(h)).toEqual([`ai-fde run ${RUN.join(' ')}`])
})

test('A6: in yolo, a write naming master asks, and with no one to ask it does not run', async ($, on) => {
  const h = rig(on, 'yolo')
  h.answer = 'throw'
  const wrote = await call($, 'dataset files upload', [DATASET, '--branch', 'master', '--file', 'a.csv'])
  expect(typeof wrote.deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(h.ran.filter(line => line.startsWith('dataset files upload'))).toEqual([])
})

for (const mode of MODES) {
  test(`A7: in ${mode}, Bash runs no ai-fde run`, async ($, on) => {
    const h = rig(on, mode)
    const ran = await bash($, `orthanc ai-fde run 'build the pipeline' --apply`)
    expect(typeof ran.deny).toBe('string')
    expect(ranRun(h)).toEqual([])
  })
}
