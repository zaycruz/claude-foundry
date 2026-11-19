// The slash commands and the /foundry context view.
//
// Ways this can fail, written before the code:
//  1. A command is missing, or two names do the same thing (no aliases).
//  2. A command orthanc cannot back quietly calls REST or guesses a type, instead
//     of saying it waits on an orthanc bead.
//  3. A scope stored by v0.1 (no actionTypes, no resources) crashes the new code.
//  4. Resource listing sends the wrong orthanc argv: search without a query,
//     list with one, or no --folder-rid root.
//  5. Rows without a RID, or the same RID from two roots, land in the scope.
//  6. Re-picking from a filtered listing drops selections the listing never showed.
//  7. Changing the ontology keeps object types, action types, functions or
//     object instances that belong to the old ontology.
//  8. The prompt block omits a selected resource kind, so the model never sees it.
//  9. The context tree miscounts, or a clear button clears the wrong thing.
// 10. '/objects text' invents a property instead of saying orthanc needs --query.
//
// Link types, interfaces and automations (orthanc 0.7.7 and 0.7.10 list all
// three, so they are pickers now), written before the code:
// L1  /link-type or /interface still says it waits on a bead, runs a command
//     other than `ontology link-type-list` / `ontology interface-list`, or runs
//     it on an ontology other than the one in scope, or opens another picker.
// L2  FDE mode is bound and the read omits --branch, so it lists main's types; or
//     a branch that is not FDE's reaches the wire (the name a branch creation
//     left as the working branch, or a binding whose ontology is not the one in
//     scope), or the listing does not say which branch it read.
// L3  A row is keyed by something but its RID (the same type lands twice, or a
//     row with no RID does), or the pick shows no clue what the link joins or
//     which object types implement the interface.
// L4  /automation walks outside the namespace in scope, ignores the selected
//     projects, or throws the argument away instead of passing `--name`.
// L5  A pick lands under the wrong scope key, is missing from the prompt block,
//     or /foundry does not count it or clears the wrong thing.
// L6  Changing the ontology keeps link types, interfaces or automations picked
//     under the old one; a different namespace keeps automations walked outside
//     it; re-picking drops what an earlier listing showed.
// L7  A failed listing saves a selection anyway.
// L8  `clear` on one of them clears another kind, or clears nothing.
// Namespace scope (one Compass namespace, which orthanc calls a space), also
// written before the code; hooks/e2e.local.test.ts runs them over recorded output:
// F-NS1  /namespace lists something other than `space list`, or saves the namespace
//        without its path (search needs the path, not the display name).
// F-NS2  With a namespace, /project still lists every project on the stack.
// F-NS3  With a namespace and no project, Compass pickers root at projects outside it.
// F-NS4  With a namespace, /search looks outside its path, or keeps --limit, which
//        orthanc ignores once --path-prefix is set.
// F-NS5  A different namespace keeps projects and Compass resources picked outside
//        it; re-picking the same one, or clearing it, throws picks away.
// F-NS6  A stored scope from before namespaces fails to load, or loads a namespace
//        without a RID.
// F-NS7  The prompt block omits the namespace, its path, or how to stay inside it,
//        so the model lists and searches the whole stack anyway.
// F-NS8  /open forces a namespace on a stack that does not need one.
// F-NS9  A failed `space list` or `project list --space-rid` saves anything.
// F-NS10 Switching profiles loses or leaks a profile's namespace.
// F-NS11 /scope clear, or clearing the namespace, leaves it in the prompt.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import type { FdeSession } from '../types'
import {
  applyClear,
  COMMAND_TABLE,
  contextLines,
  entityRows,
  foundryTree,
  mergeSelections,
  namespaceChanged,
  normalizeScope,
  objectsQuery,
  ontologyChanged,
  resourceArgs,
  resourceRows,
} from './catalog'
import { readBranch } from './fde'
import { serialize } from './orthanc'

const run = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 120 } }) as const

const COMMANDS = [
  'foundry', 'open', 'onboard', 'auth', 'profile', 'ontology', 'namespace', 'project', 'object-type', 'action-type',
  'link-type', 'interface', 'folder', 'dataset', 'media-set', 'repository', 'contour', 'source',
  'developer-console', 'aip-chatbot', 'egress-policy', 'certificate', 'automation', 'media-item', 'objects',
  'function', 'language-model', 'permission', 'search', 'scope', 'approval', 'mcp-status', 'trace', 'fde',
]

const scope = normalizeScope(
  {
    profile: 'tester',
    host: 'h',
    ontology: { rid: 'ri.ont.1', name: 'Acme' },
    projects: [{ rid: 'ri.p.1', name: 'Shared' }],
    objectTypes: [{ apiName: 'Program', displayName: 'Program' }],
    actionTypes: [{ apiName: 'upsert', displayName: 'Upsert' }],
    resources: {
      datasets: [{ rid: 'ri.d.1', name: 'people', hint: '/Acme/people' }],
      functions: [{ rid: 'ri.f.1', name: 'score', hint: 'function' }],
      linkTypes: [{ rid: 'ri.ont.main.relation.1', name: 'Orders', hint: 'Account → Order' }],
      interfaces: [{ rid: 'ri.ont.main.interface.1', name: 'Auditable', hint: 'Account' }],
      automations: [{ rid: 'ri.object-sentinel.main.monitor.1', name: 'Nightly sync', hint: '/Acme/Nightly sync' }],
    },
  },
  'zap',
  'h',
)

test('each command has exactly one name: no aliases, no duplicates (recap ships as a markdown command)', async () => {
  const names = COMMAND_TABLE.map(entry => entry.name)
  expect([...names].sort()).toEqual([...COMMANDS].sort())
  expect(new Set(names).size).toBe(names.length)
  const actions = COMMAND_TABLE.map(entry => JSON.stringify(entry.action))
  expect(new Set(actions).size).toBe(actions.length)
  expect(COMMAND_TABLE.some(entry => /alias/i.test(entry.description))).toBe(false)
})

// orthanc 0.7.10's agent manifest: `ontology link-type-list`, `ontology
// interface-list` and `automate list` exist, and no egress-policy or certificate
// list does (only `connectivity egress ensure`), so only these two wait.
test('the blocked list is exactly egress-policy and certificate, each named to its bead', async () => {
  const blocked = COMMAND_TABLE.filter(entry => entry.action.type === 'blocked')
  expect(blocked.map(entry => `${entry.name}=${entry.action.type === 'blocked' ? entry.action.bead : ''}`).sort()).toEqual([
    'certificate=orthanc-qm5',
    'egress-policy=orthanc-qm5',
  ])
  // Link types and interfaces waited on orthanc-ra6; that bead is gone from the mod.
  expect(JSON.stringify(COMMAND_TABLE)).not.toContain('orthanc-ra6')
})

test('a blocked command answers with its bead without running orthanc', async $ => {
  const egress = await $.command.run(run('egress-policy', 'anything'))
  expect(egress.text).toContain('orthanc-qm5')
  const certificate = await $.command.run(run('certificate', ''))
  expect(certificate.text).toContain('orthanc-qm5')
})

test('a v0.1 stored scope loads with empty new fields', async () => {
  const old = normalizeScope({ profile: 'zap', host: 'h', ontology: null, projects: [], objectTypes: [], updatedAt: 'x' }, 'zap', 'h')
  expect(old.actionTypes).toEqual([])
  expect(old.resources).toEqual({})
  expect(old.namespace).toBe(null)
  expect(normalizeScope({ namespace: { name: 'no rid', path: '/x' } }, 'zap', 'h').namespace).toBe(null)
  expect(normalizeScope(null, 'acme', 'r').profile).toBe('acme')
  expect(normalizeScope({ profile: 7, resources: 'bad' }, 'acme', 'r').resources).toEqual({})
})

test('resource listing argv: search with a query, list without, always rooted', async () => {
  expect(resourceArgs('', 'FOUNDRY_DATASET', 'ri.p.1')).toEqual(['resource', 'list', '--type', 'FOUNDRY_DATASET', '--folder-rid', 'ri.p.1'])
  expect(resourceArgs(' people ', 'FOUNDRY_DATASET', 'ri.p.1')).toEqual(
    ['resource', 'search', 'people', '--type', 'FOUNDRY_DATASET', '--folder-rid', 'ri.p.1'],
  )
})

test('rows without a RID are dropped and duplicate RIDs collapse', async () => {
  const rows = resourceRows([
    { rid: 'ri.d.1', display_name: 'people', path: '/a/people' },
    { rid: 'ri.d.1', display_name: 'people', path: '/a/people' },
    { display_name: 'ghost' },
    { rid: 'ri.d.2', name: 'orders', type: 'FOUNDRY_DATASET' },
  ])
  expect(rows).toEqual([
    { rid: 'ri.d.1', name: 'people', hint: '/a/people' },
    { rid: 'ri.d.2', name: 'orders', hint: 'FOUNDRY_DATASET' },
  ])
})

test('re-picking keeps selections the filtered listing did not show', async () => {
  const kept = { rid: 'ri.d.9', name: 'hidden', hint: '' }
  const shown = { rid: 'ri.d.1', name: 'people', hint: '' }
  const merged = mergeSelections([kept, shown], [], [shown])
  expect(merged).toEqual([kept])
})

test('changing the ontology clears everything that belonged to the old one', async () => {
  const next = ontologyChanged(scope, { rid: 'ri.ont.2', name: 'Sandbox' })
  expect(next.objectTypes).toEqual([])
  expect(next.actionTypes).toEqual([])
  expect(next.projects).toEqual([])
  expect(next.resources.functions).toEqual([])
  expect(next.resources.linkTypes).toEqual([])
  expect(next.resources.interfaces).toEqual([])
  expect(next.resources.automations).toEqual([])
  expect(next.resources.datasets?.length).toBe(1)
})

test('a different namespace drops the automations walked outside it', async () => {
  const moved = namespaceChanged(scope, { rid: 'ri.compass.main.space.2', name: 'Dev', path: '/Dev' })
  expect(moved.resources.automations).toEqual([])
  expect(moved.resources.datasets).toEqual([])
  expect(moved.resources.linkTypes?.length).toBe(1)
  expect(moved.resources.functions?.length).toBe(1)
})

test('L2: a listing names a branch only while the FDE binding matches the scope', async () => {
  const bound: FdeSession = {
    goal: 'tidy the webhook',
    profile: 'tester',
    ontologyRid: 'ri.ont.1',
    branchRid: 'ri.branch..branch.b0000000-0000-4000-8000-0000000000b1',
    branchName: 'agent/webhook',
    startedAt: '2026-11-19T00:00:00.000Z',
    plans: [],
    applied: [],
    namespace: null,
    spaces: [],
  }
  expect(readBranch(bound, 'tester', 'ri.ont.1')).toEqual({ rid: bound.branchRid, name: bound.branchName })
  // Another stack, or the operator pointing at another ontology: the binding does
  // not describe what is in scope, so the read stays on main rather than naming a
  // branch of somewhere else.
  expect(readBranch(bound, 'other', 'ri.ont.1')).toBe(null)
  expect(readBranch(bound, 'tester', 'ri.ont.2')).toBe(null)
  // No FDE mode: the session's working branch (which a branch creation can leave
  // as a name, paired with no ontology) is never what a listing reads.
  expect(readBranch(null, 'tester', 'ri.ont.1')).toBe(null)
})

test('link-type and interface rows key on the RID and say what they join', async () => {
  const rows = entityRows(
    [
      { rid: 'ri.ont.main.relation.1', api_name: 'orders', display_name: 'Orders', object_type_a: 'Account', object_type_b: 'Order' },
      { rid: 'ri.ont.main.relation.1', api_name: 'orders', display_name: 'Orders', object_type_a: 'Account', object_type_b: 'Order' },
      { api_name: 'ghost', display_name: 'Ghost', object_type_a: 'Account' },
      { rid: 'ri.ont.main.relation.2', api_name: 'contact', display_name: 'Contact' },
    ],
    ['object_type_a', 'object_type_b'],
    ' → ',
  )
  expect(rows).toEqual([
    { rid: 'ri.ont.main.relation.1', name: 'Orders', hint: 'Account → Order' },
    { rid: 'ri.ont.main.relation.2', name: 'Contact', hint: '' },
  ])
  expect(entityRows([{ rid: 'ri.i.1', api_name: 'auditable', implemented_by: [{ api_name: 'Account' }, 'Order'] }], ['implemented_by'], ', ')).toEqual([
    { rid: 'ri.i.1', name: 'auditable', hint: 'Account, Order' },
  ])
})

test('the prompt block names every selected kind', async () => {
  const text = contextLines(scope).join('\n')
  for (const part of ['Acme', 'Shared', 'Program', 'Upsert', 'people (ri.d.1)', 'score (ri.f.1)', 'Orders (ri.ont.main.relation.1)', 'Auditable (ri.ont.main.interface.1)', 'Nightly sync (ri.object-sentinel.main.monitor.1)']) expect(text).toContain(part)
})

test('the context tree counts each section and clears the right thing', async () => {
  const tree = foundryTree(scope)
  const section = (id: string) => tree.find(node => node.id === id)
  expect(section('ontology')?.count).toBe(1)
  expect(section('resource:datasets')?.count).toBe(1)
  expect(section('resource:mediaSets')).toBe(undefined)
  const dataset = section('resource:datasets')?.children[0]
  expect(dataset?.label).toBe('people')
  const cleared = applyClear(scope, dataset!.clear!)
  expect(cleared.resources.datasets).toEqual([])
  expect(cleared.resources.functions?.length).toBe(1)
  const noTypes = applyClear(scope, section('objectTypes')!.clear!)
  expect(noTypes.objectTypes).toEqual([])
  expect(noTypes.actionTypes.length).toBe(1)
  expect(section('resource:linkTypes')?.count).toBe(1)
  expect(section('resource:linkTypes')?.command).toBe('/link-type')
  expect(section('resource:interfaces')?.command).toBe('/interface')
  expect(section('resource:automations')?.command).toBe('/automation')
  const iface = section('resource:interfaces')?.children[0]
  expect(iface?.label).toBe('Auditable')
  expect(applyClear(scope, iface!.clear!).resources.interfaces).toEqual([])
})

test('/objects needs property=text; plain text waits on orthanc --query', async $ => {
  expect(objectsQuery('name=Acme Corp')).toEqual({ property: 'name', text: 'Acme Corp' })
  expect(objectsQuery('Acme')).toBe(null)
  const ran = await $.command.run(run('objects', 'Acme'))
  expect(ran.text).toContain('orthanc-4f7')
})

// Found live (2026-10-11 scout run): a cut page hid its next_page_token, and
// the mod's subagents never saw the Foundry block.
test('a cut envelope keeps its page token and row counts above the cut', async () => {
  const rows = Array.from({ length: 400 }, (_, index) => ({ api_name: `T${index}`, display_name: 'x'.repeat(60) }))
  const envelope = { schema_version: 'foundry-agent-v1', data: { object_types: rows, next_page_token: 'tok-42' }, errors: [] }
  const text = serialize(envelope, '/tmp/foundry-orthanc/x.json')
  expect(text.indexOf('next_page_token: tok-42')).toBeLessThan(400)
  expect(text).toContain('object_types: 400')
  expect(text.slice(0, 9000)).toContain('object_types: T0, T1, T2')
  expect(text.slice(0, 9000)).toContain('T399')
  expect(text).toContain('/tmp/foundry-orthanc/x.json')
  expect(serialize({ data: { a: 1 } })).toBe(JSON.stringify({ data: { a: 1 } }, null, 2))
})

test('foundry subagents get the Foundry block when they start; others do not', async ($, on) => {
  on('classic.SubagentStart', () => ({}))
  on('store.get', () => ({ value: undefined }))
  const scout = await $.classic.SubagentStart({ agent_id: 'a1', agent_type: 'foundry:foundry-scout' })
  expect((scout.additionalContext ?? []).join('\n')).toContain('# Palantir Foundry')
  const other = await $.classic.SubagentStart({ agent_id: 'a2', agent_type: 'Explore' })
  expect((other.additionalContext ?? []).join('\n')).not.toContain('# Palantir Foundry')
})

// ---------- /link-type, /interface and /automation over a fake orthanc ----------

const ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-0000000000a1', name: 'Tester Ontology' }
const OTHER_ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-0000000000a2', name: 'Sandbox Ontology' }
const BRANCH = { rid: 'ri.branch..branch.b0000000-0000-4000-8000-0000000000b1', name: 'agent/fde-wire-check' }
const SPACE = { rid: 'ri.compass.main.space.d0000000-0000-4000-8000-0000000000c0', name: 'Acme Space', path: '/Acme' }
const PROJECT = { rid: 'ri.compass.main.folder.d0000000-0000-4000-8000-0000000000c1', name: 'Acme Platform', path: '/Acme/Platform' }
const PROJECT_TWO = { rid: 'ri.compass.main.folder.d0000000-0000-4000-8000-0000000000c2', name: 'Acme Ops', path: '/Acme/Ops' }
const LINK_ONE = { rid: 'ri.ontology.main.relation.d0000000-0000-4000-8000-0000000000d1', name: 'Orders' }
const LINK_TWO = { rid: 'ri.ontology.main.relation.d0000000-0000-4000-8000-0000000000d2', name: 'Contact' }
// A second link named 'Orders', joining different object types: 16 of 59 link
// types on a real ontology share a display name across joins, so a pick of two
// of them has to say which is which.
// 'Orders' names two links, and the picker's filter matches substrings of the name,
// so the only filter that reaches one of them is its RID.
const FIRST_ORDERS = 'ri.ontology.main.relation.d0000000-0000-4000-8000-0000000000d1'
const LINK_DUP = { rid: 'ri.ontology.main.relation.d0000000-0000-4000-8000-0000000000d3', name: 'Orders' }
const IFACE = { rid: 'ri.ontology.main.interface.d0000000-0000-4000-8000-0000000000e1', name: 'Auditable' }
const MONITOR = { rid: 'ri.object-sentinel.main.monitor.d0000000-0000-4000-8000-0000000000f1', name: 'Nightly sync' }
const MONITOR_TWO = { rid: 'ri.object-sentinel.main.monitor.d0000000-0000-4000-8000-0000000000f2', name: 'Weekly rollup' }

const LINK_TYPES = [
  { api_name: 'orders', display_name: LINK_ONE.name, object_type_a: 'Account', object_type_b: 'Order', rid: LINK_ONE.rid },
  { api_name: 'contacts', display_name: LINK_TWO.name, object_type_a: 'Account', object_type_b: 'Contact', rid: LINK_TWO.rid },
  // A row orthanc cannot give a RID for: it is not pickable.
  { api_name: 'shipments', display_name: LINK_DUP.name, object_type_a: 'Account', object_type_b: 'Shipment', rid: LINK_DUP.rid },
  { api_name: 'ghost', display_name: 'Ghost', object_type_a: 'Account' },
]
const INTERFACES = [
  { api_name: 'auditable', display_name: IFACE.name, implemented_by: [{ api_name: 'Account' }, { api_name: 'Order' }], rid: IFACE.rid },
  { api_name: 'versioned', display_name: 'Versioned', implemented_by: [], rid: 'ri.ontology.main.interface.d0000000-0000-4000-8000-0000000000e2' },
]
const AUTOMATIONS = [
  { rid: MONITOR.rid, name: MONITOR.name, path: `${PROJECT.path}/${MONITOR.name}`, folder_rid: PROJECT.rid },
  { rid: MONITOR_TWO.rid, name: MONITOR_TWO.name, path: `${PROJECT_TWO.path}/${MONITOR_TWO.name}`, folder_rid: PROJECT_TWO.rid },
]

const envelope = (data: unknown, errors: unknown[] = []) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors, meta: {}, warnings: [], artifacts: [], pagination: null })
const MANIFEST = envelope({ commands: [{ path: 'ontology list', kind: 'read-only', args: [] }] })

type Harness = {
  /** Every orthanc call, without --agent, --non-interactive and --profile. */
  calls: string[]
  store: Map<string, unknown>
  /** Command prefixes whose read fails. */
  fail: string[]
  /** Whole calls that fail, for a listing that fails at one root only. */
  failExact: string[]
  /** What `project list` returns. */
  projects: Record<string, unknown>[]
}

function harness(on: On): Harness {
  const h: Harness = { calls: [], fail: [], failExact: [], store: new Map<string, unknown>([['approvalMode', 'yolo']]), projects: [{ rid: PROJECT.rid, display_name: PROJECT.name, path: PROJECT.path }] }
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const flag = (name: string) => {
      const index = words.indexOf(name)
      return index === -1 ? '' : (words[index + 1] ?? '')
    }
    if (h.failExact.includes(line) || h.fail.some(command => line.startsWith(command))) return reply(envelope(null, [{ type: 'network-error', message: 'orthanc could not reach the stack' }]))
    if (line === 'agent-manifest') return reply(MANIFEST)
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }, { name: 'other', host: 'other.example.com', is_default: false, status: 'ok' }] }))
    if (line === 'ontology list')
      return reply(envelope({ data: [{ rid: ONT.rid, api_name: 'tester', display_name: ONT.name }, { rid: OTHER_ONT.rid, api_name: 'sandbox', display_name: OTHER_ONT.name }] }))
    if (line === 'space list') return reply(envelope({ spaces: [{ rid: SPACE.rid, display_name: SPACE.name, path: SPACE.path }] }))
    if (line.startsWith('project list')) return reply(envelope({ projects: h.projects }))
    if (line.startsWith('global-branch get '))
      return reply(envelope({ branch_record: { branch_rid: BRANCH.rid, branch_status: 'OPEN', display_name: BRANCH.name, ontology_rid: ONT.rid, description: '' } }))
    if (line.startsWith('ontology link-type-list ')) return reply(envelope({ link_types: LINK_TYPES, total: LINK_TYPES.length }))
    if (line.startsWith('ontology interface-list ')) return reply(envelope({ interfaces: INTERFACES, total: INTERFACES.length }))
    if (line.startsWith('automate list')) {
      const name = flag('--name')
      const folder = flag('--folder-rid')
      const rows = AUTOMATIONS.filter(entry => folder === '' || entry.folder_rid === folder)
      return reply(envelope({ automations: name === '' ? rows : rows.filter(entry => entry.path.includes(name)) }))
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
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } as never }))
  on('fs.read', (_$, e) => {
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test: no surface' } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('classic.SubagentStart', () => ({}))
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const say = async ($: Engine, command: string, args = '') =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)).text ?? ''
const prompt = async ($: Engine) =>
  ((await $.classic.SubagentStart({ agent_id: 'a', agent_type: 'foundry:foundry-scout' } as never)).additionalContext ?? []).join('\n')
/** What /profile picked for this stack, as the mod loads it (empty kinds drop out). */
const saved = (h: Harness) => normalizeScope((h.store.get('scopes') as Record<string, unknown> | undefined)?.tester, 'tester', 'tester.example.com')

/** /profile tester, /ontology Tester Ontology. */
async function open($: Engine) {
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  expect(await say($, 'ontology', ONT.rid)).toContain(ONT.name)
}

test('L1 L3 L5 L6: /link-type and /interface pick from the selected ontology, and the pick reaches scope, prompt and /foundry', async ($, on) => {
  const h = harness(on)
  await open($)
  const listed = await say($, 'link-type', '')
  expect(h.calls).toContain(`ontology link-type-list ${ONT.rid}`)
  expect(listed).toContain(LINK_ONE.name)
  expect(listed).toContain('Account → Order')
  expect(listed.includes('Ghost')).toBe(false)
  expect(await say($, 'link-type', FIRST_ORDERS)).toContain(`Link types: ${LINK_ONE.name}`)
  expect(await say($, 'interface', IFACE.name)).toContain(`Interfaces: ${IFACE.name}`)
  expect(h.calls).toContain(`ontology interface-list ${ONT.rid}`)
  const picked = saved(h)
  expect(picked.resources.linkTypes).toEqual([{ rid: LINK_ONE.rid, name: LINK_ONE.name, hint: 'Account → Order' }])
  expect(picked.resources.interfaces).toEqual([{ rid: IFACE.rid, name: IFACE.name, hint: 'Account, Order' }])
  const text = await prompt($)
  expect(text).toContain(`Link types: ${LINK_ONE.name} (${LINK_ONE.rid})`)
  expect(text).toContain(`Interfaces: ${IFACE.name} (${IFACE.rid})`)
  const tree = await say($, 'foundry')
  expect(tree).toContain('Link types (1)')
  expect(tree).toContain('Interfaces (1)')
  // Re-picking from a filtered listing keeps what was picked before, and the
  // listing shows it as chosen.
  expect(await say($, 'link-type', LINK_TWO.name)).toContain(`Link types: ${LINK_ONE.name}, ${LINK_TWO.name}`)
  expect(saved(h).resources.linkTypes?.length).toBe(2)
  // L3: two picks sharing a display name are named apart by their RIDs.
  expect(await say($, 'link-type', 'Shipment')).toContain(`Link types: ${LINK_ONE.name} (${LINK_ONE.rid}), ${LINK_TWO.name}, ${LINK_DUP.name} (${LINK_DUP.rid})`)
  // L8: `clear` on one of them clears that kind and no other.
  expect(await say($, 'link-type', 'clear')).toContain('Cleared link types selection')
  expect(saved(h).resources.linkTypes).toBeUndefined()
  expect(saved(h).resources.interfaces?.length).toBe(1)
  expect(await say($, 'interface', 'clear')).toContain('Cleared interfaces selection')
  expect(saved(h).resources.interfaces).toBeUndefined()
  expect(await say($, 'link-type', FIRST_ORDERS)).toContain(`Link types: ${LINK_ONE.name}`)
  // A different ontology drops them: they belong to the old one.
  expect(await say($, 'ontology', OTHER_ONT.rid)).toContain(`${OTHER_ONT.name}. Projects, types, link types, interfaces, automations, functions and object instances were cleared.`)
  expect(saved(h).resources.linkTypes).toBeUndefined()
  expect(saved(h).resources.interfaces).toBeUndefined()
  expect((await prompt($)).includes('Link types:')).toBe(false)
})

test('L2: only FDE mode reads a branch, only while it is the scope\'s, and its picks go with it', async ($, on) => {
  const h = harness(on)
  await open($)
  // A plain session reads main: no --branch on any call.
  expect(await say($, 'link-type', '')).toContain(LINK_ONE.name)
  expect(h.calls.filter(call => call.includes('--branch'))).toEqual([])
  // FDE mode binds (stack, ontology, branch), so its reads name the branch and say so.
  expect(await say($, 'fde', `--branch ${BRANCH.rid} tidy the webhook`)).toContain('FDE mode on')
  expect(await say($, 'link-type', '')).toContain(BRANCH.name)
  expect(h.calls).toContain(`ontology link-type-list ${ONT.rid} --branch ${BRANCH.rid}`)
  expect(await say($, 'interface', '')).toContain(BRANCH.name)
  expect(h.calls).toContain(`ontology interface-list ${ONT.rid} --branch ${BRANCH.rid}`)
  expect(await say($, 'link-type', FIRST_ORDERS)).toContain(`Link types: ${LINK_ONE.name}`)
  expect(saved(h).resources.linkTypes?.length).toBe(1)
  // A stack switch (allowed while bound) neither reads the branch there nor loses
  // what was picked on it, and the branch is named again back on its own stack.
  h.calls.length = 0
  expect(await say($, 'profile', 'other')).toContain('Foundry stack: other')
  // The other stack has its own scope, and the branch does not follow the binding there.
  expect(await say($, 'link-type', '')).toContain('No ontology is selected')
  expect(h.calls.filter(call => call.includes('--branch'))).toEqual([])
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  expect(await say($, 'link-type', '')).toContain(BRANCH.name)
  expect(saved(h).resources.linkTypes?.length).toBe(1)
  // The operator points at another ontology: the binding no longer describes it,
  // so nothing is named, and the branch's picks went with the old ontology.
  h.calls.length = 0
  expect(await say($, 'ontology', OTHER_ONT.rid)).toContain(`${OTHER_ONT.name}. Projects, types, link types, interfaces, automations, functions and object instances were cleared.`)
  expect(await say($, 'link-type', '')).toContain(LINK_ONE.name)
  expect(h.calls.filter(call => call.includes('--branch'))).toEqual([])
  expect(saved(h).resources.linkTypes).toBeUndefined()
  // Back on its own ontology the branch is named again, and /fde end takes it away
  // along with what was picked on it.
  expect(await say($, 'ontology', ONT.rid)).toContain(ONT.name)
  expect(await say($, 'interface', IFACE.name)).toContain(`Interfaces: ${IFACE.name}`)
  h.calls.length = 0
  expect(await say($, 'fde', 'end')).toContain('# FDE handoff')
  expect(saved(h).resources.interfaces).toBeUndefined()
  expect(await say($, 'interface', '')).toContain(IFACE.name)
  expect(h.calls).toContain(`ontology interface-list ${ONT.rid}`)
  expect(h.calls.filter(call => call.includes('--branch'))).toEqual([])
})

test('L2: /fde resume keeps the picks that came off the branch it rebinds', async ($, on) => {
  const h = harness(on)
  await open($)
  // The store mirror exists for this: the session restarted, so FDE mode is off
  // and /fde resume rebinds it. What was picked before the restart stays.
  h.store.set('fdeOpen', {
    goal: 'tidy the webhook',
    profile: 'tester',
    ontologyRid: ONT.rid,
    branchRid: BRANCH.rid,
    branchName: BRANCH.name,
    startedAt: '2026-11-19T00:00:00.000Z',
    plans: [],
    applied: [],
    namespace: null,
    spaces: [],
  })
  expect(await say($, 'link-type', FIRST_ORDERS)).toContain(`Link types: ${LINK_ONE.name}`)
  expect(await say($, 'fde', 'resume')).toContain('Resumed.')
  expect(saved(h).resources.linkTypes?.length).toBe(1)
  expect(await say($, 'link-type', '')).toContain(BRANCH.name)
  expect(h.calls).toContain(`ontology link-type-list ${ONT.rid} --branch ${BRANCH.rid}`)
})

test('L2: ending FDE mode while on another stack still drops that branch\'s picks', async ($, on) => {
  const h = harness(on)
  await open($)
  expect(await say($, 'fde', `--branch ${BRANCH.rid} tidy the webhook`)).toContain('FDE mode on')
  expect(await say($, 'link-type', FIRST_ORDERS)).toContain(`Link types: ${LINK_ONE.name}`)
  // /profile while bound is allowed, and each stack keeps its own scope: the picks
  // are in the bound stack's record, so ending the mode there clears that record.
  expect(await say($, 'profile', 'other')).toContain('Foundry stack: other')
  expect(saved(h).resources.linkTypes?.length).toBe(1)
  expect(await say($, 'fde', 'end')).toContain('# FDE handoff')
  expect(saved(h).resources.linkTypes).toBeUndefined()
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  h.calls.length = 0
  expect(await say($, 'link-type', '')).toContain(LINK_ONE.name)
  expect(h.calls.filter(call => call.includes('--branch'))).toEqual([])
  expect(saved(h).resources.linkTypes).toBeUndefined()
})

test('L4 L5 L8: /automation walks the projects or the namespace, filters with --name, and clears alone', async ($, on) => {
  const h = harness(on)
  await open($)
  // No project and no namespace: one walk, rooted at nothing.
  expect(await say($, 'automation', '')).toContain(MONITOR.name)
  expect(h.calls).toContain('automate list')
  expect(await say($, 'automation', MONITOR.name)).toContain(`Automations: ${MONITOR.name}`)
  expect(h.calls).toContain(`automate list --name ${MONITOR.name}`)
  expect(saved(h).resources.automations).toEqual([{ rid: MONITOR.rid, name: MONITOR.name, hint: `${PROJECT.path}/${MONITOR.name}` }])
  expect(await prompt($)).toContain(`Automations: ${MONITOR.name} (${MONITOR.rid})`)
  expect(await say($, 'foundry')).toContain('Automations (1)')
  expect(await say($, 'automation', 'clear')).toContain('Cleared automations selection')
  expect(saved(h).resources.automations).toBeUndefined()
  expect(saved(h).resources.linkTypes).toEqual(undefined)
  // Under a namespace: only its projects, never the whole stack.
  h.projects = []
  expect(await say($, 'namespace', SPACE.rid)).toContain(`${SPACE.name}. Projects, Compass resources and automations picked before were cleared.`)
  expect(await say($, 'automation', '')).toContain('No projects are visible in Acme Space')
  h.projects = [{ rid: PROJECT.rid, display_name: PROJECT.name, path: PROJECT.path }, { rid: PROJECT_TWO.rid, display_name: PROJECT_TWO.name, path: PROJECT_TWO.path }]
  expect(await say($, 'automation', '')).toContain(MONITOR.name)
  expect(h.calls).toContain(`project list --space-rid ${SPACE.rid}`)
  expect(h.calls).toContain(`automate list --folder-rid ${PROJECT.rid}`)
  // One root failing shrinks the walk instead of failing it, and says so.
  h.failExact = [`automate list --folder-rid ${PROJECT_TWO.rid}`]
  const partial = await say($, 'automation', '')
  expect(partial).toContain(MONITOR.name)
  expect(partial).toContain('1 of 2 listings failed')
  // A selected project roots the walk there.
  h.failExact = []
  expect(await say($, 'project', PROJECT.rid)).toContain(PROJECT.name)
  expect(await say($, 'automation', '')).toContain(MONITOR.name)
  expect(h.calls.filter(call => call === 'automate list').length).toBe(1)
  expect(h.calls.filter(call => call.startsWith('automate list --folder-rid')).length).toBeGreaterThan(0)
})

test('L1 L7 L8: no ontology, a failed listing, and a filter nothing matches save nothing', async ($, on) => {
  const h = harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  expect(await say($, 'link-type', '')).toContain('/ontology')
  expect(await say($, 'interface', '')).toContain('/ontology')
  expect(h.calls.some(call => call.startsWith('ontology link-type-list'))).toBe(false)
  await open($)
  h.fail = ['ontology interface-list', 'automate list']
  expect(await say($, 'interface', '')).toContain('interface-list failed')
  expect(await say($, 'automation', '')).toContain('automate list failed')
  expect(saved(h).resources.interfaces).toBeUndefined()
  expect(saved(h).resources.automations).toBeUndefined()
  expect(await say($, 'link-type', 'nothing matches this')).toContain('0 link types')
  expect(saved(h).resources.linkTypes).toBeUndefined()
  h.fail = []
  expect(await say($, 'automation', 'nothing matches this')).toContain('No automations found')
  expect(saved(h).resources.automations).toBeUndefined()
})
