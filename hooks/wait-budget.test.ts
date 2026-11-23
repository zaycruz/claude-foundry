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
//
// From the Opus review of bf6b644 (claude-foundry #8), written before the fixes:
//  W13 A stop by orthanc_cli's timer reads as cancelled when the host words
//      its error differently (the label rests on the host's text); a cancel
//      names a cause nobody confirmed.
//  W14 A call over the cap goes up the approval ladder first: the operator
//      approves a call that is then refused.
//  W15 A refusal that never reached orthanc (over the cap, a credential
//      command, an unknown command) counts as maybe-run, so FDE mode drops
//      the dry run the apply was taken from.
//  W16 An over-cap call caused by --publish-grace or --interval is told to
//      pass a smaller --timeout.
//  W17 --detach=false or --apply=false counts as passed; a bad --timeout
//      value on a waiting call drops it to the 300 s floor instead of the
//      default wait.
//  W18 orthanc raises a command's default wait past the cap and every call
//      with that default is refused.
//
// The same wait typed into Bash (claude-foundry #19), written before the fix:
//  B1 orthanc_cli's timer covers the call it makes, and nothing else: the same
//      `checks wait --timeout N` run through Bash dies at the Bash tool's own
//      timer, which moves the command to the background so the turn never gets
//      its answer. A waiting call in Bash gets the time its own flags ask for.
//  B2 The cover reads the shell's real limits, not a guess: the call's
//      `timeout`, then BASH_DEFAULT_TIMEOUT_MS, then 120 s, and the largest one
//      the host takes, BASH_MAX_TIMEOUT_MS or 600 s, the default never above
//      it. A call already given enough time is left alone; a timeout bigger
//      than the host takes counts as what the host takes.
//  B3 A wait no Bash timeout holds is refused before the command starts, and
//      says what it costs, what Bash allows, and the ways that do fit.
//  B4 A command that waits for nothing keeps the timeout the model gave:
//      --no-wait, --detach, a plan with no --apply, a plain read, and a line
//      that only names orthanc.
//  B5 The wait comes from the same flags as orthanc_cli's timer: manifest
//      defaults, --publish-grace, --interval, the last of a repeated --timeout,
//      and a value orthanc would reject counted as the default.
//  B6 A line with several Orthanc calls runs them one after another, so the
//      timer is their sum: raised only to the longest, the later waits would
//      pass it and lose the answer this cover exists to deliver. A line the
//      guard already refuses (a write, an unreadable call) is answered before
//      any timeout is raised, so nothing gets time for a call that does not run.
//  B10 A counted loop (`for x in a b c`) runs its wait once per word, so its
//      wait is multiplied, Orthanc's own time around the wait and the margin
//      included; a list built from a substitution or a glob, and a while/until
//      body, cannot be counted and is counted once — the residual limit, said
//      here, since the host's own timer still stops it. A loop short enough to
//      finish inside the ceiling may still be refused by this arithmetic: it is
//      the safe side, because the refusal names how to get the result.
//  B7 run_in_background has no foreground limit to cover: the call is untouched.
//  B8 The raised timeout reaches the tool: the event handed to next carries it
//      (the host reads the call's `timeout`), and a refusal leaves it alone.
//  B9 A wait past even orthanc_cli's cap is refused in Bash too, and says the
//      flag that is too big there; a wait that fits orthanc_cli is also given
//      the --timeout that would fit Bash.
//  B11 Only what genuinely cannot both happen is priced as the larger of two:
//      the legs of a pipeline run together, and a `case` chooses between its arms.
//      `a || b` and `if wait A; then …; else wait B; fi` add up - a wait that
//      times out exits 1, so the retry after `||` runs - and a job left running
//      by `&` has no foreground wait at all (B12).
//  B13 A wait the guard cannot price — arguments inside a substitution, a
//      --timeout holding a variable — raises nothing and refuses nothing: it is
//      the caller's own number, not one to invent a default for.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { CLI_TIMEOUT_CAP_MS, CLI_TIMEOUT_FLOOR_MS, cliTimeoutMs, cliWait, failure, notRunFailure } from './orthanc'
import type { ManifestCommand } from './policy'
import { shellOrthancCalls } from './policy'
import { BASH_TIMEOUT_DEFAULT_MS, BASH_TIMEOUT_MAX_MS, coverShellWaits, shellTimer, shellWaitDenial } from './process'

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

test('W15: a refusal that never reached orthanc counts as not run; a launch error or a Foundry error does not', async () => {
  for (const type of ['timeout-over-cap', 'credential-command-denied', 'unknown-command']) {
    expect({ type, notRun: notRunFailure(failure(type, 'refused', 'x')) }).toEqual({ type, notRun: true })
  }
  expect(notRunFailure(failure('usage', "error: unexpected argument '--nope' found", 'x'))).toBe(true)
  expect(notRunFailure(failure('orthanc-launch-error', 'still running after 600 s; stopped', 'x'))).toBe(false)
  expect(notRunFailure(failure('foundry-api-error', 'HTTP 409 conflict', 'x'))).toBe(false)
})

test('W16: an over-cap call caused by another flag names that flag, not --timeout', async () => {
  // 60 + 3000 grace + 10 interval + 120 margin: no --timeout fits.
  const grace = cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '60', '--publish-grace', '3000'])
  expect({ overCap: grace.overCap, max: grace.maxTimeoutS, flags: grace.overFlags }).toEqual({ overCap: true, max: undefined, flags: ['--publish-grace'] })
  const interval = cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '60', '--interval', '3000'])
  expect({ overCap: interval.overCap, max: interval.maxTimeoutS, flags: interval.overFlags }).toEqual({ overCap: true, max: undefined, flags: ['--interval'] })
  // --timeout is what is too big: it alone is named.
  expect(cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '5000']).overFlags).toEqual(['--timeout'])
})

test('W17: a switch spelled =false is not passed; a bad --timeout value counts as the default wait', async () => {
  expect(seconds(cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply', '--detach=false']))).toBe(1800 + AI_FDE_OVERHEAD_S + MARGIN_S)
  expect(cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply=false', '--timeout', '1200'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(seconds(cliTimeoutMs(IMPORT_RUN, ['ri.c', '--wait=true', '--apply']))).toBe(600 + MARGIN_S)
  expect(cliTimeoutMs(IMPORT_RUN, ['ri.c', '--wait=0', '--apply'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  for (const value of ['abc', '-5', '', 'NaN', 'Infinity']) {
    const ms = cliTimeoutMs(AI_FDE_RUN, ['do it', '--apply', '--timeout', value])
    expect({ value, s: seconds(ms) }).toEqual({ value, s: 1800 + AI_FDE_OVERHEAD_S + MARGIN_S })
  }
})

test('W18: a manifest default above the fallback raises the cap for that command, and no other', async () => {
  const declared: ManifestCommand = {
    ...AI_FDE_RUN,
    flags: (AI_FDE_RUN.flags ?? []).map(flag => (flag.flag === '--timeout' ? { ...flag, default: '3600' } : flag)),
  }
  const byDefault = cliWait(declared, ['do it', '--apply'])
  expect({ overCap: byDefault.overCap, s: seconds(byDefault.timeoutMs) }).toEqual({ overCap: false, s: 3600 + AI_FDE_OVERHEAD_S + MARGIN_S })
  const over = cliWait(declared, ['do it', '--apply', '--timeout', '5000'])
  expect({ overCap: over.overCap, cap: seconds(over.capMs), max: over.maxTimeoutS }).toEqual({ overCap: true, cap: 4090, max: 3600 })
  // Other commands keep the 2290 s cap.
  expect(seconds(cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '5000']).capMs)).toBe(2290)
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

type Child = 'finish' | 'hang' | 'hang-reworded' | { abortAfterMs: number }
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
  /** Every approval question put to the operator. */
  asks: string[]
  /** The approval mode the plugin reads. */
  mode: string
  /** Every Bash call that reached the tool, with the timeout it was handed. */
  bash: { command: string; timeoutMs?: number }[]
  /** The session's environment, for the shell's own timeout variables. */
  env: Map<string, string>
}

const lineOf = (argv: readonly string[]) => {
  let words = argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
  if (words[0] === '--profile') words = words.slice(2)
  return words.join(' ')
}

function harness(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  const h: Harness = { runs: [], spawns: [], stopped: [], child: 'finish', missing: false, asks: [], mode: 'yolo', bash: [], env }
  const done = (line: string) => envelope({ ran: line })
  on('process.run', async (_$, e) => {
    const line = lineOf(e.argv)
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (line === 'agent-manifest') return reply(MANIFEST)
    if (line === 'version') return reply(envelope({ version: '0.0.0-test' }))
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
    if (h.child === 'hang-reworded') {
      // The host's timer, worded some other way one day.
      await clock.sleep(e.init?.timeoutMs ?? 30_000)
      return { deny: 'process exceeded its deadline and was aborted' }
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
    if (h.child === 'hang' || h.child === 'hang-reworded') {
      await clock.sleep(10 * CLI_TIMEOUT_CAP_MS)
      return { value: { code: 0, signal: null } }
    }
    await clock.sleep(h.child.abortAfterMs)
    return { deny: '$.process.spawn aborted' }
  })
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: {} }
  })
  const store = new Map<string, unknown>()
  on('store.get', (_$, e) => ({ value: e.key === 'approvalMode' ? h.mode : store.get(e.key) }))
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
  // $.ui.ask reaches the operator as an AskUserQuestion call (as in tag.test.ts).
  on('tool.call', (_$, e) => {
    const asked = e as unknown as { tool: string; command?: string; timeout?: number; questions?: { question: string }[] }
    if (asked.tool === 'Bash') h.bash.push({ command: asked.command ?? '', timeoutMs: asked.timeout })
    if (asked.tool !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = asked.questions?.[0]?.question ?? ''
    h.asks.push(question)
    return { result: { questions: asked.questions, answers: { [question]: 'Approve' } } } as never
  })
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
  // W13: no cause is named; nobody confirmed one.
  expect(String(error.message)).toContain("from outside orthanc_cli's timer")
  expect(String(error.message).includes('interrupted turn')).toBe(false)
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

test('W13: a stop at the timer reads as a timeout whatever the host calls it', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = 'hang-reworded'
  const running = call($, 'repository checks wait', ['ri.r', 'v1', '--timeout', '60'])
  // 60 + 120 grace + 10 interval + 120 margin = 310 s, under $.process.run.
  expect(await after(clock, running, 310_000)).toBe(true)
  const error = parsed(await running).errors[0]!
  expect({ reason: error.reason, elapsed: error.elapsed_seconds, timer: error.timeout_seconds }).toEqual({ reason: 'timeout', elapsed: 310, timer: 310 })
  expect(String(error.hint)).toContain('--timeout that fits')
})

test('W14: an over-cap call is refused before the approval ladder asks the operator', async ($, on) => {
  const { h } = harness(on)
  h.mode = 'ask-always'
  const out = parsed(await call($, 'ai-fde run', ['do it', '--apply', '--timeout', '3600']))
  expect(out.errors[0]!.type).toBe('timeout-over-cap')
  expect({ asks: h.asks, spawns: h.spawns, runs: h.runs }).toEqual({ asks: [], spawns: [], runs: [] })
  // The control: a call that fits is asked about once, then runs.
  parsed(await call($, 'ai-fde run', ['do it', '--apply', '--detach']))
  expect(h.asks.length).toBe(1)
  expect(h.runs.map(run => run.line)).toEqual(['ai-fde run do it --apply --detach'])
})

// ---------- the same wait typed into Bash ----------

// The manifest as the guard holds it, for the pure reads of a shell line.
const SHELL_MANIFEST: ManifestCommand[] = [CHECKS_WAIT, AI_FDE_RUN, IMPORT_RUN, { path: 'ontology list', kind: 'read-only' }]
const DEFAULT_SHELL = shellTimer(undefined, undefined, undefined)

/** The waits, in seconds, of the Orthanc calls a shell line runs. */
const shellWaits = (line: string) => shellOrthancCalls(line, SHELL_MANIFEST).map(entry => cliWait(entry.command, entry.args).waitMs / 1000)
/** The same, as the cover sees them: each call with how often the shell runs it. */
const shellCovers = (line: string) => shellOrthancCalls(line, SHELL_MANIFEST).map(entry => ({ wait: cliWait(entry.command, entry.args), times: entry.times, join: entry.join }))
/** What a shell line's Orthanc waits add up to, in seconds. */
const shellTotalS = (line: string) => coverShellWaits(shellCovers(line), DEFAULT_SHELL)

test('B1: a Bash call that waits gets the time its own flags ask for', async () => {
  const wait = cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '300'])
  // 300 + 120 grace + 10 interval + 120 margin, over the shell's 120 s default.
  expect({ waitS: wait.waitMs / 1000, timer: DEFAULT_SHELL }).toEqual({ waitS: 550, timer: { givenMs: 120_000, maxMs: 600_000 } })
  expect(coverShellWaits([{ wait, times: 1 }], DEFAULT_SHELL)).toEqual({
    kind: 'raise',
    timeoutMs: 550_000,
    total: { totalMs: 550_000, calls: 1, longest: wait, serial: true, onFailure: false },
    timer: DEFAULT_SHELL,
  })
  expect(shellWaits('orthanc repository checks wait ri.r v1 --timeout 300')).toEqual([550])
})

test('B2: the cover reads the shell\'s limits, and leaves a call that has enough time alone', async () => {
  expect(shellTimer(undefined, undefined, undefined)).toEqual({ givenMs: 120_000, maxMs: 600_000 })
  expect(shellTimer(300_000, undefined, undefined).givenMs).toBe(300_000)
  // BASH_DEFAULT_TIMEOUT_MS is the timer of a call that gives no timeout. It
  // never buys time past the ceiling: a promise the host may not keep is worse
  // than no promise, because the command goes to the background anyway.
  expect(shellTimer(undefined, '300000', undefined)).toEqual({ givenMs: 300_000, maxMs: 600_000 })
  expect(shellTimer(undefined, '900000', undefined)).toEqual({ givenMs: 600_000, maxMs: 600_000 })
  expect(shellTimer(undefined, '900000', '700000')).toEqual({ givenMs: 700_000, maxMs: 700_000 })
  // A timeout bigger than the host takes is what the host takes.
  expect(shellTimer(900_000, undefined, '420000')).toEqual({ givenMs: 420_000, maxMs: 420_000 })
  // Anything else in those variables leaves the host\'s defaults standing.
  for (const junk of ['abc', '', '-5', '0', 'NaN', 'Infinity']) {
    expect({ junk, timer: shellTimer(junk, junk, junk) }).toEqual({
      junk,
      timer: { givenMs: BASH_TIMEOUT_DEFAULT_MS, maxMs: BASH_TIMEOUT_MAX_MS },
    })
  }
  const wait = cliWait(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '300'])
  expect(coverShellWaits([{ wait, times: 1 }], shellTimer(600_000, undefined, undefined))).toEqual({ kind: 'keep' })
  // A session whose ceiling sits under the wait: nothing fits it.
  const timer = shellTimer(undefined, '30000', '60000')
  expect(coverShellWaits([{ wait, times: 1 }], timer)).toEqual({
    kind: 'over',
    total: { totalMs: 550_000, calls: 1, longest: wait, serial: true, onFailure: false },
    timer,
  })
})

test('B3: a wait no Bash timeout holds is refused, and says what fits', async () => {
  // 600 default + 120 grace + 10 interval + 120 margin, over the 600 s ceiling.
  const wait = cliWait(CHECKS_WAIT, ['ri.r', 'v1'])
  const cover = coverShellWaits([{ wait, times: 1 }], DEFAULT_SHELL)
  expect({ kind: cover.kind, waitS: cover.kind === 'over' ? cover.total.longest.waitMs / 1000 : 0 }).toEqual({ kind: 'over', waitS: 850 })
  if (cover.kind !== 'over') throw new Error('850 s does not fit the 600 s ceiling')
  const reason = shellWaitDenial(cover.total, DEFAULT_SHELL)
  expect(reason).toContain("Bash runs a command for at most 600 s, and 'orthanc repository checks wait' waits 850 s here, so the command was not run")
  expect(reason).toContain('orthanc_cli, which waits up to 2290 s for it')
  expect(reason).toContain('run_in_background: true')
  // The default wait fits orthanc_cli but not Bash: say the --timeout that does.
  expect(reason).toContain('pass --timeout 350 or less, which fits Bash')
})

test('B4: what waits for nothing keeps the timeout the model gave', async () => {
  for (const line of [
    'orthanc repository checks wait ri.r v1 --no-wait',
    'orthanc ai-fde run do it --apply --detach --timeout 1800',
    'orthanc connectivity import run ri.c --wait --timeout 900',
    'orthanc ontology list',
    "python3 scripts/e2e/run.py --bin target/debug/orthanc --only '^checks$'",
    'grep -rn "orthanc repository checks wait --timeout 1500" hooks/',
    'MSG="orthanc checks wait ran"; git commit -m "$MSG"',
  ]) {
    const waits = shellWaits(line)
    expect({ line, waits }).toEqual({ line, waits: waits.map(() => 0) })
    expect({ line, cover: shellTotalS(line) }).toEqual({ line, cover: { kind: 'keep' } })
  }
})

test('B5: the Bash wait reads the same flags as orthanc_cli\'s timer', async () => {
  expect(shellWaits('orthanc repository checks wait ri.r v1')).toEqual([850])
  expect(shellWaits('orthanc repository checks wait ri.r v1 --timeout 1200 --interval 30')).toEqual([1470])
  expect(shellWaits('orthanc repository checks wait ri.r v1 --timeout 60 --publish-grace 900')).toEqual([1090])
  // The last of a repeated --timeout is the one orthanc runs.
  expect(shellWaits('orthanc repository checks wait ri.r v1 --timeout 100 --timeout 200')).toEqual([450])
  // A value orthanc would reject counts as its default, so the timer is never short.
  expect(shellWaits('orthanc repository checks wait ri.r v1 --timeout abc')).toEqual([850])
  // The agent flags the tool supplies are not part of the wait.
  expect(shellWaits('orthanc --agent --non-interactive --profile tester repository checks wait ri.r v1 --timeout 300')).toEqual([550])
  // A launcher in front of the binary, and a redirect behind it, change nothing.
  expect(shellWaits('sudo orthanc repository checks wait ri.r v1 --timeout 300')).toEqual([550])
  expect(shellWaits('orthanc repository checks wait ri.r v1 --timeout 300 > out.log')).toEqual([550])
  expect(shellWaits('orthanc repository checks wait ri.r v1 --timeout 300 | jq .data.status')).toEqual([550])
})

test('B6: one command line runs its Orthanc waits one after another, so they add up', async () => {
  expect(shellWaits('orthanc ontology list && orthanc repository checks wait ri.r v1 --timeout 100 && orthanc repository checks wait ri.r v2 --timeout 300')).toEqual([0, 350, 550])
  // 50 + 120 + 10 + 120 and 20 + 120 + 10 + 120: 570 s in all, over the 120 s
  // default and under the 600 s ceiling, so the timeout is raised to the sum.
  const fits = 'orthanc repository checks wait ri.a v1 --timeout 20 && orthanc repository checks wait ri.b v1 --timeout 50'
  expect(shellWaits(fits)).toEqual([270, 300])
  expect(coverShellWaits(shellCovers(fits), DEFAULT_SHELL)).toEqual({
    kind: 'raise',
    timeoutMs: 570_000,
    total: { totalMs: 570_000, calls: 2, longest: cliWait(CHECKS_WAIT, ['ri.b', 'v1', '--timeout', '50']), serial: true, onFailure: false },
    timer: DEFAULT_SHELL,
  })
  // Two 450 s waits are 900 s of waiting, whatever each one costs alone: this is
  // the case a longest-only cover gave 450 s to, and the second wait lost.
  const two = 'orthanc repository checks wait ri.a v1 --timeout 200 && orthanc repository checks wait ri.b v1 --timeout 200'
  const over = shellTotalS(two)
  if (over.kind !== 'over') throw new Error('two 450 s waits are 900 s: no Bash timeout holds them')
  expect({ totalS: over.total.totalMs / 1000, calls: over.total.calls }).toEqual({ totalS: 900, calls: 2 })
  const reason = shellWaitDenial(over.total, DEFAULT_SHELL)
  expect(reason).toContain('2 Orthanc waits in this command add up to 900 s, the longest')
  expect(reason).toContain("run each wait in its own command with orthanc_cli, which waits up to 2290 s for 'orthanc repository checks wait'")
  expect(reason).toContain('run_in_background: true')
  // A `;` and a newline are the same sequence.
  expect(shellTotalS('orthanc repository checks wait ri.a --timeout 200; orthanc repository checks wait ri.b --timeout 200')).toEqual(over)
  expect(shellTotalS('orthanc repository checks wait ri.a --timeout 200\northanc repository checks wait ri.b --timeout 200')).toEqual(over)
})

test('B10: a counted loop pays its wait once per word', async () => {
  // Three passes of a 350 s wait: 1,050 s, refused rather than cut short.
  const loop = 'for r in ri.a ri.b ri.c; do orthanc repository checks wait $r v1 --timeout 100; done'
  const over = shellTotalS(loop)
  if (over.kind !== 'over') throw new Error('three passes of a 350 s wait are 1,050 s')
  expect({ totalS: over.total.totalMs / 1000, calls: over.total.calls }).toEqual({ totalS: 1050, calls: 3 })
  // Two passes fit under the ceiling: raised to their sum.
  expect(coverShellWaits(shellCovers('for r in ri.a ri.b; do orthanc repository checks wait $r v1 --timeout 20; done'), DEFAULT_SHELL)).toMatchObject({
    kind: 'raise',
    timeoutMs: 540_000,
    total: { calls: 2 },
  })
  // A `done` that is an argument does not close the body: three passes are
  // still three passes, and the loop is still counted for the rest of the line.
  const wordNamedDone = shellTotalS('for r in ri.a ri.b ri.c; do orthanc repository checks wait $r done --timeout 20; done')
  if (wordNamedDone.kind !== 'over') throw new Error('three passes of a 270 s wait are 810 s, not one')
  expect({ totalS: wordNamedDone.total.totalMs / 1000, calls: wordNamedDone.total.calls }).toEqual({ totalS: 810, calls: 3 })
  // What the guard cannot count is counted once, and said to be so in code: the
  // host's own timer still stops a loop that outruns the raised timeout.
  for (const line of [
    'for r in $(orthanc repository list); do orthanc repository checks wait $r v1 --timeout 20; done',
    'while read -r r; do orthanc repository checks wait "$r" v1 --timeout 20; done < rids.txt',
  ]) {
    expect({ line, totalS: shellWaits(line) }).toEqual({ line, totalS: [270] })
    expect(coverShellWaits(shellCovers(line), DEFAULT_SHELL)).toMatchObject({ kind: 'raise', timeoutMs: 270_000, total: { calls: 1 } })
  }
})

test('B11: only what cannot both happen is priced as the larger of two', async () => {
  // `a || b` runs its right-hand call when the left one failed, and a wait that
  // times out exits 1: the retry line runs both waits, so both are charged. The
  // same for an `if` condition and an `else` arm - the condition always runs.
  const retry = 'orthanc repository checks wait ri.a v1 --timeout 200 || orthanc repository checks wait ri.b v1 --timeout 200'
  const refusal = shellTotalS(retry)
  if (refusal.kind !== 'over') throw new Error('the retry line waits twice: 900 s, not 450 s')
  expect({ totalS: refusal.total.totalMs / 1000, calls: refusal.total.calls, onFailure: refusal.total.onFailure }).toEqual({ totalS: 900, calls: 2, onFailure: true })
  expect(shellWaitDenial(refusal.total, DEFAULT_SHELL)).toContain('a wait that times out exits 1, so the one after `||` runs too')
  // The `if` line costs the same 900 s, and is charged without the `||` reason.
  expect(shellTotalS('if orthanc repository checks wait ri.a v1 --timeout 200; then echo ok; else orthanc repository checks wait ri.b v1 --timeout 200; fi')).toMatchObject({
    kind: 'over',
    total: { totalMs: 900_000, calls: 2, onFailure: false },
  })
  // Three waits in an `&&`/`||` chain are three waits run in sequence.
  expect(shellTotalS('orthanc repository checks wait ri.a v1 --timeout 100 && orthanc repository checks wait ri.b v1 --timeout 100 || orthanc repository checks wait ri.c v1 --timeout 100')).toMatchObject({ kind: 'over', total: { totalMs: 1_050_000, calls: 3 } })
  // What genuinely cannot both happen is the larger: the legs of a pipeline run
  // together, and one `case` arm is chosen between.
  for (const line of [
    'orthanc repository checks wait ri.a v1 --timeout 200 | orthanc repository checks wait ri.b v1 --timeout 200',
    'case $r in one) orthanc repository checks wait ri.a v1 --timeout 200;; two) orthanc repository checks wait ri.b v1 --timeout 200;; esac',
  ]) {
    const cover = shellTotalS(line)
    expect({ line, kind: cover.kind, timeoutS: cover.kind === 'raise' ? cover.timeoutMs / 1000 : 0 }).toEqual({ line, kind: 'raise', timeoutS: 450 })
  }
})

test('B12: a job the shell leaves running has no foreground wait to cover', async () => {
  for (const line of [
    'orthanc repository checks wait ri.r v1 --timeout 1200 > wait.log 2>&1 &',
    'orthanc repository checks wait ri.a v1 --timeout 300 & orthanc repository checks wait ri.b v1 --timeout 300 & wait',
    'for r in ri.a ri.b ri.c; do orthanc repository checks wait $r v1 --timeout 200 & done; wait',
  ]) {
    expect({ line, cover: shellTotalS(line) }).toEqual({ line, cover: { kind: 'keep' } })
  }
})

test('B13: a wait the guard cannot price is neither raised nor refused', async () => {
  for (const line of [
    // The arguments continue inside the substitution: the flags after it are not
    // what the guard sees, so the plugin will not pick a timeout from them.
    'orthanc repository checks wait $(cat rid.txt) --timeout 600',
    // A --timeout the guard cannot read: charging Orthanc\'s 600 s default and
    // refusing on it would refuse a wait the command never asked for.
    'orthanc repository checks wait ri.r v1 --timeout $((5*60))',
    'orthanc repository checks wait ri.r v1 --timeout $WAIT',
    'orthanc repository checks wait ri.r v1 --timeout "$WAIT"',
  ]) {
    expect({ line, cover: shellTotalS(line) }).toEqual({ line, cover: { kind: 'keep' } })
  }
  // Readable flags beside an unpriceable call: the line gets the time the guard
  // is sure of, and is never refused on the rest.
  expect(shellTotalS('orthanc repository checks wait $(cat rid.txt) --timeout 600 && orthanc repository checks wait ri.b v1 --timeout 50')).toMatchObject({
    kind: 'raise',
    timeoutMs: 300_000,
  })
})

// ---------- through the gate: the Bash call the plugin hands to the host ----------

const bash = ($: Engine, command: string, options: Record<string, unknown> = {}) =>
  $.tool.call({ tool: 'Bash', command, ...options } as never) as Promise<Reply>

test('B8: through the gate, a waiting Bash call is handed the timeout that covers it', async ($, on) => {
  const { h } = harness(on)
  const command = 'orthanc repository checks wait ri.r v1 --timeout 300'
  const ran = await bash($, command, { timeout: 1_000 })
  expect(ran.deny).toBe(undefined)
  expect(h.bash).toEqual([{ command, timeoutMs: 550_000 }])
  // And the model is told: the answer it reads names the timeout it did not ask for.
  expect((ran.context ?? []).join(' ')).toContain('ran with a 550 s timeout')
})

test('B2 B4: what does not wait, or already has the time, reaches the tool as it came', async ($, on) => {
  const { h } = harness(on)
  const short = 'orthanc ontology list'
  expect((await bash($, short, { timeout: 5_000 })).deny).toBe(undefined)
  expect((await bash($, 'orthanc repository checks wait ri.r v1 --timeout 300', { timeout: 600_000 })).deny).toBe(undefined)
  expect((await bash($, 'orthanc repository checks wait ri.r v1 --no-wait', { timeout: 2_000 })).deny).toBe(undefined)
  expect(h.bash).toEqual([
    { command: short, timeoutMs: 5_000 },
    { command: 'orthanc repository checks wait ri.r v1 --timeout 300', timeoutMs: 600_000 },
    { command: 'orthanc repository checks wait ri.r v1 --no-wait', timeoutMs: 2_000 },
  ])
})

test('B11 B12 B13: through the gate, only a line the guard is sure of is refused', async ($, on) => {
  const { h } = harness(on)
  // Two 450 s waits joined by `||` are refused: a wait that timed out exits 1,
  // so the retry line runs both, and 900 s is over any Bash timeout.
  const retry = 'orthanc repository checks wait ri.a v1 --timeout 200 || orthanc repository checks wait ri.b v1 --timeout 200'
  expect((await bash($, retry, { timeout: 1_000 })).deny).toContain('add up to 900 s')
  // The pipeline spelling runs its legs together and is only raised; so is the
  // background job, which the line never waits for.
  expect((await bash($, retry.replace(' || ', ' && '), { timeout: 1_000 })).deny).toContain('add up to 900 s')
  expect((await bash($, retry.replace(' || ', ' | '), { timeout: 1_000 })).deny).toBe(undefined)
  expect((await bash($, 'orthanc repository checks wait ri.r v1 --timeout 1200 > wait.log 2>&1 &', { timeout: 1_000 })).deny).toBe(undefined)
  // A --timeout the guard cannot read is the caller's own number: no refusal on
  // a default the command never asked for.
  expect((await bash($, 'orthanc repository checks wait ri.r v1 --timeout $((5*60))', { timeout: 1_000 })).deny).toBe(undefined)
  // The raised line carries 450 s; the two left alone carry what the model gave.
  expect(h.bash.map(entry => entry.timeoutMs)).toEqual([450_000, 1_000, 1_000])
  // (pipeline raised to 450 s; the two left alone keep what the model gave.)
})

test('B2: the cover is the session\'s own shell limits, not the plugin\'s guess', async ($, on) => {
  const { h } = harness(on)
  h.env.set('BASH_MAX_TIMEOUT_MS', '300000')
  // 150 + 120 grace + 10 interval + 120 margin = 400 s, past the 300 s ceiling
  // this session set: refused where the 600 s default would have covered it.
  const over = await bash($, 'orthanc repository checks wait ri.r v1 --timeout 150', { timeout: 1_000 })
  expect(over.deny).toContain('at most 300 s')
  expect(h.bash).toEqual([])
  // A wait that fits the session's ceiling is given its time and runs.
  expect((await bash($, 'orthanc repository checks wait ri.r v1 --timeout 30', { timeout: 1_000 })).deny).toBe(undefined)
  expect(h.bash.map(entry => entry.timeoutMs)).toEqual([280_000])
})

test('B3 B9: a Bash wait nothing fits is refused before the command runs', async ($, on) => {
  const { h } = harness(on)
  const plain = await bash($, 'orthanc repository checks wait ri.r v1', { timeout: 1_000 })
  expect(h.bash).toEqual([])
  expect(plain.deny).toContain("so the command was not run")
  expect(plain.deny).toContain('orthanc_cli, which waits up to 2290 s')
  // Past orthanc_cli\'s own cap too: the refusal says the flag that is too big there.
  const over = await bash($, 'orthanc repository checks wait ri.r v1 --timeout 5000', { timeout: 1_000 })
  expect(over.deny).toContain('waits 5250 s')
  expect(over.deny).toContain('orthanc_cli, which waits up to 2290 s for it, with --timeout 2040 or less')
  expect(h.bash).toEqual([])
})

test('B7: run_in_background has no foreground timer to cover', async ($, on) => {
  const { h } = harness(on)
  const command = 'orthanc repository checks wait ri.r v1'
  expect((await bash($, command, { timeout: 1_000, run_in_background: true })).deny).toBe(undefined)
  expect(h.bash).toEqual([{ command, timeoutMs: 1_000 }])
})

test('B6: a line the guard refuses is answered before any timeout is raised', async ($, on) => {
  const { h } = harness(on)
  // A write waits behind the same timer, but the ladder answers it first.
  const write = await bash($, 'orthanc ai-fde run do it --apply --timeout 1200')
  expect(write.deny).toContain('orthanc_cli')
  const unreadable = await bash($, 'O=orthanc; $O repository checks wait ri.r v1 --timeout 1200')
  expect(unreadable.deny).toContain('cannot read')
  expect(h.bash).toEqual([])
})

// The lane test FND-17 asked for: one wait, read once, whichever door the call
// comes through. `devops draft publish --wait` waits a fixed 900 s in Orthanc
// (open PR #25 puts that constant in WAIT_EXTRAS); the fixture names what the
// manifest holds today, so the test pins the mechanism, not the table.
const DRAFT_PUBLISH: ManifestCommand = {
  path: 'devops draft publish',
  kind: 'mutation',
  flags: [
    { flag: '--wait', takesValue: false },
    { flag: '--timeout', takesValue: true, default: '900' },
  ],
}

test('B9: one wait, read the same by both lanes', async () => {
  const lanes: [ManifestCommand, string, number][] = [
    [CHECKS_WAIT, 'repository checks wait ri.x v1 --wait --timeout 1200', 1450],
    [DRAFT_PUBLISH, 'devops draft publish p --wait', 1020],
  ]
  for (const [command, argv, waitS] of lanes) {
    const manifest = command === CHECKS_WAIT ? SHELL_MANIFEST : [...SHELL_MANIFEST, DRAFT_PUBLISH]
    const inBash = shellOrthancCalls(`orthanc ${argv}`, manifest).map(entry => ({ wait: cliWait(entry.command, entry.args), times: entry.times }))
    const inCli = cliWait(command, argv.split(/\s+/).slice(3))
    expect({ argv, bashS: inBash.map(entry => entry.wait.waitMs / 1000), cliS: inCli.waitMs / 1000 }).toEqual({ argv, bashS: [waitS], cliS: waitS })
    // orthanc_cli runs to that wait; Bash holds what its ceiling allows and
    // refuses with the number its own timer is short by.
    expect(inCli.timeoutMs / 1000).toBe(waitS)
    expect(coverShellWaits(inBash, DEFAULT_SHELL).kind).toBe('over')
    const cover = coverShellWaits(inBash, DEFAULT_SHELL)
    expect({ argv, kind: cover.kind }).toEqual({ argv, kind: 'over' })
    if (cover.kind !== 'over') throw new Error('the Bash ceiling must not hold this wait')
    expect(shellWaitDenial(cover.total, DEFAULT_SHELL)).toContain(`waits ${waitS} s here`)
  }
})

test('B6: a waiting write in Bash is refused for being a write, timer and all', async ($, on) => {
  const { h } = harness(on)
  const ran = await bash($, 'orthanc ai-fde run do it --apply --wait --timeout 1200')
  expect(ran.deny).toContain("Orthanc writes run through orthanc_cli")
  expect(h.bash).toEqual([])
})
