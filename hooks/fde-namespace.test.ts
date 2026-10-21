// FDE mode, held to one Compass namespace (orthanc calls it a space).
//
// zay, 2026-10-21, chose "Refuse it": /fde on binds the namespace in scope, as it
// binds the branch and the ontology; a write whose target resolves outside it is
// refused; /namespace is locked until /fde end; one Compass lookup per new RID,
// cached; when the lookup itself fails, the write asks instead of failing closed.
//
// Ways this can fail, written before the code:
//  N1  /fde on with a namespace binds without checking that the ontology is in it,
//      or creates the branch before the check, so a refused start leaves a branch behind.
//  N2  /fde on binds although the ontology is in no namespace (batch-get leaves it
//      out), or a failed space list or lookup binds anyway. Nothing exists yet at
//      /fde on, so there a failure refuses; only writes ask.
//  N3  /fde --branch adopts a branch whose ontology is in another namespace.
//  N4  With no namespace in scope, FDE mode makes extra calls (space list,
//      batch-get) or refuses something it did not refuse before.
//  N5  A write naming a resource in another namespace (a dataset, a project
//      folder, an object type) runs.
//  N6  A write naming another namespace's own RID runs: batch-get never returns
//      a space, so a space RID resolves to nothing.
//  N7  A write naming a resource in a namespace made after binding (missing from
//      the stored list) runs because its space has no name.
//  N8  A RID in a file the call reads (--file, @file, a positional path) escapes.
//  N9  A Compass path under another namespace runs: in the args (bare, quoted,
//      --flag=value) or as a quoted string in a file the call reads.
//  N10 Paths are placed by string prefix, not whole segments: /Acme claims
//      /Acme Dev/…, or the other way round.
//  N11 RIDs batch-get leaves out (not Compass, unknown, malformed) refuse the write.
//  N12 A failed lookup fails closed without asking, runs without asking, or is
//      cached as "in no namespace".
//  N13 The operator's "Run unchecked" is remembered for later calls.
//  N14 No one to ask (a -p run) when the lookup fails, and the write runs.
//  N15 A RID found in another namespace is waved through by an ask about a
//      different chunk that failed.
//  N16 More than 1000 RIDs go into one batch-get (orthanc's cap), or a dry run
//      and then its apply look the same RID up twice.
//  N17 Reads are checked or refused.
//  N18 FDE off (namespace in scope or not) looks anything up or refuses anything.
//  N19 While bound, /namespace (a pick, clear, the picker), /scope clear or the
//      /foundry pane's clear button changes the namespace, and the prompt and the
//      gate disagree.
//  N20 /fde end leaves /namespace locked, or the handoff omits the namespace.
//  N21 /fde resume of a session stored before namespaces fails or invents one;
//      a resumed namespace is not the scope's again, or loses its space list.
//  N22 The status, prompt block or band omits the bound namespace, or a session
//      without one talks about namespaces.
//  N23 The FDE band hides other plugins' AbovePrompt lines: it never calls next
//      (bead hooks-0gy).
//  N24 The lookup cache outlives its binding.
//  N25 The refusal does not say that every resource a write names counts, its
//      inputs too, so an input dataset in another namespace looks like a bug.
//      (Deliberate: foreignRids already judges every branch and ontology RID.)
//
// Synthetic stack only: Acme and Acme Dev, where one path is a string prefix of
// the other, so a prefix check that ignores segments fails N10.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { FdeSession, FoundryNamespace } from '../types'
import { batchGetArgs, fdeContext, fdeHandoff, fdeStatus, namespaceDeny, namespaceScan, normalizeFde, spacesOf } from './fde'

const CLI = 'mcp__foundry__orthanc_cli'
const ACME: FoundryNamespace = { rid: 'ri.compass.main.folder.a0000000-0000-4000-8000-00000000000a', name: 'Acme', path: '/Acme' }
const DEV: FoundryNamespace = { rid: 'ri.compass.main.folder.a0000000-0000-4000-8000-00000000000d', name: 'Acme Dev', path: '/Acme Dev' }
const DEV_ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-00000000000d', name: 'Acme Dev Ontology' }
const ACME_ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-00000000000a', name: 'Acme Ontology' }
const LOOSE_ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-000000000000', name: 'Loose Ontology' }
const DEV_DATASET = 'ri.foundry.main.dataset.c0000000-0000-4000-8000-00000000000d'
const DEV_PROJECT = 'ri.compass.main.folder.f0000000-0000-4000-8000-00000000000d'
const ACME_DATASET = 'ri.foundry.main.dataset.c0000000-0000-4000-8000-00000000000a'
const ACME_PROJECT = 'ri.compass.main.folder.f0000000-0000-4000-8000-00000000000a'
const ACME_TYPE = 'ri.ontology.main.object-type.70000000-0000-4000-8000-00000000000a'
// A namespace made after binding, so the stored list does not name it.
const LATER_SPACE = 'ri.compass.main.folder.a0000000-0000-4000-8000-0000000000ff'
const LATER_DATASET = 'ri.foundry.main.dataset.c0000000-0000-4000-8000-0000000000ff'
// batch-get leaves it out: not a Compass resource.
const LOOSE = 'ri.foundry.main.transaction.e0000000-0000-4000-8000-000000000000'
const BRANCH = 'ri.branch..branch.b0000000-0000-4000-8000-000000000001'
const SPACE_OF: Record<string, string> = {
  [DEV_ONT.rid]: DEV.rid,
  [ACME_ONT.rid]: ACME.rid,
  [DEV_DATASET]: DEV.rid,
  [DEV_PROJECT]: DEV.rid,
  [ACME_DATASET]: ACME.rid,
  [ACME_PROJECT]: ACME.rid,
  [ACME_TYPE]: ACME.rid,
  [LATER_DATASET]: LATER_SPACE,
}
const TAG = /^FDE mode \(agent\/fde-[^)]+\): /
const refused = (target: string, space: string, ns = 'Acme Dev') => `${target} is in ${space}, not ${ns}; the session works in ${ns} only`
const EVERY = 'every resource a write names'
const looseRids = (count: number) =>
  Array.from({ length: count }, (_, index) => `ri.foundry.main.transaction.e0000000-0000-4000-8000-${String(index).padStart(12, '0')}`)

// ---------- pure ----------

const session = (over: Partial<FdeSession> = {}): FdeSession => ({
  goal: '',
  profile: 'acme',
  ontologyRid: DEV_ONT.rid,
  branchRid: BRANCH,
  branchName: 'agent/fde-202610210900',
  startedAt: '2026-10-21T09:00:00.000Z',
  plans: [],
  applied: [],
  namespace: DEV,
  spaces: [ACME, DEV],
  ...over,
})
const lookup = (scanned: ReturnType<typeof namespaceScan>) => ('lookup' in scanned ? scanned.lookup : [`deny: ${scanned.deny}`])
const denied = (scanned: ReturnType<typeof namespaceScan>) => ('deny' in scanned ? scanned.deny : '')

test('N4: with no namespace bound, the scan refuses nothing and looks nothing up', async () => {
  const fde = session({ namespace: null, spaces: [] })
  expect(namespaceScan(fde, ['x', ACME_DATASET, '/Acme/Project/x', '--space-rid', ACME.rid], [`{"parent": "/Acme/P", "rid": "${ACME_PROJECT}"}`])).toEqual({ lookup: [] })
})

test('N6 N11: the scan looks up each other RID once, in order, past the bound branch, ontology and namespace', async () => {
  const scanned = namespaceScan(
    session(),
    ['people', '--parent-folder-rid', ACME_PROJECT, `--input=${DEV_DATASET}`, BRANCH, DEV_ONT.rid, DEV.rid, `'${ACME_PROJECT}'`],
    [`{"input": "${LOOSE}", "again": "${DEV_DATASET}", "type": "${ACME_TYPE}"}`],
  )
  expect(lookup(scanned)).toEqual([ACME_PROJECT, DEV_DATASET, LOOSE, ACME_TYPE])
})

test('N6: another namespace\'s own RID is refused without a lookup, in args or files', async () => {
  for (const [args, texts] of [
    [['--space-rid', ACME.rid], []],
    [[`--space-rid=${ACME.rid}`], []],
    [['people'], [`{"space": "${ACME.rid}"}`]],
  ] as const) {
    const reason = denied(namespaceScan(session(), args, texts))
    expect({ args, reason: reason.includes(refused(ACME.rid, 'Acme')) && TAG.test(reason) }).toEqual({ args, reason: true })
  }
})

test('N9 N10: Compass paths in the args are placed by whole segments, both ways round', async () => {
  const cases: [FoundryNamespace, string, boolean][] = [
    [DEV, '/Acme/Project/people', true],
    [DEV, '/Acme', true],
    [DEV, '--target=/Acme/Project/people', true],
    [DEV, "'/Acme/Project/people'", true],
    [DEV, '/Acme Dev/Project/people', false],
    [DEV, '/Acme Dev', false],
    [DEV, '/Acme Devices/x', false],
    [DEV, '/Acmex/x', false],
    [DEV, '/Users/tester/request.json', false],
    [ACME, '/Acme Dev/Project/people', true],
    [ACME, '/Acme Dev', true],
    [ACME, '/Acme/Project/people', false],
  ]
  for (const [ns, arg, isRefused] of cases) {
    const reason = denied(namespaceScan(session({ namespace: ns }), ['people', arg], []))
    expect({ ns: ns.name, arg, refused: reason !== '' }).toEqual({ ns: ns.name, arg, refused: isRefused })
    if (isRefused) expect(reason).toContain(`is in ${ns === DEV ? 'Acme' : 'Acme Dev'}, not ${ns.name}; the session works in ${ns.name} only`)
  }
})

test('N9: a quoted path in a file counts; prose and in-namespace paths do not', async () => {
  const scan = (text: string) => denied(namespaceScan(session(), ['people'], [text]))
  expect(scan('{"parent": "/Acme/Project"}')).toContain(refused('/Acme/Project', 'Acme'))
  expect(scan("parent: '/Acme/Project/x'")).toContain(refused('/Acme/Project/x', 'Acme'))
  expect(scan('{"parent": "/Acme Dev/Project"}')).toBe('')
  expect(scan('notes: see /Acme/Project in the docs')).toBe('')
})

test('N16: batch-get argv carries at most 1000 RIDs a call', async () => {
  const chunks = batchGetArgs(looseRids(2500))
  expect(chunks.map(argv => argv.length)).toEqual([1002, 1002, 502])
  expect(chunks.every(argv => argv[0] === 'resource' && argv[1] === 'batch-get')).toBe(true)
  expect(chunks.flatMap(argv => argv.slice(2))).toEqual(looseRids(2500))
  expect(batchGetArgs([])).toEqual([])
})

test('N5 N7 N11 N25: a RID resolved to another namespace is refused, by name when listed', async () => {
  const asked = [LOOSE, DEV_DATASET, ACME_DATASET, LATER_DATASET]
  const spaces = spacesOf(
    { resources: [LATER_DATASET, DEV_DATASET, ACME_DATASET].map(rid => ({ rid, spaceRid: SPACE_OF[rid], path: '/x', type: 'FOUNDRY_DATASET' })) },
    asked,
  )
  expect([...spaces.entries()]).toEqual([[LOOSE, null], [DEV_DATASET, DEV.rid], [ACME_DATASET, ACME.rid], [LATER_DATASET, LATER_SPACE]])
  const reason = namespaceDeny(session(), spaces) ?? ''
  expect(reason).toMatch(TAG)
  expect(reason).toContain(refused(ACME_DATASET, 'Acme'))
  expect(reason).toContain(EVERY)
  expect(namespaceDeny(session(), new Map([[LATER_DATASET, LATER_SPACE]]))).toContain(
    `${LATER_DATASET} is in another namespace (${LATER_SPACE}), not Acme Dev; the session works in Acme Dev only`,
  )
  expect(namespaceDeny(session(), new Map([[LOOSE, null], [DEV_DATASET, DEV.rid]]))).toBe(null)
  expect([...spacesOf(null, [LOOSE]).entries()]).toEqual([[LOOSE, null]])
})

test('N21: a session stored before namespaces loads with none; junk does not load', async () => {
  const { namespace: _n, spaces: _s, ...old } = session()
  expect(normalizeFde(old)).toEqual({ ...old, namespace: null, spaces: [] })
  expect(normalizeFde(session())).toEqual(session())
  expect(normalizeFde({ ...old, namespace: { name: 'no rid' }, spaces: 'x' })).toEqual({ ...old, namespace: null, spaces: [] })
  expect(normalizeFde(null)).toBe(null)
  expect(normalizeFde({ branchRid: 3 })).toBe(null)
})

test('N20 N22: status, prompt and handoff name the bound namespace; without one they never mention namespaces', async () => {
  expect(fdeStatus(session())).toContain('namespace Acme Dev (/Acme Dev)')
  expect(fdeContext(session())).toContain('Writes are limited to namespace Acme Dev (/Acme Dev)')
  expect(fdeContext(session())).toContain(EVERY)
  expect(fdeHandoff(session())).toContain('- Namespace: Acme Dev (/Acme Dev).')
  const none = session({ namespace: null, spaces: [] })
  for (const text of [fdeStatus(none), fdeContext(none), fdeHandoff(none)]) expect(/namespace/i.test(text)).toBe(false)
})

// ---------- end to end, over a fake orthanc ----------

const envelope = (data: unknown, errors: unknown[] = []) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors, meta: {}, warnings: [], artifacts: [], pagination: null })
const failure = (message: string) => envelope(null, [{ type: 'network-error', message }])
const COMMANDS: [string, string][] = [
  ['configure list', 'local'],
  ['space list', 'read-only'],
  ['ontology list', 'read-only'],
  ['resource get', 'read-only'],
  ['resource batch-get', 'read-only'],
  ['global-branch create', 'mutation'],
  ['global-branch get', 'read-only'],
  ['dataset create', 'mutation'],
]
const MANIFEST = envelope({ commands: COMMANDS.map(([path, kind]) => ({ path, kind, args: [] })) })
const RUN_UNCHECKED = 'Run unchecked'

type Harness = {
  /** Every orthanc call, without --agent, --non-interactive and --profile. */
  calls: string[]
  /** The RIDs of each batch-get. */
  batches: string[][]
  /** Questions asked through AskUserQuestion. */
  asked: string[]
  /** The answer to the next question; null: no one to ask. */
  answer: string | null
  /** Whether a batch-get of these RIDs fails. */
  batchFails: (rids: string[]) => boolean
  spaceListFails: boolean
  adoptOntology: string
  files: Map<string, string>
  store: Map<string, unknown>
}

function harness(on: On): Harness {
  const h: Harness = {
    calls: [],
    batches: [],
    asked: [],
    answer: RUN_UNCHECKED,
    batchFails: () => false,
    spaceListFails: false,
    adoptOntology: DEV_ONT.rid,
    files: new Map(),
    store: new Map<string, unknown>([['approvalMode', 'yolo']]),
  }
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (line === 'agent-manifest') return reply(MANIFEST)
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'acme', host: 'acme.example.com', is_default: true, status: 'ok' }] }))
    if (line === 'space list') {
      return reply(h.spaceListFails ? failure('space list timed out') : envelope({ spaces: [ACME, DEV].map(space => ({ rid: space.rid, display_name: space.name, path: space.path })) }))
    }
    if (line === 'ontology list') return reply(envelope({ data: [DEV_ONT, ACME_ONT, LOOSE_ONT].map(ont => ({ rid: ont.rid, display_name: ont.name, api_name: ont.name })) }))
    if (line.startsWith('resource batch-get ')) {
      const rids = words.slice(2)
      h.batches.push(rids)
      if (h.batchFails(rids)) return reply(failure('batch-get timed out'))
      const found = rids.filter(rid => rid in SPACE_OF)
      return reply(envelope({ resources: found.map(rid => ({ rid, spaceRid: SPACE_OF[rid], path: `/x/${rid}`, type: 'X' })) }))
    }
    if (line.startsWith('global-branch create ')) return reply(envelope({ branch: { rid: BRANCH, display_name: words[2] } }))
    if (line.startsWith('global-branch get ')) {
      return reply(envelope({ branch_record: { display_name: 'agent/fde-adopted', branch_status: 'OPEN', ontology_rid: h.adoptOntology } }))
    }
    return reply(envelope({ ran: line }))
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: undefined }
  })
  on('store.get', (_$, e) => ({ value: h.store.get(e.key) }))
  on('store.set', (_$, e) => {
    h.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.stat', (_$, e) => {
    const text = h.files.get(e.path)
    return { value: { kind: text === undefined ? 'other' : 'file', size: text?.length ?? 0, mtimeMs: 0, isLink: false } as never }
  })
  on('fs.read', (_$, e) => {
    const text = h.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test: no surface' } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('classic.SubagentStart', () => ({}))
  on('tool.call', (_$, e) => {
    if (String(e.tool) !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = (e as unknown as { questions: { question: string }[] }).questions[0]?.question ?? ''
    h.asked.push(question)
    if (h.answer === null) return { deny: 'test: no one to ask' } as never
    return { result: { answers: { [question]: h.answer } } } as never
  })
  return h
}

type Engine = Parameters<Parameters<typeof test>[1]>[0]
const run = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 120 } }) as const
const say = async ($: Engine, command: string, args = '') => (await $.command.run(run(command, args))).text ?? ''
const write = ($: Engine, args: string[], command = 'dataset create') =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, line: string) => h.calls.includes(line)
const prompt = async ($: Engine) =>
  ((await $.classic.SubagentStart({ agent_id: 'n', agent_type: 'foundry:foundry-scout' } as never)).additionalContext ?? []).join('\n')
const quiet = (calls: string[]) => calls.filter(call => call !== 'agent-manifest' && call !== 'configure list')

/** /profile, /ontology, /namespace (unless null), `beforeOn`, then /fde on. */
async function bind(
  $: Engine,
  h: Harness,
  options: { namespace?: FoundryNamespace | null; ontology?: { rid: string; name: string }; beforeOn?: () => void } = {},
) {
  const namespace = options.namespace === undefined ? DEV : options.namespace
  const ontology = options.ontology ?? DEV_ONT
  expect(await say($, 'profile', 'acme')).toContain('Foundry stack: acme')
  expect(await say($, 'ontology', ontology.rid)).toContain(ontology.name)
  if (namespace) expect(await say($, 'namespace', namespace.rid)).toContain(`Namespace: ${namespace.name}.`)
  options.beforeOn?.()
  const mark = h.calls.length
  const said = await say($, 'fde', 'on')
  return { said, calls: quiet(h.calls.slice(mark)) }
}

test('N4: without a namespace, /fde on and its writes make no namespace calls and refuse nothing new', async ($, on) => {
  const h = harness(on)
  const { said, calls } = await bind($, h, { namespace: null })
  expect(said).toContain('FDE mode on')
  expect(calls.map(call => call.split(' ').slice(0, 2).join(' '))).toEqual(['global-branch create'])
  const wrote = await write($, ['people', '--parent-folder-rid', ACME_PROJECT])
  expect(wrote.deny).toBe(undefined)
  expect(ran(h, `dataset create people --parent-folder-rid ${ACME_PROJECT}`)).toBe(true)
  expect(h.calls.some(call => call === 'space list' || call.startsWith('resource batch-get'))).toBe(false)
})

test('N1 N22: /fde on in a namespace checks the ontology first, then makes the branch, and says so', async ($, on) => {
  const h = harness(on)
  const { said, calls } = await bind($, h)
  expect(calls.map(call => call.split(' ').slice(0, 2).join(' '))).toEqual(['space list', 'resource batch-get', 'global-branch create'])
  expect(h.batches).toEqual([[DEV_ONT.rid]])
  expect(said).toContain('namespace Acme Dev (/Acme Dev)')
})

test('N1: /fde on refuses an ontology in another namespace, before any branch exists', async ($, on) => {
  const h = harness(on)
  const { said } = await bind($, h, { ontology: ACME_ONT })
  expect(said).toContain('Acme Ontology is in Acme, not Acme Dev')
  expect(said).toContain('FDE mode stays off')
  expect(h.calls.some(call => call.startsWith('global-branch create'))).toBe(false)
  expect(await say($, 'fde')).toContain('FDE mode is off')
})

for (const [name, setup, expected] of [
  ['an ontology in no namespace', (_h: Harness) => undefined, 'is not in any namespace'],
  ['a failed lookup', (h: Harness) => void (h.batchFails = () => true), 'Could not check'],
  ['a failed space list', (h: Harness) => void (h.spaceListFails = true), 'Could not check'],
] as const) {
  test(`N2: /fde on refuses ${name}`, async ($, on) => {
    const h = harness(on)
    const ontology = name === 'an ontology in no namespace' ? LOOSE_ONT : DEV_ONT
    const { said } = await bind($, h, { ontology, beforeOn: () => setup(h) })
    expect(said).toContain(expected)
    expect(said).toContain('FDE mode stays off')
    expect(h.calls.some(call => call.startsWith('global-branch create'))).toBe(false)
  })
}

test('N3: /fde --branch refuses a branch whose ontology is in another namespace', async ($, on) => {
  const h = harness(on)
  h.adoptOntology = ACME_ONT.rid
  expect(await say($, 'profile', 'acme')).toContain('Foundry stack: acme')
  expect(await say($, 'ontology', ACME_ONT.rid)).toContain(ACME_ONT.name)
  expect(await say($, 'namespace', DEV.rid)).toContain('Namespace: Acme Dev.')
  const said = await say($, 'fde', `--branch ${BRANCH} adopted work`)
  expect(said).toContain('Acme Ontology is in Acme, not Acme Dev')
  expect(said).toContain('FDE mode stays off')
  expect(await say($, 'fde')).toContain('FDE mode is off')
})

test('N5 N25: a write naming a resource in another namespace is refused and never runs', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  for (const target of [ACME_PROJECT, ACME_DATASET, ACME_TYPE]) {
    const wrote = await write($, ['people', '--parent-folder-rid', target])
    expect(wrote.deny ?? '').toMatch(TAG)
    expect(wrote.deny ?? '').toContain(refused(target, 'Acme'))
    expect(wrote.deny ?? '').toContain(EVERY)
  }
  expect(h.calls.some(call => call.startsWith('dataset create'))).toBe(false)
})

test('N5 N11: a write inside the namespace runs, and so does one naming only RIDs batch-get leaves out', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  expect((await write($, ['people', '--parent-folder-rid', DEV_PROJECT, '--input', DEV_DATASET])).deny).toBe(undefined)
  expect(ran(h, `dataset create people --parent-folder-rid ${DEV_PROJECT} --input ${DEV_DATASET}`)).toBe(true)
  expect((await write($, ['ledger', LOOSE, 'ri.a.b.c.d'])).deny).toBe(undefined)
  expect(ran(h, `dataset create ledger ${LOOSE} ri.a.b.c.d`)).toBe(true)
})

test('N6: a write naming another namespace\'s RID is refused without a lookup', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  const before = h.batches.length
  const wrote = await write($, ['people', '--space-rid', ACME.rid])
  expect(wrote.deny ?? '').toContain(refused(ACME.rid, 'Acme'))
  expect(h.batches.length).toBe(before)
})

test('N7: a resource in a namespace made after binding is refused by its space RID', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  const wrote = await write($, ['people', '--parent-folder-rid', LATER_DATASET])
  expect(wrote.deny ?? '').toContain(`${LATER_DATASET} is in another namespace (${LATER_SPACE}), not Acme Dev`)
})

test('N8: a RID in a file the call reads is refused, however the file is named', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  h.files.set('/work/request.json', JSON.stringify({ name: 'people', parentFolderRid: ACME_PROJECT }))
  for (const args of [['--file', '/work/request.json'], ['@/work/request.json'], ['/work/request.json'], ['--request-file=/work/request.json']]) {
    const wrote = await write($, args)
    expect({ args, refused: (wrote.deny ?? '').includes(refused(ACME_PROJECT, 'Acme')) }).toEqual({ args, refused: true })
  }
  expect(h.calls.some(call => call.startsWith('dataset create'))).toBe(false)
})

test('N9 N10: another namespace\'s path is refused, the bound one\'s runs, by whole segments', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  expect((await write($, ['people', '--path', '/Acme/Project/people'])).deny ?? '').toContain(refused('/Acme/Project/people', 'Acme'))
  expect((await write($, ['people', '--path', '/Acme Dev/Project/people'])).deny).toBe(undefined)
  expect(ran(h, 'dataset create people --path /Acme Dev/Project/people')).toBe(true)
  h.files.set('/work/request.json', '{"name": "people", "parent": "/Acme/Project"}')
  expect((await write($, ['--file', '/work/request.json'])).deny ?? '').toContain(refused('/Acme/Project', 'Acme'))
})

test('N12 N13: a failed lookup asks; Run unchecked runs the write, and the next write asks again', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  h.batchFails = () => true
  expect((await write($, ['people', '--input', DEV_DATASET])).deny).toBe(undefined)
  expect(ran(h, `dataset create people --input ${DEV_DATASET}`)).toBe(true)
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).toContain('namespace check could not run')
  expect(h.asked[0]).toContain('Acme Dev')
  expect((await write($, ['ledger', '--input', DEV_DATASET])).deny).toBe(undefined)
  expect(h.asked.length).toBe(2)
})

test('N12 N14: Do not run, or no one to ask, refuses the write', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  h.batchFails = () => true
  for (const answer of ['Do not run', null]) {
    h.answer = answer
    const wrote = await write($, ['people', '--input', DEV_DATASET])
    expect({ answer, deny: (wrote.deny ?? '').includes('the namespace check could not run') && TAG.test(wrote.deny ?? '') }).toEqual({ answer, deny: true })
  }
  expect(h.calls.some(call => call.startsWith('dataset create'))).toBe(false)
})

test('N12: a failed lookup is not cached: the next write looks again and refuses what it finds', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  h.batchFails = () => true
  h.answer = 'Do not run'
  expect((await write($, ['people', '--input', ACME_DATASET])).deny ?? '').toContain('the namespace check could not run')
  h.batchFails = () => false
  const asked = h.asked.length
  const wrote = await write($, ['people', '--input', ACME_DATASET])
  expect(wrote.deny ?? '').toContain(refused(ACME_DATASET, 'Acme'))
  expect(h.asked.length).toBe(asked)
  expect(h.batches.filter(batch => batch.includes(ACME_DATASET)).length).toBe(2)
})

test('N15: a RID in another namespace refuses even when another chunk\'s lookup fails, and nothing asks', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  h.batchFails = rids => !rids.includes(ACME_DATASET) && !rids.includes(DEV_ONT.rid)
  h.files.set('/work/request.json', JSON.stringify({ inputs: [ACME_DATASET, ...looseRids(1000)] }))
  const wrote = await write($, ['--file', '/work/request.json'])
  expect(wrote.deny ?? '').toContain(refused(ACME_DATASET, 'Acme'))
  expect(h.asked).toEqual([])
})

test('N16: 1001 RIDs go in lookups of at most 1000; the apply after its dry run looks nothing up again', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  h.files.set('/work/request.json', JSON.stringify({ inputs: looseRids(1001) }))
  const before = h.batches.length
  expect((await write($, ['--file', '/work/request.json'])).deny).toBe(undefined)
  const sent = h.batches.slice(before)
  expect(sent.every(batch => batch.length <= 1000)).toBe(true)
  expect(sent.flat().sort()).toEqual(looseRids(1001).sort())
  expect((await write($, ['--file', '/work/request.json', '--apply'])).deny).toBe(undefined)
  expect(ran(h, 'dataset create --file /work/request.json --apply')).toBe(true)
  expect(h.batches.length).toBe(before + sent.length)
})

test('N17: reads are neither looked up nor refused', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  const before = h.batches.length
  expect((await write($, [ACME_DATASET], 'resource get')).deny).toBe(undefined)
  expect(ran(h, `resource get ${ACME_DATASET}`)).toBe(true)
  expect(h.batches.length).toBe(before)
})

test('N18: FDE off, a namespace in scope looks nothing up and refuses nothing', async ($, on) => {
  const h = harness(on)
  expect(await say($, 'profile', 'acme')).toContain('Foundry stack: acme')
  expect(await say($, 'ontology', DEV_ONT.rid)).toContain(DEV_ONT.name)
  expect(await say($, 'namespace', DEV.rid)).toContain('Namespace: Acme Dev.')
  const mark = h.calls.length
  expect((await write($, ['people', '--parent-folder-rid', ACME_PROJECT, '--path', '/Acme/P'])).deny).toBe(undefined)
  expect(quiet(h.calls.slice(mark))).toEqual([`dataset create people --parent-folder-rid ${ACME_PROJECT} --path /Acme/P`])
})

test('N19: while bound, /namespace, /scope clear and the /foundry pane keep the bound namespace', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  for (const args of [ACME.rid, 'clear', '']) {
    const said = await say($, 'namespace', args)
    expect({ args, locked: said.includes('/fde end first') }).toEqual({ args, locked: true })
  }
  expect(await say($, 'scope', 'clear')).toContain('Acme Dev')
  const pane = await $.ui.mount({
    plugin: 'foundry',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'foundry-context',
    props: { title: 'Foundry context', isFocused: true, bodyColumns: 110, placement: 'dock', scroll: { offset: 0, bodyRows: 40 } } as never,
  })
  expect(await pane.find({ key: 'clear-namespace' })).toBeDefined()
  await pane.press({ key: 'clear-namespace' })
  expect(await prompt($)).toContain(`Namespace: Acme Dev (${DEV.rid})`)
  expect((await write($, ['people', '--parent-folder-rid', ACME_PROJECT])).deny ?? '').toContain(refused(ACME_PROJECT, 'Acme'))
})

test('N20: /fde end hands off with the namespace and unlocks /namespace', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  expect(await say($, 'fde', 'end')).toContain('- Namespace: Acme Dev (/Acme Dev).')
  expect(await say($, 'namespace', 'clear')).toContain('Cleared namespace selection.')
})

test('N21: /fde resume of a session stored before namespaces resumes without one', async ($, on) => {
  const h = harness(on)
  const { namespace: _n, spaces: _s, ...old } = session()
  h.store.set('fdeOpen', old)
  expect(await say($, 'profile', 'acme')).toContain('Foundry stack: acme')
  expect(await say($, 'ontology', DEV_ONT.rid)).toContain(DEV_ONT.name)
  const said = await say($, 'fde', 'resume')
  expect(said).toContain('Resumed.')
  expect(/namespace/i.test(said)).toBe(false)
  const before = h.batches.length
  expect((await write($, ['people', '--parent-folder-rid', ACME_PROJECT])).deny).toBe(undefined)
  expect(h.batches.length).toBe(before)
})

test('N21: /fde resume puts the bound namespace back in scope and keeps its space list', async ($, on) => {
  const h = harness(on)
  h.store.set('fdeOpen', session())
  expect(await say($, 'profile', 'acme')).toContain('Foundry stack: acme')
  expect(await say($, 'ontology', DEV_ONT.rid)).toContain(DEV_ONT.name)
  expect(await say($, 'namespace', ACME.rid)).toContain('Namespace: Acme.')
  expect(await say($, 'fde', 'resume')).toContain('namespace Acme Dev (/Acme Dev)')
  expect(await prompt($)).toContain(`Namespace: Acme Dev (${DEV.rid})`)
  expect((await write($, ['people', '--space-rid', ACME.rid])).deny ?? '').toContain(refused(ACME.rid, 'Acme'))
})

test('N22: the prompt block says writes are held to the namespace', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  expect(await prompt($)).toContain('Writes are limited to namespace Acme Dev (/Acme Dev)')
})

test('N22 N23: the FDE band names the namespace and keeps the lines beneath it', async ($, on) => {
  const h = harness(on)
  on('ui.render', { component: 'AbovePrompt' }, ($inner, e) => {
    const { Text } = $inner.ui.resolve(e)
    return Text({ children: 'beneath' } as never)
  })
  await bind($, h)
  const band = await $.ui.mount({
    plugin: 'foundry',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} } as never,
  })
  expect(await band.find({ text: /· Acme Dev ·/ })).toBeDefined()
  expect(await band.find({ text: 'beneath' })).toBeDefined()
})

test('N24: a new binding looks its RIDs up again', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  expect((await write($, ['people', '--input', DEV_DATASET])).deny).toBe(undefined)
  expect(await say($, 'fde', 'end')).toContain('FDE handoff')
  expect(await say($, 'fde', 'on')).toContain('FDE mode on')
  expect((await write($, ['ledger', '--input', DEV_DATASET])).deny).toBe(undefined)
  expect(h.batches.filter(batch => batch.includes(DEV_DATASET)).length).toBe(2)
})
