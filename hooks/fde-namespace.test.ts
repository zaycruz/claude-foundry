// FDE mode and the namespace in scope (orthanc calls it a space).
//
// zay, 2026-10-21, chose "Refuse it": /fde on bound the namespace in scope and
// every write naming a resource outside it was refused. zay, 2026-11-20:
// "the default fde mode should be able to do whatever it wants on a branch and
// raise the proposal and merge the proposal, just nothing direct against main
// or master" — the per-write namespace scan is gone. What stays of the
// namespace is where the mode starts: /fde on and /fde --branch still check
// that the ontology is in the namespace in scope (nothing is made when it is
// not), the namespace stays in scope while bound (/namespace is locked until
// /fde end), and it is named in the status, the prompt, the band and the
// handoff.
//
// Ways this can fail, written before the code:
//  N1  /fde on with a namespace binds without checking that the ontology is in it,
//      or creates the branch before the check, so a refused start leaves a branch behind.
//  N2  /fde on binds although the ontology is in no namespace (batch-get leaves it
//      out), or a failed space list or lookup binds anyway. Nothing exists yet at
//      /fde on, so there a failure refuses.
//  N3  /fde --branch adopts a branch whose ontology is in another namespace.
//  N4  With no namespace in scope, FDE mode makes extra calls (space list,
//      batch-get) or refuses something it did not refuse before.
//  N5  The old hold comes back: a write naming a resource, a space RID or a path
//      in another namespace is refused while bound, or costs a batch-get at
//      write time.
//  N6  While bound, /namespace (a pick, clear, the picker), /scope clear or the
//      /foundry pane's clear button changes the namespace in scope, and the
//      prompt and the gate disagree.
//  N7  /fde end leaves /namespace locked, or the handoff omits the namespace.
//  N8  /fde resume of a session stored before namespaces fails or invents one;
//      a resumed namespace is not the scope's again.
//  N9  The status, prompt block or band omits the bound namespace, or a session
//      without one talks about namespaces.
//  N10 The FDE band hides other plugins' AbovePrompt lines: it never calls next
//      (bead hooks-0gy).
//  N11 The bind check reads the wrong spaceRid for the asked ontology.
//
// Synthetic stack only: Acme and Acme Dev, where one path is a string prefix
// of the other.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { FdeSession, FoundryNamespace } from '../types'
import { spacesOf } from './fde'

const CLI = 'mcp__foundry__orthanc_cli'
const ACME: FoundryNamespace = { rid: 'ri.compass.main.folder.a0000000-0000-4000-8000-00000000000a', name: 'Acme', path: '/Acme' }
const DEV: FoundryNamespace = { rid: 'ri.compass.main.folder.a0000000-0000-4000-8000-00000000000d', name: 'Acme Dev', path: '/Acme Dev' }
const DEV_ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-00000000000d', name: 'Acme Dev Ontology' }
const ACME_ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-0000000000a', name: 'Acme Ontology' }
const LOOSE_ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-000000000000', name: 'Loose Ontology' }
const ACME_PROJECT = 'ri.compass.main.folder.f0000000-0000-4000-8000-00000000000a'
const ACME_DATASET = 'ri.foundry.main.dataset.c0000000-0000-4000-8000-00000000000a'
const BRANCH = 'ri.branch..branch.b0000000-0000-4000-8000-000000000001'

// ---------- pure ----------

const session = (over: Partial<FdeSession> = {}): FdeSession => ({
  goal: '',
  profile: 'acme',
  ontologyRid: DEV_ONT.rid,
  branchRid: BRANCH,
  branchName: 'agent/fde-202610210900',
  startedAt: '2026-10-21T09:00:00.000Z',
  applied: [],
  namespace: DEV,
  spaces: [ACME, DEV],
  ...over,
})

test('N11: the bind check reads each asked RID\'s spaceRid, in asked order, and null when batch-get left it out', async () => {
  const asked = [ACME_DATASET, DEV_ONT.rid, 'ri.foundry.main.transaction.e0000000-0000-4000-8000-000000000000']
  const spaces = spacesOf(
    { resources: [ACME_DATASET, DEV_ONT.rid].map(rid => ({ rid, spaceRid: rid === ACME_DATASET ? ACME.rid : DEV.rid, path: '/x', type: 'X' })) },
    asked,
  )
  expect([...spaces.entries()]).toEqual([[ACME_DATASET, ACME.rid], [DEV_ONT.rid, DEV.rid], ['ri.foundry.main.transaction.e0000000-0000-4000-8000-000000000000', null]])
  expect([...spacesOf(null, asked).entries()]).toEqual(asked.map(rid => [rid, null]))
  expect(session()).toEqual(session())
})

// ---------- end to end, over a fake orthanc ----------

const envelope = (data: unknown, errors: unknown[] = []) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors, meta: {}, warnings: [], artifacts: [], pagination: null })
const failure = (message: string) => envelope(null, [{ type: 'network-error', message }])
const COMMANDS: [string, string][] = [
  ['configure list', 'local'],
  ['space list', 'read-only'],
  ['space create', 'mutation'],
  ['ontology list', 'read-only'],
  ['resource get', 'read-only'],
  ['resource batch-get', 'read-only'],
  ['global-branch create', 'mutation'],
  ['global-branch get', 'read-only'],
  ['dataset create', 'mutation'],
]
const MANIFEST = envelope({ commands: COMMANDS.map(([path, kind]) => ({ path, kind, args: [] })) })

type Harness = {
  /** Every orthanc call, without --agent, --non-interactive and --profile. */
  calls: string[]
  /** The RIDs of each batch-get. */
  batches: string[][]
  /** Questions asked through AskUserQuestion. */
  asked: string[]
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
      const found = rids.filter(rid => rid === DEV_ONT.rid || rid === ACME_ONT.rid)
      return reply(envelope({ resources: found.map(rid => ({ rid, spaceRid: rid === DEV_ONT.rid ? DEV.rid : ACME.rid, path: `/x/${rid}`, type: 'X' })) }))
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
    return { value: {} }
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
    return { result: { answers: { [question]: 'Approve' } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const run = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } }) as const
const say = async ($: Engine, command: string, args = '') => (await $.command.run(run(command, args))).text ?? ''
const write = ($: Engine, args: string[], command = 'dataset create') =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, line: string) => h.calls.includes(line)
const prompt = async ($: Engine) =>
  ((await $.classic.SubagentStart({ agent_id: 'n', agent_type: 'foundry:foundry-scout' } as never)).additionalContext ?? []).join('\n')
// A manifest read runs `version` beside `agent-manifest` (orthanc-0hzh).
const quiet = (calls: string[]) => calls.filter(call => call !== 'agent-manifest' && call !== 'version' && call !== 'configure list')

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

test('N1 N9: /fde on in a namespace checks the ontology first, then makes the branch, and says so', async ($, on) => {
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

test('N5: while bound, a write naming another namespace runs with no lookup and no question', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  const before = h.batches.length
  for (const args of [
    ['people', '--parent-folder-rid', ACME_PROJECT],
    ['people', '--space-rid', ACME.rid],
    ['people', '--input', ACME_DATASET],
    ['people', '--path', '/Acme/Project/people'],
  ]) {
    expect({ args, deny: (await write($, args)).deny }).toEqual({ args, deny: undefined })
  }
  h.files.set('/work/request.json', JSON.stringify({ name: 'people', parentFolderRid: ACME_PROJECT }))
  expect((await write($, ['--file', '/work/request.json'])).deny).toBe(undefined)
  const orgs = ['-e', 'ri.control-panel.main.enrollment.e0000000-0000-4000-8000-000000000001', '-o', 'ri.multipass..organization.e0000000-0000-4000-8000-000000000002']
  expect((await write($, ['Shadow', ...orgs], 'space create')).deny).toBe(undefined)
  expect(h.batches.length).toBe(before)
  expect(h.asked).toEqual([])
  expect(ran(h, `dataset create people --parent-folder-rid ${ACME_PROJECT}`)).toBe(true)
  expect(ran(h, `dataset create --file /work/request.json`)).toBe(true)
  expect(ran(h, `space create Shadow ${orgs.join(' ')}`)).toBe(true)
})

test('N5: reads still run while bound, with no lookup', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  const before = h.batches.length
  expect((await write($, [ACME_DATASET], 'resource get')).deny).toBe(undefined)
  expect(ran(h, `resource get ${ACME_DATASET}`)).toBe(true)
  expect(h.batches.length).toBe(before)
})

test('N6: while bound, /namespace, /scope clear and the /foundry pane keep the bound namespace', async ($, on) => {
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
})

test('N7: /fde end hands off with the namespace and unlocks /namespace', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  const handoff = await say($, 'fde', 'end')
  expect(handoff).toContain('- Namespace: Acme Dev (/Acme Dev).')
  expect(await say($, 'namespace', 'clear')).toContain('Cleared namespace selection.')
})

test('N8: /fde resume of a session stored before namespaces resumes without one', async ($, on) => {
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

test('N8: /fde resume puts the bound namespace back in scope', async ($, on) => {
  const h = harness(on)
  h.store.set('fdeOpen', session())
  expect(await say($, 'profile', 'acme')).toContain('Foundry stack: acme')
  expect(await say($, 'ontology', DEV_ONT.rid)).toContain(DEV_ONT.name)
  expect(await say($, 'namespace', ACME.rid)).toContain('Namespace: Acme.')
  expect(await say($, 'fde', 'resume')).toContain('namespace Acme Dev (/Acme Dev)')
  expect(await prompt($)).toContain(`Namespace: Acme Dev (${DEV.rid})`)
})

test('N9: the prompt block says the namespace is in scope and locked, not that writes are limited', async ($, on) => {
  const h = harness(on)
  await bind($, h)
  const text = await prompt($)
  expect(text).toContain('The namespace in scope is Acme Dev (/Acme Dev)')
  expect(text).toContain('/namespace stays locked until /fde end')
  expect(text.includes('Writes are limited to namespace')).toBe(false)
})

test('N9 N10: the FDE band names the namespace and keeps the lines beneath it', async ($, on) => {
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
