// Ontology scenarios (orthanc 0.7.9, SRC-85): the base is main unless the call
// names one global branch with --base-branch.
//
// `ontology scenario create` is the first ontology write whose branch spelling
// is not --branch. Its own help says where it lands: "Make a scenario on main
// (or on --base-branch)". orthanc CONTRACTS.md (SRC-85): "the scenario's base
// (main, or one global branch) does not change", and `--base-branch` "never
// changes" afterwards. So the call is a write whose base is main unless it
// names a global branch RID, and zay's rule stands: no mode runs a write on
// main without the operator.
//
// The rest of the scenario surface stays as it is, and these tests pin that
// too, so a fix here cannot widen the lane by accident: `ontology action-apply`
// still needs --branch (its --scenario-rid edits the scenario, and the guard
// cannot read which base that scenario has), and `ontology scenario rebase`
// edits only the scenario it names.
//
// Ways this can fail, written before the code:
//  SC1 In any mode, `ontology scenario create <ontology> --apply` with no
//      --base-branch reaches orthanc: a scenario based on main, asked of no one.
//  SC2 No one to ask: it still reaches orthanc, or it is refused instead of
//      blocked after the ask.
//  SC3 `--base-branch <global branch RID>` does not read as a work branch: the
//      call asks in yolo or allow-edits, or reaches orthanc with the flag lost.
//  SC4 A base the guard cannot prove is one global branch RID runs in yolo:
//      main, master, HEAD, a plain name, a dataset branch, -b <rid>, --branch
//      <rid>, the flag twice, another case, a quoted value, no value.
//  SC5 A plan (no --apply) asks: nothing is written, and the operator is asked
//      for a call that changes nothing.
//  SC6 The fix widens the lane: `ontology action-apply --scenario-rid <rid>
//      --apply` with no --branch runs, or `ontology scenario rebase` is refused.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const CLI = 'mcp__foundry__orthanc_cli'
const ONTOLOGY = 'tester-ontology'
const RID = 'ri.branch..branch.b0000000-0000-4000-8000-0000000000f4'
const SCENARIO = 'ri.actions..scenario.00000000-0000-4000-8000-0000000000a1'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
// allow-edits runs a mutation that is not on main, yolo runs it too.
const SLOW_MODES = MODES.filter(mode => mode !== 'yolo' && mode !== 'allow-edits')
type Mode = (typeof MODES)[number]

const ENTRIES = [
  { path: 'configure list', kind: 'local' },
  { path: 'ontology scenario create', kind: 'mutation', auth: 'bearer-token' },
  { path: 'ontology scenario rebase', kind: 'mutation', auth: 'bearer-token' },
  { path: 'ontology action-apply', kind: 'mutation', auth: 'bearer-token' },
]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

type Answer = string | 'throw'
type Harness = { calls: string[]; asked: string[]; answer: Answer }

function harness(on: On, mode: Mode = 'yolo', entries: unknown[] = ENTRIES): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve' }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  const manifest = envelope({ commands: entries })
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const stdout =
      line === 'agent-manifest'
        ? manifest
        : line === 'configure list'
          ? envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] })
          : envelope({ ran: line })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
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
const write = ($: Engine, command: string, args: string[] = []) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, path: string) => h.calls.filter(call => call.startsWith(path))

// SC1, SC2: a scenario with no named base is a scenario on main.
for (const mode of MODES) {
  for (const answer of ['Approve', 'Decline', 'throw'] as Answer[]) {
    test(`SC1 SC2: in ${mode} 'ontology scenario create --apply' with no --base-branch asks once; answered ${answer}, it ${answer === 'Approve' ? 'runs' : 'never reaches orthanc'}`, async ($, on) => {
      const h = harness(on, mode)
      h.answer = answer
      const wrote = await write($, 'ontology scenario create', [ONTOLOGY, '--apply'])
      expect({ asked: h.asked.length }).toEqual({ asked: 1 })
      expect(h.asked[0]).toContain('ontology scenario create')
      expect(h.asked[0]).toContain('main')
      if (answer === 'Approve') {
        expect(wrote.deny).toBeUndefined()
        expect(ran(h, 'ontology scenario create')).toEqual([`ontology scenario create ${ONTOLOGY} --apply`])
      } else {
        expect(typeof wrote.deny).toBe('string')
        expect(ran(h, 'ontology scenario create')).toEqual([])
      }
    })
  }
}

// SC3: a global branch RID as the base is a work branch: it runs, with the call unchanged.
for (const mode of ['allow-edits', 'yolo'] as Mode[]) {
  for (const spelling of [
    ['--base-branch', RID],
    [`--base-branch=${RID}`],
  ]) {
    test(`SC3: in ${mode} a scenario on --base-branch <global branch RID> runs with no ask`, async ($, on) => {
      const h = harness(on, mode)
      h.answer = 'throw'
      const args = [ONTOLOGY, ...spelling, '--expire-after', '6h', '--apply']
      const wrote = await write($, 'ontology scenario create', args)
      expect(wrote.deny).toBeUndefined()
      expect(ran(h, 'ontology scenario create')).toEqual([`ontology scenario create ${args.join(' ')}`])
      expect(h.asked).toEqual([])
    })
  }
}

// SC4: a base the guard cannot prove is one global branch RID is not a work branch.
const ODD_BASES: string[][] = [
  ['--base-branch', 'main'],
  ['--base-branch', 'refs/heads/main'],
  ['--base-branch', 'master'],
  ['--base-branch', 'HEAD'],
  ['--base-branch', 'agent-foundry-fix-12'],
  ['--base-branch', RID, '--base-branch', RID],
  ['--BASE-BRANCH', RID],
  ['--base-branch', `'${RID}'`],
  ['--base-branch', '--apply'],
  ['-b', RID],
  ['--branch', RID],
]
for (const odd of ODD_BASES) {
  test(`SC4: in yolo a scenario on '${odd.join(' ')}' asks instead of running`, async ($, on) => {
    const h = harness(on, 'yolo')
    h.answer = 'throw'
    const wrote = await write($, 'ontology scenario create', [ONTOLOGY, ...odd, '--apply'])
    expect(typeof wrote.deny).toBe('string')
    expect(h.asked.length).toBe(1)
    expect(ran(h, 'ontology scenario create')).toEqual([])
  })
}

// SC5: a plan writes nothing and asks no one.
for (const mode of ['allow-edits', 'yolo'] as Mode[]) {
  test(`SC5: in ${mode} a scenario plan (no --apply) runs with no ask, on main or anywhere`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'throw'
    for (const args of [[ONTOLOGY], [ONTOLOGY, '--base-branch', RID], [ONTOLOGY, '--expire-after', '6h']]) {
      const wrote = await write($, 'ontology scenario create', args)
      expect(wrote.deny).toBeUndefined()
      expect(ran(h, 'ontology scenario create').at(-1)).toBe(`ontology scenario create ${args.join(' ')}`)
    }
    expect(h.asked).toEqual([])
  })
}

// SC6: the scenario surface the guard still does not run.
for (const mode of MODES) {
  test(`SC6: in ${mode} 'ontology action-apply --scenario-rid' with no --branch is refused, and the reason still names --branch`, async ($, on) => {
    const h = harness(on, mode)
    const wrote = await write($, 'ontology action-apply', [ONTOLOGY, 'tester-action', '--scenario-rid', SCENARIO, '--apply'])
    expect(typeof wrote.deny).toBe('string')
    expect(wrote.deny).toContain('--branch')
    expect(h.asked).toEqual([])
    expect(ran(h, 'ontology action-apply')).toEqual([])
  })
}

for (const mode of ['allow-edits', 'yolo'] as Mode[]) {
  test(`SC6: in ${mode} 'ontology scenario rebase' runs: it edits the scenario it names, not its base`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'throw'
    const wrote = await write($, 'ontology scenario rebase', [ONTOLOGY, SCENARIO, '--apply'])
    expect(wrote.deny).toBeUndefined()
    expect(ran(h, 'ontology scenario rebase')).toEqual([`ontology scenario rebase ${ONTOLOGY} ${SCENARIO} --apply`])
    expect(h.asked).toEqual([])
  })
}

// The modes other than yolo and allow-edits keep asking for what they asked for
// before, so the fix does not open the plain path in auto.
for (const mode of SLOW_MODES) {
  test(`SC3: in ${mode} a scenario on --base-branch <global branch RID> asks like any other mutation`, async ($, on) => {
    const h = harness(on, mode)
    const args = [ONTOLOGY, '--base-branch', RID, '--apply']
    const wrote = await write($, 'ontology scenario create', args)
    // ask-always asks because of the mode; auto asks because the classifier
    // call is not there in the harness and the ladder fails closed. Both run it
    // once the operator answers, exactly as they did before this rule.
    expect(h.asked.length).toBe(1)
    expect(wrote.deny).toBeUndefined()
    expect(ran(h, 'ontology scenario create')).toEqual([`ontology scenario create ${args.join(' ')}`])
  })
}
