// orthanc_cli's process timer for commands whose wait the manifest cannot
// fully say, the hard cap, and calls stopped before their timer (orthanc-jjtk).
//
// The client reports behind this file:
//  - market-360, 2026-11-05: `ai-fde run … --apply` came back "still running
//    after 300000ms" (timeout_seconds 300).
//  - order-to-cash, 2026-11-06: `repository checks wait --timeout 1200
//    --interval 30` came back "$.process.spawn aborted" with timeout_seconds
//    1470, about 1170 s in: the plugin's timer was right, something else
//    stopped the call, and the envelope read as a timeout.
//
// Ways this can fail, written before the code:
//  W1  `ai-fde run --apply` without --timeout dies at the 300 s floor: its
//      manifest flag has no default, though orthanc waits 1800 s by default.
//  W2  `ai-fde run --apply --timeout N` dies before orthanc's own deadline:
//      the timer misses the worker's 300 s startup budget, orthanc's deadline
//      margin (up to 60 s) and its 10 s exit grace.
//  W3  A command whose --timeout is above the floor is still stopped at the
//      floor when the tool really runs it (the timer is computed but not the
//      one the process gets).
//  W4  `ai-fde run --detach` (returns once the thread exists) or a plan (no
//      --apply) holds a long timer it never needs.
//  W5  A wait past the cap starts and is then killed at the cap: no envelope
//      from orthanc, and for `ai-fde run` a web run nobody reads. It must be
//      refused before orthanc starts, naming the cap and the way out
//      (a smaller --timeout; --detach with `ai-fde status` / `ai-fde result`).
//  W6  The refusal names a --timeout that still does not fit, or none.
//  W7  The cap moves past the longest default wait plus the margin, or a
//      request slips past it (=, spelling, repeats).
//  W8  A call stopped before its timer (interrupted turn, plugin reload) reads
//      as orthanc_cli's timeout. It must say it was cancelled, how long it ran
//      and what the timer was.
//  W9  A call stopped by its timer does not say so, or gives no next step.
//  W10 A stopped `ai-fde run` loses the uncertain-mutation flag.
//  W11 A manifest that one day carries ai-fde run's --timeout default counts
//      the wait twice.
//  W12 A launch failure (no orthanc binary) reads as cancelled or timed out.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { CLI_TIMEOUT_CAP_MS, CLI_TIMEOUT_FLOOR_MS, cliTimeoutMs, cliWait } from './orthanc'
import type { ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const seconds = (ms: number) => ms / 1000

const AI_FDE_RUN: ManifestCommand = {
  path: 'ai-fde run',
  kind: 'mutation',
  flags: [
    { flag: '--thread', takesValue: true },
    { flag: '--approve-all', takesValue: false },
    { flag: '--detach', takesValue: false },
    { flag: '--worker', takesValue: true },
    { flag: '--timeout', takesValue: true },
    { flag: '--apply', takesValue: false },
  ],
}
const CHECKS_WAIT: ManifestCommand = {
  path: 'repository checks wait',
  kind: 'read-only',
  flags: [
    { flag: '--timeout', takesValue: true, default: '600' },
    { flag: '--interval', takesValue: true, default: '10' },
    { flag: '--publish-grace', takesValue: true, default: '120' },
  ],
}
const IMPORT_RUN: ManifestCommand = {
  path: 'connectivity import run',
  kind: 'mutation',
  flags: [
    { flag: '--wait', takesValue: false },
    { flag: '--timeout', takesValue: true, default: '600' },
    { flag: '--apply', takesValue: false },
  ],
}

// orthanc's ai-fde run deadline: startup 300 + timeout + margin (timeout / 10, 5 to 60) + exit grace 10.
const AI_FDE_OVERHEAD_S = 300 + 60 + 10
const MARGIN_S = 120

test('W1: ai-fde run --apply without --timeout gets orthanc\'s 1800 s default and its overhead', async () => {
  expect(seconds(cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply']))).toBe(1800 + AI_FDE_OVERHEAD_S + MARGIN_S)
})

test('W2: ai-fde run --timeout N gets N plus startup, deadline margin, exit grace and the margin', async () => {
  expect(seconds(cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply', '--timeout', '1200']))).toBe(1200 + AI_FDE_OVERHEAD_S + MARGIN_S)
  expect(seconds(cliTimeoutMs(AI_FDE_RUN, ['do it', '--timeout=900', '--apply']))).toBe(900 + AI_FDE_OVERHEAD_S + MARGIN_S)
  // A short run still gets the startup budget: 30 + 370 + 120 = 520 s, over the floor.
  expect(seconds(cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply', '--timeout', '30']))).toBe(520)
})

test('W4: --detach and a plan without --apply keep the 300 s floor', async () => {
  expect(cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply', '--detach'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply', '--detach', '--timeout', '1800'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(AI_FDE_RUN, ['do it'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(AI_FDE_RUN, ['do it', '--timeout', '1800'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(IMPORT_RUN, ['ri.c', '--wait'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(seconds(cliTimeoutMs(IMPORT_RUN, ['ri.c', '--wait', '--apply']))).toBe(600 + MARGIN_S)
})

test('W7: the cap is the longest default wait (ai-fde run) plus the margin, and holds for every spelling', async () => {
  expect(seconds(CLI_TIMEOUT_CAP_MS)).toBe(1800 + AI_FDE_OVERHEAD_S + MARGIN_S)
  expect(cliWait(AI_FDE_RUN, ['do it', '--apply']).overCap).toBe(false)
  for (const args of [
    ['do it', '--apply', '--timeout', '1801'],
    ['do it', '--apply', '--timeout=3600'],
    ['do it', '--apply', '--timeout', '60', '--timeout', '99999'],
    ['do it', '--apply', '--timeout', '1e9'],
  ]) {
    const wait = cliWait(AI_FDE_RUN, args)
    expect({ args, overCap: wait.overCap, ms: wait.timeoutMs }).toEqual({ args, overCap: true, ms: CLI_TIMEOUT_CAP_MS })
  }
  expect(cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '1200', '--interval', '30']).overCap).toBe(false)
  expect(cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '5000']).overCap).toBe(true)
})

test('W6: the over-cap answer names the largest --timeout that fits', async () => {
  // cap 2290 - (370 overhead + 120 margin) = 1800.
  expect(cliWait(AI_FDE_RUN, ['do it', '--apply', '--timeout', '3600']).maxTimeoutS).toBe(1800)
  // cap 2290 - (120 grace + 30 interval + 120 margin) = 2020.
  expect(cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '5000', '--interval', '30']).maxTimeoutS).toBe(2020)
})

test('W11: a manifest default for ai-fde run --timeout is used once, not added to the fallback', async () => {
  const declared: ManifestCommand = {
    ...AI_FDE_RUN,
    flags: (AI_FDE_RUN.flags ?? []).map(flag => (flag.flag === '--timeout' ? { ...flag, default: '600' } : flag)),
  }
  expect(seconds(cliTimeoutMs(declared, ['do it', '--apply']))).toBe(600 + AI_FDE_OVERHEAD_S + MARGIN_S)
})

// ---------- through the tool: the plugin loaded, orthanc faked, the clock mocked ----------

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const manifestArgs = (command: ManifestCommand) =>
  (command.flags ?? []).map(flag => ({ kind: 'option', flag: flag.flag, takes_value: flag.takesValue, ...(flag.default ? { default: flag.default } : {}) }))
const MANIFEST = envelope({
  commands: [
    { path: 'configure list', kind: 'local', args: [] },
    { path: 'ontology list', kind: 'read-only', args: [] },
    ...[AI_FDE_RUN, CHECKS_WAIT].map(command => ({ path: command.path, kind: command.kind, args: manifestArgs(command) })),
  ],
})

type Child = 'finish' | 'hang' | { abortAfterMs: number }
type Harness = {
  /** The timeoutMs of every $.process.run of a Foundry command. */
  runs: { line: string; timeoutMs: number }[]
  /** Every Foundry command streamed through $.process.spawn. */
  spawns: string[]
  /** Spawned children that were stopped (the stream's return). */
  stopped: string[]
  /** How a spawned or run Foundry command behaves. */
  child: Child
  /** A missing orthanc binary. */
  missing: boolean
}

const lineOf = (argv: readonly string[]) => {
  let words = argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
  if (words[0] === '--profile') words = words.slice(2)
  return words.join(' ')
}

function harness(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const h: Harness = { runs: [], spawns: [], stopped: [], child: 'finish', missing: false }
  const done = (line: string) => envelope({ ran: line })
  on('process.run', async (_$, e) => {
    const line = lineOf(e.argv)
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (line === 'agent-manifest') return reply(MANIFEST)
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
    if (line === 'ontology list') return reply(envelope({ data: [] }))
    if (e.argv.includes('--help')) return reply('usage')
    h.runs.push({ line, timeoutMs: e.init?.timeoutMs ?? 30_000 })
    // A refusal stands in for the host's rejection, with the host's wording.
    if (h.missing) return { deny: 'cannot start orthanc: spawn orthanc ENOENT' }
    if (h.child === 'finish') return reply(done(line))
    if (h.child === 'hang') {
      await clock.sleep(e.init?.timeoutMs ?? 30_000)
      return { deny: `aborted: still running after ${e.init?.timeoutMs}ms` }
    }
    await clock.sleep(h.child.abortAfterMs)
    return { deny: 'aborted' }
  })
  on('process.spawn', async function* (_$, e, next) {
    const line = lineOf(e.argv)
    h.spawns.push(line)
    // The caller leaving the stream aborts the dispatch: the child is killed.
    next.signal.addEventListener('abort', () => void h.stopped.push(line))
    if (h.child === 'finish') {
      yield { stream: 'stdout' as const, text: done(line) }
      return { value: { code: 0, signal: null } }
    }
    if (h.child === 'hang') {
      await clock.sleep(10 * CLI_TIMEOUT_CAP_MS)
      return { value: { code: 0, signal: null } }
    }
    await clock.sleep(h.child.abortAfterMs)
    return { deny: '$.process.spawn aborted' }
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: undefined }
  })
  const store = new Map<string, unknown>([['approvalMode', 'yolo']])
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } as never }))
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

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
type Reply = { deny?: string; result?: unknown }
const call = ($: Engine, command: string, args: string[]) => $.tool.call({ tool: CLI, command, args } as never) as Promise<Reply>
const parsed = (reply: Reply) => JSON.parse(String(reply.result)) as { data: unknown; errors: Record<string, unknown>[]; [key: string]: unknown }

/** Starts a call, moves the clock `ms` on, and says whether it has answered. */
async function after(clock: ReturnType<typeof mock.clock>, running: Promise<Reply>, ms: number) {
  let answered = false
  void running.then(() => void (answered = true), () => void (answered = true))
  await clock.advance(ms)
  await clock.settle()
  return answered
}

test('W3: through the tool, ai-fde run --timeout 1200 is not stopped at the 300 s floor', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = 'hang'
  const running = call($, 'ai-fde run', ['do it', '--apply', '--timeout', '1200'])
  expect(await after(clock, running, 301_000)).toBe(false)
  expect(await after(clock, running, 1_200_000)).toBe(false)
  expect({ spawns: h.spawns, runs: h.runs }).toEqual({ spawns: ['ai-fde run do it --apply --timeout 1200'], runs: [] })
  expect(h.stopped).toEqual([])
  // 1200 + 370 + 120 = 1690 s: stopped there and not before.
  expect(await after(clock, running, (1690 - 1501) * 1000 - 1000)).toBe(false)
  expect(await after(clock, running, 2000)).toBe(true)
  const out = parsed(await running)
  expect(out.errors[0]!.reason).toBe('timeout')
  expect(out.errors[0]!.timeout_seconds).toBe(1690)
  expect(h.stopped).toEqual(['ai-fde run do it --apply --timeout 1200'])
})

test('W1 W3: through the tool, a flagless ai-fde run --apply runs past 300 s and past ten minutes', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = 'hang'
  const running = call($, 'ai-fde run', ['do it', '--apply'])
  expect(await after(clock, running, 1_800_000)).toBe(false)
  expect(await after(clock, running, (2290 - 1800) * 1000)).toBe(true)
  expect(parsed(await running).errors[0]!.timeout_seconds).toBe(2290)
})

test('W3: through the tool, checks wait --timeout 1200 --interval 30 gets 1470 s and finishes', async ($, on) => {
  const { h, clock } = harness(on)
  const out = parsed(await call($, 'repository checks wait', ['ri.r', 'v1', '--timeout', '1200', '--interval', '30']))
  expect(out.errors).toEqual([])
  expect(h.spawns).toEqual(['repository checks wait ri.r v1 --timeout 1200 --interval 30'])
  h.child = 'hang'
  const running = call($, 'repository checks wait', ['ri.r', 'v1', '--timeout', '1200', '--interval', '30'])
  expect(await after(clock, running, 1_469_000)).toBe(false)
  expect(await after(clock, running, 2000)).toBe(true)
  expect(parsed(await running).errors[0]!.timeout_seconds).toBe(1470)
})

test('W4: through the tool, --detach keeps the floor and runs under $.process.run', async ($, on) => {
  const { h } = harness(on)
  const out = parsed(await call($, 'ai-fde run', ['do it', '--apply', '--detach']))
  expect(out.errors).toEqual([])
  expect(h.spawns).toEqual([])
  expect(h.runs).toEqual([{ line: 'ai-fde run do it --apply --detach', timeoutMs: CLI_TIMEOUT_FLOOR_MS }])
})

test('W5 W6: through the tool, a wait past the cap is refused before orthanc starts', async ($, on) => {
  const { h } = harness(on)
  const out = parsed(await call($, 'ai-fde run', ['do it', '--apply', '--timeout', '3600']))
  expect(h.spawns).toEqual([])
  expect(h.runs).toEqual([])
  const error = out.errors[0]!
  expect(error.type).toBe('timeout-over-cap')
  expect(error.cap_seconds).toBe(2290)
  expect(error.max_timeout_seconds).toBe(1800)
  expect(String(error.message)).toContain('--timeout 1800')
  expect(String(error.message)).toContain('--detach')
  expect(String(error.message)).toContain('ai-fde status')
  const read = parsed(await call($, 'repository checks wait', ['ri.r', 'v1', '--timeout', '5000']))
  expect(read.errors[0]!.type).toBe('timeout-over-cap')
  expect(String(read.errors[0]!.message)).toContain('--timeout 2040')
  expect(String(read.errors[0]!.message)).toContain('call it again')
  expect(h.spawns).toEqual([])
})

test('W8: through the tool, a call stopped before its timer says it was cancelled, not timed out', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = { abortAfterMs: 1_170_000 }
  const running = call($, 'repository checks wait', ['ri.r', 'v1', '--timeout', '1200', '--interval', '30'])
  expect(await after(clock, running, 1_170_000)).toBe(true)
  const error = parsed(await running).errors[0]!
  expect(error.reason).toBe('cancelled')
  expect(error.elapsed_seconds).toBe(1170)
  expect(error.timeout_seconds).toBe(1470)
  expect(String(error.message)).toContain('before its 1470 s limit')
  expect(String(error.hint)).toContain('call it again')
})

test('W8: a short call cancelled under $.process.run says the same', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = { abortAfterMs: 42_000 }
  const running = call($, 'repository checks wait', ['ri.r', 'v1', '--timeout', '60'])
  expect(await after(clock, running, 42_000)).toBe(true)
  const error = parsed(await running).errors[0]!
  expect(error.reason).toBe('cancelled')
  expect(error.elapsed_seconds).toBe(42)
})

test('W9 W10: a stopped ai-fde run says how to find the run, and stays an uncertain mutation', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = 'hang'
  const running = call($, 'ai-fde run', ['do it', '--apply', '--timeout', '60'])
  // 60 + 370 + 120 = 550 s: under ten minutes, so $.process.run carries the timer.
  expect(await after(clock, running, 550_000)).toBe(true)
  expect(h.runs).toEqual([{ line: 'ai-fde run do it --apply --timeout 60', timeoutMs: 550_000 }])
  const out = parsed(await running)
  expect(out.errors[0]!.reason).toBe('timeout')
  expect(String(out.errors[0]!.hint)).toContain('ai-fde threads list')
  expect(String(out.errors[0]!.hint)).toContain('--detach')
  expect(out.uncertain_mutation).toBe(true)
})

test('W12: a launch failure is neither cancelled nor timed out', async ($, on) => {
  const { h } = harness(on)
  h.missing = true
  const error = parsed(await call($, 'repository checks wait', ['ri.r', 'v1', '--timeout', '60'])).errors[0]!
  expect(error.type).toBe('orthanc-launch-error')
  expect(error.reason).toBe(undefined)
  expect(error.hint).toBe(undefined)
})
