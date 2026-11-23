// The guard reads every spelling of a Foundry MCP server, not one exact name.
//
// `foundry@claude-foundry` makes Orthanc the only write path (README "The
// ladder"). MCP tools that write to Foundry outside it are blocked in every
// mode. Until now the gate matched one name, `/^mcp__palantir(-mcp)?__/`, so
// the same call passed whenever the server was spelled or written another way:
// measured on origin/main (e01f1dd), `mcp__Palantir__delete_object`,
// `mcp__foundry_tools__delete_object` and `mcp__palantirFoundry__delete_object`
// all ran, unclassified, in ask-always, allow-edits, auto and yolo. The plugin's own
// tracer already reads the wider shape (`register.tsx` touchesFoundry:
// /^mcp__.*(palantir|foundry)/i), so the trace knew about a call the guard had
// let through. zay, initial commit and standing instructions: "Orthanc is the
// only write path."
//
// Ways this can fail, written before the code:
//  MS1 A Foundry-named MCP write runs in some mode because its server is
//      capitalised, underscored, or says foundry instead of palantir.
//  MS2 A Foundry-named MCP read is blocked: the guard fires on the server name
//      alone and the agent cannot list anything through its own MCP server.
//  MS3 A Foundry-named MCP tool with no read or write word in its name runs:
//      'unknown' must fail closed, like every other unreadable call.
//  MS4 The plugin's own tools are caught by their own server name:
//      `orthanc_help` is refused, or `orthanc_cli` is refused with the MCP text
//      instead of running the branch rule and the ladder.
//  MS5 A server with no Foundry name is gated: a write to GitHub, the
//      filesystem or a docs search is refused with Foundry advice.
//  MS6 The refusal reaches the real hook: asked-for in place of blocked, or an
//      ask that runs when no one answers.
//  MS7 The delete word is lost when the server name moves out of the way, so
//      the trace and every other reader see a plain mutation.
//  MS9 The widening lets through a call the old gate refused — the one failure this
//      rule can cause. Found in review of the first fix, twice: camelCase splitting
//      for the read answer made `listAndUpsertRows` read as `list`, and a verb glued
//      to a digit (`list_and_delete2objects`) was invisible to the new tokenizer.
//  MS10 A refusal claims more than the name shows, so the operator trusts the wrong
//      reason: an unreadable name reported as a write.
//
// A server that names no Foundry product (`mcp__osdk__…`, `mcp__ontology__…`) stays
// open, here and at e01f1dd. MS8 pins that as a known limit, not as a pass.
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classifyCall, classifyMcpIntent, foundryMcpTool, ladderDecision, type ManifestCommand, touchesFoundryTool } from './policy'

const MANIFEST: ManifestCommand[] = [
  { path: 'ontology list', kind: 'read-only' },
  { path: 'dataset create', kind: 'mutation' },
]
const CLI = 'mcp__foundry__orthanc_cli'
const HELP = 'mcp__foundry__orthanc_help'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const approve = { action: 'approve', reason: 'ok' } as const
const blockedEverywhere = (classification: ReturnType<typeof classifyCall>) =>
  classification?.error !== undefined && MODES.every(mode => ladderDecision(mode, classification!, approve).outcome === 'block')

// Every spelling of a server that talks to Foundry, and a write verb in the tool name.
const WRITES = [
  'mcp__palantir__write_object',
  'mcp__palantir-mcp__write_object',
  'mcp__palantir_mcp__write_object',
  'mcp__Palantir__delete_object',
  'mcp__PALANTIR__create_object_type',
  'mcp__palantir_foundry__apply_action',
  'mcp__Foundry__osdk_write',
  'mcp__foundry-mcp__delete_object',
  'mcp__foundry_tools__delete_object',
  // Letter-glued and camelCase names: no delimiter to lean on. `palantirfoundry` is
  // the host form this repo writes in `register.tsx` and `telemetry.test.ts`.
  'mcp__palantirFoundry__apply_action',
  'mcp__FoundryMCP__delete_object',
  'mcp__foundryTools__delete_object',
  'mcp__palantirfoundry__delete_object',
  'mcp__mypalantir__delete_object',
  // The `mcp__` prefix itself in caps: the trace reads it case-insensitively, so the
  // guard must too.
  'MCP__Palantir__delete_object',
  // A neutral server whose tool name says what it touches.
  'mcp__tools__foundry_delete_object',
]

test('MS1: a Foundry MCP write is blocked in every mode, in every spelling', async () => {
  for (const tool of WRITES) {
    expect({ tool, blocked: blockedEverywhere(classifyCall(tool, { object: 'ri.x' }, MANIFEST, 'agent/x')) }).toEqual({ tool, blocked: true })
    const reason = classifyCall(tool, { object: 'ri.x' }, MANIFEST, 'agent/x')!.error ?? ''
    expect({ tool, namesTool: reason.includes(tool), namesOrthanc: reason.includes('orthanc_cli') }).toEqual({ tool, namesTool: true, namesOrthanc: true })
  }
})

test('MS2b: a camelCase verb finds a write, and never lets a call through', async () => {
  // CamelCase finds writes; it never excuses one. `listObjects` is refused as unreadable
  // rather than read as a plain list, because the split that finds the `list` in
  // `listObjects` also finds the `list` in `listAndUpsertRows`, and that one is a write.
  for (const tool of ['mcp__palantir__deleteObjects', 'mcp__palantirFoundry__createObject', 'mcp__foundry_tools__updateBranch', 'mcp__palantir__listAndUpsertRows', 'mcp__palantir__getAndResetStream']) {
    expect({ tool, blocked: blockedEverywhere(classifyCall(tool, {}, MANIFEST, 'agent/x')) }).toEqual({ tool, blocked: true })
  }
  // A name the separator split can read still runs. A camelCase-only read is refused
  // with a reason naming the tool, so the operator can decide.
  expect(classifyCall('mcp__palantir__list_objects', {}, MANIFEST, null)).toBe(null)
  expect((classifyCall('mcp__palantir__listObjects', {}, MANIFEST, null)?.error ?? '').includes('mcp__palantir__listObjects')).toBe(true)
  expect({ snake: classifyMcpIntent('list_objects'), camel: classifyMcpIntent('listObjects'), write: classifyMcpIntent('deleteObjects') }).toEqual({ snake: 'read', camel: 'unknown', write: 'write' })
})

test('MS3b: a read verb does not excuse a write verb in the same name', async () => {
  // 'view' and 'get' are reads; the write word must still win, or a name that says it
  // revokes protection runs with no ladder and no ask.
  for (const tool of [
    'mcp__palantir__view_branch_and_revoke_protection',
    'mcp__palantir__get_object_and_grant_access',
    'mcp__foundry_tools__list_and_approve_action',
    'mcp__palantirFoundry__searchAndMergeRequest',
  ]) {
    expect({ tool, blocked: blockedEverywhere(classifyCall(tool, {}, MANIFEST, 'agent/x')) }).toEqual({ tool, blocked: true })
  }
})

test('MS9: nothing the old gate refused runs now', async () => {
  // The invariant this PR must keep: widening the name test may only add refusals.
  // Base (`e01f1dd`) gated `/^mcp__palantir(-mcp)?__/` and, of those names, let one
  // through when its words read as a read. Base is reproduced here in full so a name
  // base blocked cannot quietly start running after a change to the word lists.
  const BASE_GATE = /^mcp__palantir(-mcp)?__/
  const BASE_WRITE = new Set(['add', 'apply', 'build', 'create', 'delete', 'deploy', 'edit', 'install', 'post', 'publish', 'put', 'remove', 'rename', 'set', 'submit', 'update', 'write'])
  const BASE_AMBIGUOUS = new Set(['call', 'execute', 'invoke', 'run', 'trigger'])
  const BASE_READ = new Set(['check', 'describe', 'get', 'health', 'inspect', 'list', 'preview', 'query', 'read', 'search', 'view'])
  const baseVerdict = (tool: string): boolean | undefined => {
    if (!BASE_GATE.test(tool)) return undefined // not gated at base either: no constraint
    const words = tool.replace(BASE_GATE, '').toLowerCase().split(/[^a-z]+/)
    if (words.some(word => BASE_WRITE.has(word))) return false
    if (words.some(word => BASE_AMBIGUOUS.has(word))) return false
    return words.some(word => BASE_READ.has(word))
  }
  const NAMES = [
    'mcp__palantir__list_objects', 'mcp__palantir-mcp__get_object', 'mcp__palantir__search-data',
    'mcp__palantir__listObjects', 'mcp__palantir__listAndUpsertRows', 'mcp__palantir__upsertObject',
    'mcp__palantir__uploadDataset', 'mcp__palantir__resetStream', 'mcp__palantir__startSchedule',
    'mcp__palantir__stopBuild', 'mcp__palantir__acceptRequest', 'mcp__palantir__protectBranch',
    'mcp__palantir__revertCommit', 'mcp__palantir__rollbackPipeline', 'mcp__palantir__syncBranch',
    'mcp__palantir__getAndResetStream', 'mcp__palantir__view_branch_and_revoke_protection',
    'mcp__palantir__list_and_delete2objects', 'mcp__palantir__list_run2thing',
    'mcp__palantir__get_and_delete2', 'mcp__palantir__list2deleteObjects',
    'mcp__palantir__list2objects', 'mcp__foundry__get_object2',
    'mcp__palantir__delete_object', 'mcp__palantir__run_build', 'mcp__palantir__do_the_thing',
    'mcp__palantir__describe_branch', 'mcp__palantir__query_objects', 'mcp__palantir__preview_dataset',
    'mcp__palantir__check_health', 'mcp__palantir__read_object', 'mcp__palantir__inspect_branch',
    'mcp__palantir__get_and_grant_access', 'mcp__Palantir__delete_object', 'mcp__foundry_tools__delete_object',
    'mcp__github__create_issue',
  ]
  for (const tool of NAMES) {
    const base = baseVerdict(tool)
    const runs = classifyCall(tool, { object: 'ri.x' }, MANIFEST, 'agent/x') === null
    // One direction only. This rule may refuse more (`view_branch_and_revoke_protection`
    // ran at base and is a write now); it may never run more.
    if (base === false) expect({ tool, runs }).toEqual({ tool, runs: false })
  }
  // The same rule, read the other way. A verb glued to a digit is a write verb the
  // old tokenizer saw, so the write answer must see it too. `list2deleteObjects` is
  // the shape neither split can read as a write (`deleteobjects` is one word to both,
  // and `list` is a read verb): it ran at e01f1dd and still runs. That is the documented
  // vocabulary limit, not a new hole, and it is why the server list is the durable fix.
  expect({ a: classifyMcpIntent('list_and_delete2objects'), b: classifyMcpIntent('list_run2thing'), c: classifyMcpIntent('list2deleteObjects') }).toEqual({ a: 'write', b: 'unknown', c: 'read' })
})

test('MS10: the refusal says only what the name tells it', async () => {
  // A write verb is called a write; an unreadable name is called unreadable.
  const write = classifyCall('mcp__palantir__delete_object', {}, MANIFEST, 'agent/x')?.error ?? ''
  const unknown = classifyCall('mcp__palantir__do_the_thing', {}, MANIFEST, 'agent/x')?.error ?? ''
  expect({ write: write.includes('writes to Foundry'), unknown: unknown.includes('cannot read') }).toEqual({ write: true, unknown: true })
  expect({ namesTool: unknown.includes('mcp__palantir__do_the_thing'), pointsAtOrthanc: unknown.includes('orthanc_cli') }).toEqual({ namesTool: true, pointsAtOrthanc: true })
  // A name the guard cannot read is never called a write.
  expect({ unknownCallsWrite: unknown.includes('writes to Foundry') }).toEqual({ unknownCallsWrite: false })
})

test('MS7: the delete word still marks the call destructive', async () => {
  for (const tool of ['mcp__Palantir__delete_object', 'mcp__foundry_tools__delete_object', 'mcp__palantir__delete_object', 'mcp__palantir__delete2objects', 'mcp__palantir__deleteObjects']) {
    expect({ tool, destructive: classifyCall(tool, {}, MANIFEST, null)?.isDestructive }).toEqual({ tool, destructive: true })
  }
  expect(classifyCall('mcp__Palantir__write_object', {}, MANIFEST, null)?.isDestructive).toBe(false)
})

test('MS2: a Foundry MCP read is not the write path, and runs', async () => {
  for (const tool of [
    'mcp__palantir__list_objects',
    'mcp__Palantir__get_object',
    'mcp__foundry_tools__search_objects',
    'mcp__foundry-mcp__describe_object_type',
  ]) {
    expect({ tool, classified: classifyCall(tool, { typeId: 'T' }, MANIFEST, null) }).toEqual({ tool, classified: null })
  }
})

test('MS3: a Foundry MCP name with no read or write word fails closed', async () => {
  expect(classifyMcpIntent('do_the_thing')).toBe('unknown')
  for (const tool of ['mcp__foundry__do_the_thing', 'mcp__Palantir__run_batch', 'mcp__foundry_tools__handle']) {
    expect({ tool, blocked: blockedEverywhere(classifyCall(tool, {}, MANIFEST, 'agent/x')) }).toEqual({ tool, blocked: true })
  }
})

test('MS4: the plugin owns mcp__foundry__, and its two tools keep their own path', async () => {
  // orthanc_help only reads the manifest.
  expect(classifyCall(HELP, { group: 'ontology' }, MANIFEST, null)).toBe(null)
  // orthanc_cli is classified by the manifest: a read is a read, and a write takes the branch rule.
  expect(classifyCall(CLI, { command: 'ontology list' }, MANIFEST, null)).toBe(null)
  const write = classifyCall(CLI, { command: 'dataset create', args: ['foo'] }, MANIFEST, 'agent/x')
  expect((write?.error ?? '').includes('outside Orthanc')).toBe(false)
  expect(write?.command).toBe('dataset create')
})

test('MS5: a server with no Foundry name is left alone', async () => {
  // The last six are the shapes a real Claude config holds: a short build tool, a
  // vendor account, a database, a notes tool and two project-prefixed trackers. The
  // operator's real server keys have the same shapes and none carries a Foundry
  // name; they stay out of this file.
  for (const tool of [
    'mcp__github__create_issue',
    'mcp__filesystem__write_file',
    'mcp__context7__search_docs',
    'mcp__buildtool__run_build',
    'mcp__accounts__create_user',
    'mcp__database__run_query',
    'mcp__notes-service__write_note',
    'mcp__linear-project-a__create_issue',
    'mcp__linear-project-b__update_issue',
    'Read',
    'Write',
  ]) {
    expect({ tool, classified: classifyCall(tool, { path: 'a' }, MANIFEST, null) }).toEqual({ tool, classified: null })
  }
})

// The real hook: the block must reach the caller, ask no one, and run nothing.
const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

function harness(on: On, mode: (typeof MODES)[number]) {
  const asked: string[] = []
  const store = new Map<string, unknown>([['approvalMode', mode]])
  const manifest = envelope({ commands: MANIFEST })
  on('process.run', (_$, e) => {
    const line = e.argv
      .slice(1)
      .filter(word => word !== '--agent' && word !== '--non-interactive')
      .join(' ')
    return {
      value: { exitCode: 0, stdout: line === 'agent-manifest' ? manifest : envelope({ ran: line }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
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
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('tool.call', (_$, e) => {
    const call = e as unknown as { tool: string; questions?: { question: string }[] }
    if (call.tool !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = call.questions?.[0]?.question ?? ''
    asked.push(question)
    return { result: { questions: call.questions, answers: { [question]: 'Approve' } } } as never
  })
  return { asked }
}

test('MS8: the gate answers for every spelling, and never wider than the trace', async () => {
  // The defect this rule exists to close: the trace called a call Foundry while the
  // guard did not, so it ran with no ladder. Every name the trace claims must at
  // least reach the guard, even where the guard then lets a read through.
  const NAMES = [
    ...WRITES,
    'mcp__palantir__list_objects',
    'mcp__Palantir__get_object',
    'mcp__foundry_tools__search_objects',
    'mcp__palantirfoundry__delete_object',
    'mcp__palantir-mcp__delete_object',
    'mcp__Palantir__delete_object',
  ]
  for (const tool of NAMES) {
    expect({ tool, gated: foundryMcpTool(tool) !== null, traced: touchesFoundryTool(tool, {}) }).toEqual({ tool, gated: true, traced: true })
  }
  for (const tool of ['mcp__github__create_issue', 'mcp__filesystem__write_file', 'mcp__linear-project-a__create_issue', 'Read']) {
    expect({ tool, gated: foundryMcpTool(tool) !== null, traced: touchesFoundryTool(tool, {}) }).toEqual({ tool, gated: false, traced: false })
  }
  // A frozen answer table, gate side, over every shape a config can hold. Narrowing
  // the matcher fails on the camel and glued rows; widening it fails on `osdk` and
  // `ontology`, which name no Foundry product and are pinned NOT gated on purpose, so
  // widening stays a decision and not a slip.
  const EXPECTED: [string, boolean][] = [
    // ['mcp__palantir', true] is the shape a gate must not miss: the name starts `mcp__`
    // and stops there, so the whole rest is the server name. The loop below checks the
    // trace answer against this column too, so the frozen table pins both sides.
    ['mcp__palantir__write_object', true],
    ['mcp__palantir-mcp__write_object', true],
    ['mcp__palantir_mcp__write_object', true],
    ['MCP__Palantir__delete_object', true],
    ['mcp__palantirFoundry__apply_action', true],
    ['mcp__palantirfoundry__delete_object', true],
    ['mcp__foundry_tools__delete_object', true],
    ['mcp__tools__foundry_delete_object', true],
    ['mcp__refoundry__list', true],
    ['mcp__palantir__list_objects', true],
    ['mcp__palantir', true],
    ['mcp__github__create_issue', false],
    ['mcp__filesystem__write_file', false],
    ['mcp__osdk__write_object', false],
    ['mcp__ontology__delete_object', false],
  ]
  for (const [tool, gated] of EXPECTED) {
    expect({ tool, gated: foundryMcpTool(tool) !== null, traced: touchesFoundryTool(tool, {}) }).toEqual({ tool, gated, traced: gated })
  }
})

for (const mode of MODES) {
  test(`MS6: through the hook in ${mode}, a Foundry MCP write is refused with no one asked, and orthanc_help still answers`, async ($, on) => {
    const h = harness(on, mode)
    for (const tool of ['mcp__Palantir__delete_object', 'mcp__foundry_tools__write_object', 'mcp__palantir_foundry__apply_action']) {
      const out = (await $.tool.call({ tool, object: 'ri.x' } as never)) as { deny?: string }
      expect({ mode, tool, deny: typeof out.deny === 'string' && out.deny.includes('outside Orthanc') }).toEqual({ mode, tool, deny: true })
    }
    expect(h.asked).toEqual([])
    // The plugin's own tools answer in the same session.
    const help = (await $.tool.call({ tool: HELP, group: 'ontology' } as never)) as { deny?: string }
    expect(help.deny).toBe(undefined)
    const read = (await $.tool.call({ tool: CLI, command: 'ontology list' } as never)) as { deny?: string }
    expect(read.deny).toBe(undefined)
  })
}
