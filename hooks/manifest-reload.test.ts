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
type Binary = { version: string; groups: string[]; manifest?: 'ok' | 'garbage' | 'empty' | 'error' }
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
  return binary.groups.flatMap(group => [
    { path: `${group} list`, kind: 'read-only', args: [] },
    { path: `${group} status`, kind: 'read-only', args: [] },
  ])
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
  }
  on('process.run', async (_$, e) => {
    const real = launched(h, e.argv[0] ?? '')
    if (real === undefined) return { deny: `cannot start ${e.argv[0]}: spawn ${e.argv[0]} ENOENT` }
    const binary = h.binaries.get(real)!
    const words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words.splice(0, 2)
    const line = words.join(' ')
    h.runs.push(`${real} ${line}`)
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (line === 'agent-manifest') {
      if (h.manifestMs > 0) await clock.sleep(h.manifestMs)
      const how = binary.manifest ?? 'ok'
      if (how === 'garbage') return reply('Segmentation fault')
      if (how === 'empty') return reply(envelope({ commands: [] }))
      if (how === 'error') return reply(envelope(null, [{ type: 'internal', message: 'manifest broke' }]))
      return reply(envelope({ commands: commandsOf(binary) }))
    }
    if (line === 'version') return reply(envelope({ version: binary.version }))
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
  const store = new Map<string, unknown>([['approvalMode', 'yolo']])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
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
  on('tool.call', () => ({ result: 'ran' }) as never)
  return { h, clock }
}

/** Installs another release at `path`, the way install.sh does: new contents, new mtime. */
function install(h: Harness, path: string, binary: Binary, at = 200) {
  h.files.set(path, { size: 1000 + binary.version.length * 7 + binary.groups.length, mtimeMs: at })
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
  // Once: the next call does not repeat it.
  const again = await help($)
  expect(again.includes('0.6.0')).toBe(false)
  expect(again).toContain('automate (2)')
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
  // orthanc_cli: the guard and the executor share one check.
  h.stats.length = 0
  const out = await cli($, 'ontology list')
  expect(out.errors).toEqual([])
  expect(h.stats.filter(path => path === SYSTEM).length).toBe(1)
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
  await help($)
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
    const warned = await help($)
    expect(warned).toContain('ontology (2)')
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
  const dev = await help($)
  expect(dev).toContain('devops (2)')
  expect(dev.split('\n')[0]).toContain('0.8.0-dev')
  h.env.delete('ORTHANC_BIN')
  const system = await help($)
  expect(system.includes('devops')).toBe(false)
  expect(system).toContain('ontology (2)')
})

test('R8: calls that arrive during a reload share one agent-manifest and all see the new list', async ($, on) => {
  const { h, clock } = harness(on)
  await help($)
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
  const notices = [one, two, group, query].filter(text => text.includes('0.6.0'))
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
