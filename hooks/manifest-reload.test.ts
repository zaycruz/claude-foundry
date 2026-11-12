// orthanc_help and orthanc_cli keep the agent-manifest of the orthanc that was
// installed when the session first read it (orthanc-0hzh).
//
// Seen on 2026-11-12 in the Orthanc coordinator session: `orthanc_cli version`
// answered 0.7.1, but orthanc_help listed no automate, branch-protection,
// pipeline, transforms, workshop, marketplace or devops group. The session's
// process started on 2026-11-08 and read the manifest of the 0.6 binary; 0.7.0
// was installed over it on 2026-11-11 at the same path. The binary path,
// ORTHANC_BIN (unset) and PATH were the same as in a new session, so the cause
// was the cache: once loaded, the manifest was never read again.
//
// Ways this can fail, written before the code:
//  R1  The binary is replaced mid-session (same path, new contents): the old
//      command list stays until a restart. Agents say orthanc lacks a group
//      it has.
//  R2  A link is pointed at another release (same path, other target): the
//      same.
//  R3  The check is costly: it starts a process on every call, or checks the
//      binary more than once in one call (the guard and the executor each).
//  R4  A reload is silent: the agent is not told that the list changed, or
//      from which version to which. Or the notice repeats on every call.
//  R5  The binary is deleted: the tool loses its commands, or tries to read a
//      manifest on every call, or does not say why the list may be stale.
//  R6  The new binary's manifest is invalid (not JSON, no commands, an error
//      envelope): the tool is left with no commands, or uses the broken list,
//      or does not say it kept the old one. Or it starts the broken binary on
//      every call, or never tries again.
//  R7  ORTHANC_BIN changes (set, changed, unset): the tool keeps the manifest
//      of the binary it used before.
//  R8  Concurrent calls arrive during a reload: each starts its own
//      agent-manifest, one sees an empty list, or the notice is shown twice.
//  R9  The --help cache keeps the old binary's text for a command.
//  R10 orthanc_cli refuses a command only the new binary has ("unknown
//      command"), though orthanc_help lists it.
//  R11 No manifest could ever be read (no orthanc at start): a later call
//      after orthanc is installed still fails.
//
// From the Opus review of 0a3d8f3 (claude-foundry #9), written before the fixes:
//  R12 A read that a later-started read overtook gives its caller the older
//      binary's list after the newer one loaded.
//  R13 A command's kind changes between versions and the call is judged by
//      the old kind.
//  R14 The binary is replaced while the operator approves a call: the call
//      runs on the new binary, judged by the old one's list.
//  R15 The binary is deleted, or its new manifest is unreadable: orthanc_cli
//      keeps judging calls by the old list (for 60 s, again and again), and a
//      command the new binary marks as a mutation runs as a read.
//  R16 The spawn finds the binary again by name, so it can start another file
//      than the one the stat judged.
//  R17 The 60 s retry counts from the start of a slow failed read, so the
//      broken binary is started again sooner than 60 s after it failed.
//  R18 With no binary and no manifest, every call starts two processes that
//      fail; orthanc_cli tries to read a manifest on its own.
//  R19 A binary that does not report its version gives a notice that reads
//      "changed from 0.6.0 to of unknown version".
//
// Synthetic binaries and a synthetic file system only.
import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const HELP = 'mcp__foundry__orthanc_help'
const CLI = 'mcp__foundry__orthanc_cli'
const SYSTEM = '/usr/local/bin/orthanc'
const DEV = '/home/tester/dev/orthanc'
const PATH = '/home/tester/.local/shim:/usr/local/bin:/usr/bin'

const envelope = (data: unknown, errors: unknown[] = []) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors, meta: {}, warnings: [], artifacts: [], pagination: null })

/** A stand-in orthanc: its version, its command groups, and how its manifest reads. */
type Binary = {
  /** null: `version` answers with no version. */
  version: string | null
  groups: string[]
  manifest?: 'ok' | 'garbage' | 'empty' | 'error'
  /** Extra commands, with their kind. */
  extra?: { path: string; kind: string }[]
  /** agent-manifest of this binary takes this long. */
  delayMs?: number
}
type File = { size: number; mtimeMs: number; target?: string }

type Harness = {
  /** Files by path; a `target` is a symbolic link. */
  files: Map<string, File>
  /** What each real file does when it runs. */
  binaries: Map<string, Binary>
  env: Map<string, string>
  /** Every orthanc command line run, as `<real binary> <line>`. */
  runs: string[]
  /** Every path $.fs.stat was asked about. */
  stats: string[]
  /** agent-manifest takes this long. */
  manifestMs: number
  /** argv[0] of every process started. */
  argv0s: string[]
  /** Every question put to the operator. */
  asks: string[]
  /** Runs while the operator is asked (the wait an approval takes). */
  onAsk?: () => void
  store: Map<string, unknown>
}

const realOf = (h: Harness, path: string) => {
  let at = path
  for (let hops = 0; hops < 8; hops++) {
    const file = h.files.get(at)
    if (file === undefined) return undefined
    if (file.target === undefined) return at
    at = file.target
  }
  return undefined
}

/** What execvp would start for argv[0]. */
function launched(h: Harness, argv0: string): string | undefined {
  if (argv0.includes('/')) return realOf(h, argv0)
  for (const dir of (h.env.get('PATH') ?? '').split(':')) {
    const real = realOf(h, `${dir}/${argv0}`)
    if (real !== undefined) return real
  }
  return undefined
}

function commandsOf(binary: Binary) {
  return [
    ...binary.groups.flatMap(group => [
      { path: `${group} list`, kind: 'read-only', args: [] },
      { path: `${group} status`, kind: 'read-only', args: [] },
    ]),
    ...(binary.extra ?? []).map(command => ({ ...command, args: [] })),
  ]
}

function harness(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const h: Harness = {
    files: new Map([[SYSTEM, { size: 1000, mtimeMs: 100 }]]),
    binaries: new Map([[SYSTEM, { version: '0.6.0', groups: ['configure', 'ontology'] }]]),
    env: new Map([['HOME', '/home/tester'], ['PATH', PATH]]),
    runs: [],
    stats: [],
    manifestMs: 0,
    argv0s: [],
    asks: [],
    store: new Map<string, unknown>([['approvalMode', 'yolo']]),
  }
  on('process.run', async (_$, e) => {
    h.argv0s.push(e.argv[0] ?? '')
    const real = launched(h, e.argv[0] ?? '')
    if (real === undefined) return { deny: `cannot start ${e.argv[0]}: spawn ${e.argv[0]} ENOENT` }
    const binary = h.binaries.get(real)!
    const words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words.splice(0, 2)
    const line = words.join(' ')
    h.runs.push(`${real} ${line}`)
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (line === 'agent-manifest') {
      const delay = binary.delayMs ?? h.manifestMs
      if (delay > 0) await clock.sleep(delay)
      const how = binary.manifest ?? 'ok'
      if (how === 'garbage') return reply('Segmentation fault')
      if (how === 'empty') return reply(envelope({ commands: [] }))
      if (how === 'error') return reply(envelope(null, [{ type: 'internal', message: 'manifest broke' }]))
      return reply(envelope({ commands: commandsOf(binary) }))
    }
    if (line === 'version') return reply(envelope(binary.version === null ? {} : { version: binary.version }))
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
    if (e.argv.includes('--help')) return reply(`usage of ${line} from orthanc ${binary.version}`)
    return reply(envelope({ ran: line, by: binary.version }))
  })
  on('fs.stat', (_$, e) => {
    h.stats.push(e.path)
    const real = realOf(h, e.path)
    if (real === undefined) throw new Error(`ENOENT: no such file or directory, stat '${e.path}'`)
    const file = h.files.get(real)!
    return { value: { kind: 'file', size: file.size, mtimeMs: file.mtimeMs, isLink: h.files.get(e.path)?.target !== undefined, ...(e.resolve ? { realPath: real } : {}) } }
  })
  on('env.get', (_$, e) => ({ value: h.env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) h.env.delete(e.name)
    else h.env.set(e.name, e.value)
    return { value: undefined }
  })
  on('store.get', (_$, e) => ({ value: h.store.get(e.key) }))
  on('store.set', (_$, e) => {
    h.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.read', (_$, e) => {
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('fs.write', () => ({ value: undefined }) as never)
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test: no surface' } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('classic.SubagentStart', () => ({}))
  // $.ui.ask reaches the operator as an AskUserQuestion call (as in tag.test.ts).
  on('tool.call', (_$, e) => {
    const asked = e as unknown as { tool: string; questions?: { question: string }[] }
    if (asked.tool !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = asked.questions?.[0]?.question ?? ''
    h.asks.push(question)
    h.onAsk?.()
    return { result: { questions: asked.questions, answers: { [question]: 'Approve' } } } as never
  })
  return { h, clock }
}

/** Installs another release at `path`, the way install.sh does: new contents, new mtime. */
function install(h: Harness, path: string, binary: Binary, at = 200) {
  h.files.set(path, { size: 1000 + (binary.version ?? '').length * 7 + binary.groups.length, mtimeMs: at })
  h.binaries.set(path, binary)
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
type Reply = { deny?: string; result?: unknown }
const help = async ($: Engine, input: Record<string, string> = {}) => {
  const reply = (await $.tool.call({ tool: HELP, ...input } as never)) as Reply
  return String(reply.result ?? reply.deny)
}
const cli = async ($: Engine, command: string, args: string[] = []) => {
  const reply = (await $.tool.call({ tool: CLI, command, args } as never)) as Reply
  return JSON.parse(String(reply.result)) as { data: unknown; errors: { type?: string; message?: string }[] }
}
const manifestRuns = (h: Harness) => h.runs.filter(run => run.endsWith(' agent-manifest'))
const NEW = { version: '0.7.1', groups: ['automate', 'branch-protection', 'configure', 'ontology', 'workshop'] }

test('R1 R4: a binary replaced mid-session is read again, and orthanc_help says so once', async ($, _on) => {
  const { h } = harness(_on)
  const before = await help($)
  expect(before).toContain('ontology (2)')
  expect(before.includes('automate')).toBe(false)
  install(h, SYSTEM, NEW)
  const after = await help($)
  expect(after).toContain('automate (2)')
  expect(after).toContain('branch-protection (2)')
  expect(after).toContain('workshop (2)')
  const notice = after.split('\n')[0]!
  expect(notice).toContain('0.6.0')
  expect(notice).toContain('0.7.1')
  expect(notice.indexOf('0.6.0') < notice.indexOf('0.7.1')).toBe(true)
  // Once: the next call does not repeat it. (Never three identical calls in a
  // row in these tests: the loop guard blocks the third.)
  const again = await help($, { group: 'automate' })
  expect(again.includes('0.6.0')).toBe(false)
  expect(again).toContain("Orthanc group 'automate': 2 commands")
})

test('R2: a link pointed at another release is read again', async ($, on) => {
  const { h } = harness(on)
  h.files.set('/opt/orthanc/0.6.0', { size: 1000, mtimeMs: 100 })
  h.binaries.set('/opt/orthanc/0.6.0', { version: '0.6.0', groups: ['ontology'] })
  h.files.set(SYSTEM, { size: 0, mtimeMs: 0, target: '/opt/orthanc/0.6.0' })
  expect(await help($)).toContain('ontology (2)')
  // Same size and mtime, other target: only the target tells them apart.
  h.files.set('/opt/orthanc/0.7.1', { size: 1000, mtimeMs: 100 })
  h.binaries.set('/opt/orthanc/0.7.1', NEW)
  h.files.set(SYSTEM, { size: 0, mtimeMs: 0, target: '/opt/orthanc/0.7.1' })
  expect(await help($)).toContain('automate (2)')
})

test('R3: an unchanged binary is not started again, and each call checks it once', async ($, on) => {
  const { h } = harness(on)
  await help($)
  const loads = h.runs.length
  expect(manifestRuns(h)).toEqual([`${SYSTEM} agent-manifest`])
  h.stats.length = 0
  await help($)
  await help($, { group: 'ontology' })
  expect(h.runs.length).toBe(loads)
  // A PATH walk is one stat per directory up to the binary: shim, then /usr/local/bin.
  expect(h.stats.filter(path => path.endsWith('/orthanc'))).toEqual([
    '/home/tester/.local/shim/orthanc', SYSTEM,
    '/home/tester/.local/shim/orthanc', SYSTEM,
  ])
  // orthanc_cli: the guard checks once and the executor stats again just
  // before the spawn (review of #9, SHOULD 1). Two walks, no process but the call.
  h.stats.length = 0
  const runs = h.runs.length
  const out = await cli($, 'ontology list')
  expect(out.errors).toEqual([])
  expect(h.stats.filter(path => path === SYSTEM).length).toBe(2)
  expect(h.runs.slice(runs)).toEqual([`${SYSTEM} ontology list`])
})

test('R5: a deleted binary keeps the old list, says why, and starts nothing', async ($, on) => {
  const { h } = harness(on)
  await help($)
  h.files.delete(SYSTEM)
  const runs = h.runs.length
  const out = await help($)
  expect(out).toContain('ontology (2)')
  expect(out).toContain('not found')
  expect(out).toContain('0.6.0')
  expect(await help($, { query: 'ontology' })).toContain('not found')
  expect(h.runs.length).toBe(runs)
  // Put back as a newer release: read again.
  install(h, SYSTEM, NEW, 300)
  const back = await help($)
  expect(back).toContain('automate (2)')
  expect(back.includes('not found')).toBe(false)
})

for (const broken of ['garbage', 'empty', 'error'] as const) {
  test(`R6: a new binary whose manifest is ${broken} keeps the old list with a warning, and is tried again later`, async ($, on) => {
    const { h, clock } = harness(on)
    await help($)
    install(h, SYSTEM, { version: '0.7.1', groups: ['automate'], manifest: broken })
    const out = await help($)
    expect(out).toContain('ontology (2)')
    expect(out.includes('automate')).toBe(false)
    expect(out).toContain('agent-manifest')
    expect(out).toContain('0.6.0')
    expect(manifestRuns(h).length).toBe(2)
    // Not on every call.
    const warned = await help($, { group: 'ontology' })
    expect(warned).toContain('ontology list')
    expect(warned).toContain('0.6.0')
    expect(manifestRuns(h).length).toBe(2)
    // Later, once.
    await clock.advance(61_000)
    await help($)
    expect(manifestRuns(h).length).toBe(3)
    // A fixed release is read at once.
    install(h, SYSTEM, NEW, 400)
    const fixed = await help($)
    expect(fixed).toContain('automate (2)')
    expect(fixed.split('\n')[0]).toContain('0.7.1')
  })
}

test('R7: ORTHANC_BIN set, changed and unset each read that binary', async ($, on) => {
  const { h } = harness(on)
  expect(await help($)).toContain('ontology (2)')
  h.files.set(DEV, { size: 4242, mtimeMs: 500 })
  h.binaries.set(DEV, { version: '0.8.0-dev', groups: ['devops', 'ontology'] })
  h.env.set('ORTHANC_BIN', DEV)
  const dev = await help($, { group: 'devops' })
  expect(dev).toContain("Orthanc group 'devops': 2 commands")
  expect(dev.split('\n')[0]).toContain('0.8.0-dev')
  h.env.delete('ORTHANC_BIN')
  const system = await help($)
  expect(system.includes('devops')).toBe(false)
  expect(system).toContain('ontology (2)')
})

test('R8: calls that arrive during a reload share one agent-manifest and all see the new list', async ($, on) => {
  const { h, clock } = harness(on)
  await help($, { query: 'ontology' })
  install(h, SYSTEM, NEW)
  h.manifestMs = 2000
  const calls = [help($), help($), help($, { group: 'automate' }), help($, { query: 'workshop' }), cli($, 'automate status')]
  await clock.advance(2500)
  await clock.settle()
  const [one, two, group, query, ran] = await Promise.all(calls)
  expect(manifestRuns(h)).toEqual([`${SYSTEM} agent-manifest`, `${SYSTEM} agent-manifest`])
  expect(one).toContain('automate (2)')
  expect(two).toContain('automate (2)')
  expect(group).toContain("Orthanc group 'automate': 2 commands")
  expect(query).toContain('workshop list')
  expect((ran as Awaited<ReturnType<typeof cli>>).errors).toEqual([])
  const notices = ([one, two, group, query] as string[]).filter(text => text.includes('0.6.0'))
  expect(notices.length).toBe(1)
})

test('R9: --help text is read from the new binary after a reload', async ($, on) => {
  const { h } = harness(on)
  expect(await help($, { command: 'ontology list' })).toContain('from orthanc 0.6.0')
  install(h, SYSTEM, NEW)
  const after = await help($, { command: 'ontology list' })
  expect(after).toContain('from orthanc 0.7.1')
  expect(after.includes('from orthanc 0.6.0')).toBe(false)
})

test('R10: orthanc_cli runs a command only the new binary has, without a restart', async ($, on) => {
  const { h } = harness(on)
  await help($)
  expect((await cli($, 'automate status')).errors[0]?.type).toBe('unknown-command')
  install(h, SYSTEM, NEW)
  const out = await cli($, 'automate status')
  expect(out.errors).toEqual([])
  expect(out.data).toEqual({ ran: 'automate status', by: '0.7.1' })
})

test('R11: with no orthanc at first, a call after it is installed works', async ($, on) => {
  const { h } = harness(on)
  h.files.delete(SYSTEM)
  const none = await help($)
  expect(none.includes('ontology (2)')).toBe(false)
  install(h, SYSTEM, NEW)
  expect(await help($)).toContain('automate (2)')
})

test('R12: a read overtaken by a later one gives its caller the newer list', async ($, on) => {
  const { h, clock } = harness(on)
  await help($)
  install(h, SYSTEM, { version: '0.7.0', groups: ['configure', 'ontology', 'seven'], delayMs: 5000 }, 200)
  const slow = help($)
  await clock.advance(10)
  install(h, SYSTEM, { version: '0.8.0', groups: ['configure', 'eight', 'ontology'] }, 300)
  const fast = await help($, { group: 'eight' })
  expect(fast).toContain("Orthanc group 'eight': 2 commands")
  await clock.advance(5000)
  await clock.settle()
  const late = await slow
  expect(late).toContain('eight (2)')
  expect(late.includes('seven')).toBe(false)
  // The overtaken read did not replace the newer list either.
  expect(await help($, { query: 'seven' })).toContain('No Orthanc commands matched')
})

test('R13: a command whose kind changes between versions is judged by the new kind', async ($, on) => {
  const { h } = harness(on)
  h.store.set('approvalMode', 'ask-always')
  h.binaries.set(SYSTEM, { version: '0.6.0', groups: ['ontology'], extra: [{ path: 'thing run', kind: 'read-only' }] })
  expect((await cli($, 'thing run')).errors).toEqual([])
  expect(h.asks).toEqual([])
  install(h, SYSTEM, { version: '0.7.1', groups: ['ontology'], extra: [{ path: 'thing run', kind: 'mutation' }] })
  const out = await cli($, 'thing run')
  expect(out.errors).toEqual([])
  expect(out.data).toEqual({ ran: 'thing run', by: '0.7.1' })
  expect(h.asks.length).toBe(1)
  expect(h.asks[0]).toContain('thing run')
})

test('R14: a binary replaced while the operator approves is not run', async ($, on) => {
  const { h } = harness(on)
  h.store.set('approvalMode', 'ask-always')
  h.binaries.set(SYSTEM, { version: '0.6.0', groups: ['ontology'], extra: [{ path: 'thing apply', kind: 'mutation' }] })
  await help($)
  h.onAsk = () => install(h, SYSTEM, { version: '0.7.1', groups: ['ontology'], extra: [{ path: 'thing apply', kind: 'mutation' }] })
  const out = await cli($, 'thing apply')
  expect(out.errors[0]?.type).toBe('orthanc-binary-changed')
  expect(String(out.errors[0]?.message)).toContain('changed after this call was checked')
  expect(h.runs.filter(run => run.endsWith('thing apply'))).toEqual([])
  // Called again, it is judged by the new binary's list and runs there.
  h.onAsk = undefined
  const again = await cli($, 'thing apply')
  expect(again.data).toEqual({ ran: 'thing apply', by: '0.7.1' })
})

test('R15: with an unreadable new manifest or a deleted binary, orthanc_cli runs nothing', async ($, on) => {
  const { h, clock } = harness(on)
  h.binaries.set(SYSTEM, { version: '0.6.0', groups: ['ontology'], extra: [{ path: 'thing run', kind: 'read-only' }] })
  await help($)
  // The new binary marks it a mutation, but its manifest cannot be read.
  install(h, SYSTEM, { version: '0.7.1', groups: ['ontology'], extra: [{ path: 'thing run', kind: 'mutation' }], manifest: 'garbage' })
  const broken = await cli($, 'thing run')
  expect(broken.errors[0]?.type).toBe('orthanc-binary-changed')
  expect(String(broken.errors[0]?.message)).toContain('could not be read')
  await clock.advance(30_000)
  expect((await cli($, 'ontology list')).errors[0]?.type).toBe('orthanc-binary-changed')
  expect(h.runs.filter(run => run.endsWith('thing run') || run.endsWith('ontology list'))).toEqual([])
  // Deleted: refused, and nothing starts.
  h.files.delete(SYSTEM)
  const before = h.argv0s.length
  const gone = await cli($, 'thing run')
  expect(gone.errors[0]?.type).toBe('orthanc-binary-changed')
  expect(String(gone.errors[0]?.message)).toContain('not found')
  expect(h.argv0s.length).toBe(before)
})

test('R16: every process starts the file the stat found', async ($, on) => {
  const { h } = harness(on)
  await help($, { command: 'ontology list' })
  await cli($, 'ontology list')
  expect(h.argv0s.length > 2).toBe(true)
  expect([...new Set(h.argv0s)]).toEqual([SYSTEM])
  h.files.set(DEV, { size: 4242, mtimeMs: 500 })
  h.binaries.set(DEV, { version: '0.8.0-dev', groups: ['ontology'] })
  h.env.set('ORTHANC_BIN', DEV)
  h.argv0s.length = 0
  await cli($, 'ontology list')
  expect([...new Set(h.argv0s)]).toEqual([DEV])
})

test('R17: a failed read is tried again 60 s after it failed, not after it started', async ($, on) => {
  const { h, clock } = harness(on)
  await help($)
  install(h, SYSTEM, { version: '0.7.1', groups: ['automate'], manifest: 'garbage', delayMs: 30_000 })
  const failing = help($, { query: 'ontology' })
  await clock.advance(30_000)
  await clock.settle()
  expect(await failing).toContain('could not be read')
  expect(manifestRuns(h).length).toBe(2)
  await clock.advance(45_000)
  await help($)
  expect(manifestRuns(h).length).toBe(2)
  await clock.advance(20_000)
  void help($, { group: 'ontology' })
  await clock.settle()
  expect(manifestRuns(h).length).toBe(3)
})

test('R18: with no binary and no manifest, later calls start nothing and orthanc_cli reads nothing', async ($, on) => {
  const { h } = harness(on)
  h.files.delete(SYSTEM)
  await help($)
  const tried = h.argv0s.length
  await help($, { query: 'ontology' })
  const out = (await $.tool.call({ tool: CLI, command: 'ontology list', args: [] } as never)) as Reply
  expect(String(out.result ?? '') + String(out.deny ?? '')).not.toContain('"ran"')
  expect(h.argv0s.length).toBe(tried)
})

test('R19: a binary that does not report its version gets a plain notice', async ($, on) => {
  const { h } = harness(on)
  await help($)
  install(h, SYSTEM, { version: null, groups: ['automate', 'ontology'] })
  const notice = (await help($)).split('\n')[0]!
  expect(notice).toContain('from orthanc 0.6.0 to an orthanc that did not report its version')
  expect(notice.includes('of unknown version')).toBe(false)
})
