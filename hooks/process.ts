// How long a child runs where this mod does not hold the timer itself.
//
// $.process.run kills its child after ten minutes at most, while an Orthanc wait
// (repository checks wait --timeout 1500, branch-index-status --wait) can need
// up to 32. Past that cap register.tsx spawns the child with $.process.spawn and
// a $.clock.after deadline, and readToExit reads the stream. `$` stays in
// register.tsx.
//
// The Bash tool holds a second timer, and the Orthanc wait inside it is not
// orthanc_cli's: a foreground command runs for its own `timeout` argument, or
// BASH_DEFAULT_TIMEOUT_MS, or 120 s, and the largest `timeout` the host takes is
// BASH_MAX_TIMEOUT_MS, or 600 s. Past that the host moves the command to the
// background, so a `checks wait --timeout 1200` run through Bash never answers
// the turn it started in. shellTimer reads those limits, coverShellWaits prices
// the line's Orthanc calls against them (everything the shell may run one after
// another adds up, including `a || b`, whose right-hand call runs when a wait
// that timed out exits 1; only a pipeline's legs and a `case` arm's choices are
// the larger of two), and shellWaitDenial writes what to answer when nothing
// fits. Pure: the call's env and the rewrite of the call stay in register.tsx.

import type { HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

import type { CliWait } from './orthanc'
import type { ShellCallJoin } from './policy'

/** The longest timeoutMs $.process.run takes. */
export const PROCESS_RUN_MAX_MS = 600_000

export type ProcessOutput = { exitCode: number; stdout: string; stderr: string }

/** Reads a spawned child to its exit, as $.process.run would answer: a child
 * ended by a signal reads as exit code 1. Rejects when the child cannot start
 * or `expired` settles first; leaving the stream then kills the child. */
export async function readToExit(
  child: HookStream<ProcessSpawnChunk, ProcessSpawnResult>,
  expired: Promise<unknown>,
  timeoutMs: number,
): Promise<ProcessOutput> {
  const timedOut = expired.then(() => 'expired' as const)
  let finished = false
  let stdout = ''
  let stderr = ''
  try {
    for (;;) {
      const pull = child.next()
      // A pull still pending when time runs out may reject later; that is not news.
      pull.catch(() => {})
      const next = await Promise.race([pull, timedOut])
      if (next === 'expired') throw new Error(`still running after ${timeoutMs / 1000} s; stopped`)
      if (next.done) {
        finished = true
        return { exitCode: next.value.code ?? 1, stdout, stderr }
      }
      if (next.value.stream === 'stdout') stdout += next.value.text
      else stderr += next.value.text
    }
  } finally {
    if (!finished) child.return({ code: null, signal: null }).catch(() => {})
  }
}

/** What a Bash command runs for when its call gives no `timeout` (BASH_DEFAULT_TIMEOUT_MS). */
export const BASH_TIMEOUT_DEFAULT_MS = 120_000
/** The largest `timeout` a Bash foreground command takes (BASH_MAX_TIMEOUT_MS). */
export const BASH_TIMEOUT_MAX_MS = 600_000

export type ShellTimer = { givenMs: number; maxMs: number }

/** One Orthanc call a Bash command runs: how often the shell runs it, and how it
 * joins the call before it ('seq' and the two unnamed spellings aside). */
export type ShellWait = { wait: CliWait; times: number; join?: ShellCallJoin }

/** What a command's Orthanc waits cost, the longest among them, whether the
 * guard is sure of that sequence, and whether any of them runs on another's
 * failure (so a refusal can say why it charged both). */
export type ShellTotal = { totalMs: number; calls: number; longest: CliWait; serial: boolean; onFailure: boolean }

// A call the guard cannot price: its arguments continue inside a substitution,
// or a wait flag carries a value Orthanc would read as its default rather than
// as the number the caller meant.
function unpriced(entry: ShellWait): boolean {
  return entry.join === 'unknown' || entry.wait.unreadFlags !== undefined
}

/**
 * What the Orthanc calls of one command line cost against its timer.
 *
 * `a && b`, `a; b` and a newline run one after another: their waits add up, and
 * a line raised only to the longest of them loses the later answer. `a || b`
 * runs its right-hand call when the left one failed - and `checks wait` exits 1
 * when a check fails or time runs out, so a retry line waits twice and adds up
 * too, with the reason said in the refusal. An `if` condition and an `else` arm
 * are the same shape: the condition runs, then one arm, so both are charged.
 * Only what genuinely cannot both happen is the larger of two: the legs of `a | b`
 * run together, and the arms of a `case` are chosen between. `a &` answers at
 * once and costs the turn nothing.
 * What cannot be priced counts for nothing and makes the total unconfirmed, so
 * the line is never refused on a number the guard is not sure of.
 */
function totalOf(waiting: readonly ShellWait[]): ShellTotal {
  let totalMs = 0
  let calls = 0
  let serial = true
  let onFailure = false
  let longest = waiting[0]!.wait
  for (const entry of waiting) {
    if (entry.join === 'bg') continue
    const passes = Math.max(1, entry.times)
    const cost = entry.wait.waitMs * passes
    // A `case` arm and a pipeline leg are the two spellings where one wait can
    // stand in for another: the arms are chosen between, the legs run together.
    const join = entry.join ?? 'seq'
    const instead = join === 'arm' || join === 'pipe'
    if (join === 'fail') onFailure = true
    // Only a call the guard cannot place makes the total unconfirmed; an arm or a
    // pipe leg it is sure of, and prices as the larger of two.
    if (unpriced(entry)) serial = false
    totalMs = instead ? Math.max(totalMs, cost) : totalMs + (unpriced(entry) ? 0 : cost)
    calls += passes
    if (entry.wait.waitMs > longest.waitMs) longest = entry.wait
  }
  return { totalMs, calls, longest, serial, onFailure }
}

// A positive, finite count of milliseconds; the host reads its two variables the
// same way and falls back when one holds anything else.
function positiveMs(value: unknown): number | undefined {
  const ms = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN
  return Number.isFinite(ms) && ms > 0 ? ms : undefined
}

/**
 * The timer a Bash command runs under: the call's own `timeout` (`givenMs`, what
 * the model passed), else the host's default; `maxMs`, the largest one the host
 * takes for a foreground command. Both limits come from the environment, so a
 * session that raised or lowered them is covered by what it set, not a guess.
 */
export function shellTimer(givenMs: unknown, envDefaultMs: string | undefined, envMaxMs: string | undefined): ShellTimer {
  // The ceiling is the ceiling: a session whose default sits above it gets the
  // host's clamp, not a longer promise. The plugin never hands down a timeout it
  // cannot be sure the host will run.
  const maxMs = positiveMs(envMaxMs) ?? BASH_TIMEOUT_MAX_MS
  const defaultMs = positiveMs(envDefaultMs) ?? BASH_TIMEOUT_DEFAULT_MS
  return { givenMs: Math.min(positiveMs(givenMs) ?? defaultMs, maxMs), maxMs }
}

// One command line runs its Orthanc calls one after another, so its wait is the
// sum of theirs, and a counted loop runs each of its calls more than once.
export type ShellCover =
  | { kind: 'keep' }
  | { kind: 'raise'; timeoutMs: number; total: ShellTotal; timer: ShellTimer }
  | { kind: 'over'; total: ShellTotal; timer: ShellTimer }

/**
 * Whether the Orthanc calls a Bash command runs fit under its timer. Waits run
 * one after another in one command line (`a && b`, `a; b`, a loop body), so what
 * has to fit is their SUM, not the longest of them: a call raised only to the
 * longest wait would still run the later ones past the timer, which is the
 * failure this cover exists to close.
 *
 * `keep` when the timer already runs long enough (or nothing waits), `raise`
 * with the timeout that covers the whole line, `over` when even the largest
 * timeout the host takes is too short.
 */
export function coverShellWaits(waits: readonly ShellWait[], timer: ShellTimer): ShellCover {
  const waiting = waits.filter(entry => entry.wait.waitMs > 0 && entry.join !== 'bg')
  if (waiting.length === 0) return { kind: 'keep' }
  const total = totalOf(waiting)
  if (total.totalMs <= timer.givenMs) return { kind: 'keep' }
  // Past the ceiling: refuse only what the guard is sure runs in sequence. What
  // it is not sure of gets the longest timeout the host takes and runs.
  if (total.totalMs <= timer.maxMs || !total.serial) return { kind: 'raise', timeoutMs: Math.min(total.totalMs, timer.maxMs), total, timer }
  return { kind: 'over', total, timer }
}

const seconds = (ms: number) => Math.ceil(ms / 1000)

/** Why a Bash command that waits past any timeout it can be given did not run. */
export function shellWaitDenial(total: ShellTotal, timer: ShellTimer): string {
  const { longest, totalMs, calls } = total
  const smaller = longest.overFlags?.length ? longest.overFlags.join(' or ') : '--timeout'
  // orthanc_cli holds the waits Bash cannot: the way out it names is the tool,
  // and, when the call does not fit there either, the flag that is too big.
  let cli = calls === 1
    ? `run it with orthanc_cli, which waits up to ${seconds(longest.capMs)} s for it`
    : `run each wait in its own command with orthanc_cli, which waits up to ${seconds(longest.capMs)} s for 'orthanc ${longest.path}'`
  if (longest.overCap) cli += longest.maxTimeoutS === undefined ? `, where a smaller ${smaller} fits` : `, with --timeout ${longest.maxTimeoutS} or less`
  // Both waits of `a || b` are charged: the one that timed out exits 1, and the
  // second then runs. Say so, or the number reads like a mistake.
  const why = total.onFailure ? ' (a wait that times out exits 1, so the one after `||` runs too)' : ''
  const ways = [cli]
  // A call that fits orthanc_cli but not Bash also has a --timeout that fits
  // Bash: say the number, or the model has to guess it and be refused again.
  const fitsBashS = Math.floor((timer.maxMs - longest.fixedMs) / 1000)
  if (!longest.overCap && calls === 1 && fitsBashS >= 1) ways.push(`pass --timeout ${fitsBashS} or less, which fits Bash`)
  ways.push('pass run_in_background: true and read the output when the command lands')
  const cost = calls === 1 ? `'orthanc ${longest.path}' waits ${seconds(totalMs)} s here` : `${calls} Orthanc waits in this command add up to ${seconds(totalMs)} s, the longest 'orthanc ${longest.path}' at ${seconds(longest.waitMs)} s each`
  return `Bash runs a command for at most ${seconds(timer.maxMs)} s, and ${cost}${why}, so the command was not run. To get its result: ${ways.join('; ')}.`
}
