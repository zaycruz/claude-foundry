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
import { expect, test } from 'claude-code/testing'

import {
  applyClear,
  COMMAND_TABLE,
  contextLines,
  foundryTree,
  mergeSelections,
  normalizeScope,
  objectsQuery,
  ontologyChanged,
  resourceArgs,
  resourceRows,
} from './catalog'
import { serialize } from './orthanc'

const run = (command: string, args: string) =>
  ({ command, args, origin: { kind: 'sdk' }, presentation: { isFullscreen: false, columns: 120 } }) as const

const COMMANDS = [
  'foundry', 'open', 'onboard', 'auth', 'profile', 'ontology', 'project', 'object-type', 'action-type',
  'link-type', 'interface', 'folder', 'dataset', 'media-set', 'repository', 'contour', 'source',
  'developer-console', 'aip-chatbot', 'egress-policy', 'certificate', 'automation', 'media-item', 'objects',
  'function', 'language-model', 'permission', 'search', 'scope', 'approval', 'mcp-status', 'trace', 'fde',
]

const scope = normalizeScope(
  {
    profile: 'zap',
    host: 'h',
    ontology: { rid: 'ri.ont.1', name: 'Acme' },
    projects: [{ rid: 'ri.p.1', name: 'Shared' }],
    objectTypes: [{ apiName: 'Program', displayName: 'Program' }],
    actionTypes: [{ apiName: 'upsert', displayName: 'Upsert' }],
    resources: {
      datasets: [{ rid: 'ri.d.1', name: 'people', hint: '/Acme/people' }],
      functions: [{ rid: 'ri.f.1', name: 'score', hint: 'function' }],
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

test('commands orthanc cannot back name their bead and are never wired to a source', async () => {
  const blocked = COMMAND_TABLE.filter(entry => entry.action.type === 'blocked')
  expect(blocked.map(entry => entry.name).sort()).toEqual(
    ['automation', 'certificate', 'egress-policy', 'interface', 'link-type'],
  )
  for (const entry of blocked) {
    expect(entry.action.type === 'blocked' && /^orthanc-[a-z0-9]+$/.test(entry.action.bead)).toBe(true)
  }
})

test('a blocked command answers with its bead without running orthanc', async $ => {
  const ran = await $.command.run(run('link-type', ''))
  expect(ran.text).toContain('orthanc-ra6')
  const egress = await $.command.run(run('egress-policy', 'anything'))
  expect(egress.text).toContain('orthanc-qm5')
})

test('a v0.1 stored scope loads with empty new fields', async () => {
  const old = normalizeScope({ profile: 'zap', host: 'h', ontology: null, projects: [], objectTypes: [], updatedAt: 'x' }, 'zap', 'h')
  expect(old.actionTypes).toEqual([])
  expect(old.resources).toEqual({})
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
  expect(next.resources.datasets?.length).toBe(1)
})

test('the prompt block names every selected kind', async () => {
  const text = contextLines(scope).join('\n')
  for (const part of ['Acme', 'Shared', 'Program', 'Upsert', 'people (ri.d.1)', 'score (ri.f.1)']) expect(text).toContain(part)
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
