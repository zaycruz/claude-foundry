// The guard reads every spelling of a Foundry MCP server, not one exact name.
//
// `foundry@claude-foundry` makes Orthanc the only write path (README "The
// ladder"). MCP tools that write to Foundry outside it are blocked in every
// mode. Until now the gate matched one name, `/^mcp__palantir(-mcp)?__/`, so
// the same call passed whenever the server was spelled or written another way:
// measured on origin/main (e01f1dd), `mcp__Palantir__delete_object`,
// `mcp__foundry_tools__delete_object` and `mcp__ontology__delete_object` all
// ran, unclassified, in ask-always, allow-edits, auto and yolo. The plugin's own
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
import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { classifyCall, classifyMcpIntent, ladderDecision, type ManifestCommand } from './policy'

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

test('MS7: the delete word still marks the call destructive', async () => {
  for (const tool of ['mcp__Palantir__delete_object', 'mcp__foundry_tools__delete_object', 'mcp__palantir__delete_object']) {
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
  for (const tool of ['mcp__github__create_issue', 'mcp__filesystem__write_file', 'mcp__context7__search_docs', 'Read', 'Write']) {
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

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]

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
