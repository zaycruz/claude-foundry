// Approval classes: outbound, credential and access writes ask in every mode.
//
// Gap, from plugin 0.6.0: in yolo only a write on main asks. `connectivity source
// secret set`, `connectivity webhook create|update`, `connectivity egress ensure`,
// `connectivity rest-source create`, `dev-console scope add` and the `admin`
// writes take no branch and sit in no list, so they ran in yolo with no ask. They
// change the live enrollment: writes on main in all but name.
//
// Ways this can fail, written before the code:
//  C1  In yolo an applied outbound, credential or access write runs with no ask,
//      or runs when declined or when no one can be asked.
//  C2  The class comes from command names alone, so a command the manifest marks
//      `operator_approval` but the plugin has never heard of runs in yolo. The
//      manifest's mark must be enough (it is main's mechanism, PR #7).
//  C3  The manifest mark is dropped on the way in (manifestFrom), so C2 holds
//      only in a unit test and not in a real session.
//  C4  A plan (no --apply) asks. It changes nothing: it must run, in every mode.
//  C5  A read of the same group (webhook list, source list) asks.
//  C6  A subagent's call does not inherit the class: it runs with no ask.
//  C7  Another mode loosens: ask-always, allow-edits and auto stop asking.
//  C8  A spelling of --apply is missed (--APPLY, --apply=true, the flag inside the
//      command string), so the write runs unasked.
//  C9  A command marked by the manifest and also in the floor asks twice.
//  C10 The prompt in yolo does not say these writes ask.
//  C11 A write that is also a write on main asks twice, or an error (no branch)
//      stops being an error because it is also a class.
//
// The last test prints the hook transcript as one APPROVAL_TRANSCRIPT line; scripts/approval-transcript.sh saves it,
// the same each run.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { approvalClass, classifyCall, ladderDecision } from './policy'
import { manifestFrom } from './orthanc'

const CLI = 'mcp__foundry__orthanc_cli'
const SOURCE = 'ri.magritte..source.c0000000-0000-4000-8000-0000000000c2'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
// As the 0.7.7 manifest has them: no operator_approval. Two commands the plugin has no name
// for carry the manifest's mark: `connectivity vault rotate` always, `connectivity beacon send` with --apply.
const COMMANDS: { path: string; kind: string; extra?: Record<string, unknown> }[] = [
  { path: 'connectivity source secret set', kind: 'mutation' },
  { path: 'connectivity source list', kind: 'read-only' },
  { path: 'connectivity webhook create', kind: 'mutation' },
  { path: 'connectivity webhook update', kind: 'mutation' },
  { path: 'connectivity webhook list', kind: 'read-only' },
  { path: 'connectivity egress ensure', kind: 'mutation' },
  { path: 'connectivity rest-source create', kind: 'mutation' },
  { path: 'dev-console scope add', kind: 'mutation' },
  { path: 'admin group create', kind: 'mutation' },
  { path: 'admin group list', kind: 'read-only' },
  { path: 'resource-role grant', kind: 'mutation' },
  { path: 'dataset create', kind: 'mutation' },
  { path: 'workshop module publish', kind: 'mutation' },
  { path: 'connectivity vault rotate', kind: 'mutation', extra: { operator_approval: 'always' } },
  { path: 'connectivity beacon send', kind: 'mutation', extra: { operator_approval: { when_all_flags: ['--apply'] } } },
  { path: 'repository checks required remove', kind: 'mutation', extra: { operator_approval: { when_all_flags: ['--apply', '--allow-weaken'] } } },
]
const MANIFEST = envelope({ commands: COMMANDS.map(({ path, kind, extra }) => ({ path, kind, args: [], ...extra })) })

type Answer = string | 'throw'
type Harness = { calls: string[]; asked: string[]; answer: Answer; store: Map<string, unknown>; transcript: unknown[] }

function harness(on: On, mode: Mode = 'yolo'): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve', store: new Map<string, unknown>([['approvalMode', mode]]), transcript: [] }
  on('process.run', (_$, e) => {
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (e.argv[0] === 'git') return reply('')
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    if (line === 'agent-manifest') return reply(MANIFEST)
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
    return reply(envelope({ ran: line }))
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
    if (h.answer === 'throw') throw new Error('test: no one to ask')
    return { result: { questions: call.questions, answers: { [question]: h.answer } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const say = async ($: Engine, command: string, args = '') =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)).text ?? ''
const write = ($: Engine, command: string, args: string[] = []) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, command: string) => h.calls.filter(call => call.startsWith(command))
const prompt = async ($: Engine) =>
  ((await $.classic.SubagentStart({ agent_id: 'a', agent_type: 'foundry:foundry-scout' } as never)).additionalContext ?? []).join('\n')

// One applied write of each class, as the 0.7.7 manifest names them, and the
// manifest-marked ones the plugin has no name for.
const APPLIED: [string, string[], string][] = [
  ['connectivity source secret set', [SOURCE, '--name', 'api-key', '--apply'], 'credential'],
  ['connectivity webhook create', [SOURCE, '--name', 'notify', '--apply'], 'outbound'],
  ['connectivity webhook update', [SOURCE, '--name', 'notify', '--apply'], 'outbound'],
  ['connectivity egress ensure', [SOURCE, '--apply'], 'access'],
  ['connectivity rest-source create', ['--name', 'orders-api', '--apply'], 'access'],
  ['dev-console scope add', ['app-1', '--scope', 'api:read', '--apply'], 'access'],
  ['admin group create', ['analysts', '--apply'], 'access'],
  ['resource-role grant', ['ri.compass.main.folder.c0000000-0000-4000-8000-0000000000c1', '--apply'], 'access'],
  ]
// Asks of the manifest's own mark, not the class table.
const MARKED: [string, string[]][] = [
  ['connectivity vault rotate', [SOURCE, '--apply']],
  ['connectivity beacon send', [SOURCE, '--apply']],
]
const PLANS: [string, string[]][] = APPLIED.map(([command, args]) => [command, args.filter(arg => arg !== '--apply')])
const READS: [string, string[]][] = [
  ['connectivity webhook list', [SOURCE]],
  ['connectivity source list', []],
  ['admin group list', []],
]

test('C1: in yolo an applied outbound, credential or access write asks; declined or with no one to ask it does not run', async ($, on) => {
  const h = harness(on)
  for (const answer of ['Decline', 'throw'] as Answer[]) {
    h.answer = answer
    for (const [command, args] of APPLIED) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ answer, command, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ answer, command, denied: true, asked: 1 })
    }
  }
  expect(h.calls.filter(call => !['agent-manifest', 'version', 'configure list'].includes(call))).toEqual([])
})

test('C1: in yolo, approved, each runs once after one question that names its class', async ($, on) => {
  const h = harness(on)
  for (const [command, args, scope] of APPLIED) {
    const before = h.asked.length
    const wrote = await write($, command, args)
    expect({ command, deny: wrote.deny, asked: h.asked.length - before }).toEqual({ command, deny: undefined, asked: 1 })
    expect(h.asked.at(-1)).toContain(`${scope} write`)
    expect(ran(h, command)).toEqual([`${command} ${args.join(' ')}`])
  }
})

for (const mode of MODES) {
  test(`C4 C5: in ${mode} a plan and a read of the same groups ask no one and run`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Decline'
    for (const [command, args] of [...PLANS, ...READS]) {
      const wrote = await write($, command, args)
      // A plan may still be asked by the mode itself (ask-always asks for every mutation, auto judges it); the class adds nothing.
      if ((mode === 'ask-always' || mode === 'auto') && PLANS.some(([name]) => name === command)) continue
      expect({ mode, command, deny: wrote.deny }).toEqual({ mode, command, deny: undefined })
    }
    if (mode === 'yolo' || mode === 'allow-edits') expect(h.asked).toEqual([])
  })
}

for (const mode of ['ask-always', 'allow-edits', 'auto'] as const) {
  test(`C7: in ${mode} an applied class write still asks, and does not run when declined`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Decline'
    for (const [command, args] of APPLIED) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ mode, command, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ mode, command, denied: true, asked: 1 })
    }
    expect(h.calls.filter(call => !['agent-manifest', 'version', 'configure list'].includes(call))).toEqual([])
  })
}

test('C2 C3: a command only the manifest marks asks in yolo; declined it does not run', async ($, on) => {
  const h = harness(on)
  h.answer = 'Decline'
  for (const [command, args] of MARKED) {
    const before = h.asked.length
    const wrote = await write($, command, args)
    expect({ command, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ command, denied: true, asked: 1 })
    expect(ran(h, command)).toEqual([])
  }
  // beacon send is marked only when --apply is given: its plan runs.
  expect((await write($, 'connectivity beacon send', [SOURCE])).deny).toBe(undefined)
})

test('C3: manifestFrom keeps the manifest mark', () => {
  const by = (path: string) => manifestFrom(JSON.parse(MANIFEST)).find(command => command.path === path)
  expect(by('connectivity vault rotate')?.operatorApproval).toBe('always')
  expect(by('connectivity beacon send')?.operatorApproval).toEqual({ when_all_flags: ['--apply'] })
  expect(by('connectivity source secret set')?.operatorApproval).toBe(undefined)
})

test('C2: the floor names only the writes in its table', () => {
  expect(approvalClass('connectivity webhook create')).toBe('outbound')
  expect(approvalClass('connectivity source secret set')).toBe('credential')
  expect(approvalClass('project add-orgs')).toBe('access')
  expect(approvalClass('dataset create')).toBe(null)
  expect(approvalClass('admin org create')).toBe('access')
  expect(approvalClass('global-branch roles set')).toBe(null)
})

test('C8: every spelling of --apply asks, in the args or inside the command string', async ($, on) => {
  const h = harness(on)
  h.answer = 'Decline'
  for (const [command, args] of [
    ['connectivity source secret set', [SOURCE, '--APPLY']],
    ['connectivity source secret set', [SOURCE, '--apply=true']],
    ['connectivity source secret set', [SOURCE, '"--apply"']],
    [`connectivity source secret set ${SOURCE} --apply`, []],
    ['CONNECTIVITY WEBHOOK CREATE', [SOURCE, '--apply']],
  ] as [string, string[]][]) {
    const before = h.asked.length
    const wrote = await write($, command, args)
    expect({ command, args, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ command, args, denied: true, asked: 1 })
  }
})

test('C6: a subagent started in yolo is asked the same way', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  await $.classic.SubagentStart({ agent_id: 'sub-1', agent_type: 'foundry:foundry-builder' } as never)
  const wrote = (await $.tool.call({ tool: CLI, command: 'connectivity webhook create', args: [SOURCE, '--apply'], agent_id: 'sub-1' } as never)) as { deny?: string }
  expect(typeof wrote.deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'connectivity webhook create')).toEqual([])
})

test('C10: the yolo prompt says these writes ask; so do the other prompts', async ($, on) => {
  harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  const text = await prompt($)
  expect(text).toContain('Nothing asks the operator except a write on main and an outbound, credential or access write')
  expect(text).toContain('A plan asks no one')
})

test('C11: an applied class write with a branch problem is still an error, and one on main asks once', () => {
  const manifest = manifestFrom(JSON.parse(MANIFEST))
  // A class write is no excuse for a missing branch where the branch rule needs one.
  const classified = classifyCall(CLI, { command: 'resource-role grant', args: ['r'] }, [{ path: 'resource-role grant', kind: 'mutation' }], null)
  expect(classified?.approval).toBe(undefined)
  const grant = classifyCall(CLI, { command: 'resource-role grant', args: ['r', '--apply'] }, [{ path: 'resource-role grant', kind: 'mutation' }], null)
  expect(grant?.approval).toBe('access')
  const onMain = classifyCall(CLI, { command: 'workshop module publish', args: ['m', '--apply'] }, manifest, null)
  expect(onMain?.targetsProtected).toBe(true)
  const decision = ladderDecision('yolo', { ...onMain!, approval: 'access' })
  expect(decision.outcome).toBe('ask')
  const error = ladderDecision('yolo', { ...grant!, error: 'no branch' })
  expect(error).toEqual({ outcome: 'block', reason: 'no branch' })
})

test('record: the hook transcript, in yolo, for the done condition', async ($, on) => {
  const h = harness(on)
  const rows: unknown[] = []
  const step = async (command: string, args: string[], answer: Answer) => {
    h.answer = answer
    const before = h.asked.length
    const calls = h.calls.length
    const wrote = await write($, command, args)
    rows.push({
      mode: 'yolo',
      command: [command, ...args].join(' '),
      operatorAnswer: answer === 'throw' ? 'no one to ask' : answer,
      asked: h.asked.slice(before),
      outcome: typeof wrote.deny === 'string' ? 'stopped' : 'ran',
      deny: wrote.deny ?? null,
      orthancRan: h.calls.slice(calls),
    })
    return wrote
  }
  expect(typeof (await step('connectivity source secret set', [SOURCE, '--name', 'api-key', '--apply'], 'Decline')).deny).toBe('string')
  expect(typeof (await step('connectivity webhook create', [SOURCE, '--name', 'notify', '--apply'], 'Decline')).deny).toBe('string')
  expect(typeof (await step('connectivity webhook create', [SOURCE, '--name', 'notify', '--apply'], 'throw')).deny).toBe('string')
  expect((await step('connectivity webhook list', [SOURCE], 'Decline')).deny).toBe(undefined)
  expect((await step('connectivity webhook create', [SOURCE, '--name', 'notify'], 'Decline')).deny).toBe(undefined)
  expect((await step('connectivity webhook create', [SOURCE, '--name', 'notify', '--apply'], 'Approve')).deny).toBe(undefined)
  console.log(`APPROVAL_TRANSCRIPT ${JSON.stringify({ test: 'approval-class', stack: 'synthetic', rows })}`)
  expect(rows.length).toBe(6)
})
