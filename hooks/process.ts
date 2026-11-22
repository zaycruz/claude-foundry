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
// the turn it started in. shellTimer reads those limits, coverShellWaits says
// whether a call's own wait fits under them, and shellWaitDenial writes what to
// answer when it cannot. Pure: the call's env and the rewrite of the call stay
// in register.tsx.

import type { HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

import type { CliWait } from './orthanc'

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
  const defaultMs = positiveMs(envDefaultMs) ?? BASH_TIMEOUT_DEFAULT_MS
  const maxMs = Math.max(positiveMs(envMaxMs) ?? BASH_TIMEOUT_MAX_MS, defaultMs)
  // The host takes no foreground timeout past maxMs, whatever the call asked for.
  return { givenMs: Math.min(positiveMs(givenMs) ?? defaultMs, maxMs), maxMs }
}

export type ShellCover =
  | { kind: 'keep' }
  | { kind: 'raise'; timeoutMs: number; wait: CliWait; timer: ShellTimer }
  | { kind: 'over'; wait: CliWait; timer: ShellTimer }

/**
 * Whether the Orthanc calls a Bash command runs fit under its timer: `keep`
 * when it already runs long enough for the longest wait (or none of its calls
 * waits at all), `raise` with the timeout that covers them, `over` with the
 * call nothing fits when even the largest timeout is too short.
 */
export function coverShellWaits(waits: readonly CliWait[], timer: ShellTimer): ShellCover {
  const longest = waits.reduce<CliWait | null>((best, wait) => (wait.waitMs > (best?.waitMs ?? 0) ? wait : best), null)
  if (longest === null || longest.waitMs <= timer.givenMs) return { kind: 'keep' }
  return longest.waitMs > timer.maxMs
    ? { kind: 'over', wait: longest, timer }
    : { kind: 'raise', timeoutMs: longest.waitMs, wait: longest, timer }
}

const seconds = (ms: number) => Math.ceil(ms / 1000)

/** Why a Bash command that waits past any timeout it can be given did not run. */
export function shellWaitDenial(wait: CliWait, timer: ShellTimer): string {
  const smaller = wait.overFlags?.length ? wait.overFlags.join(' or ') : '--timeout'
  // orthanc_cli holds the waits Bash cannot: the way out it names is the tool,
  // and, when the call does not fit there either, the flag that is too big.
  let cli = `run it with orthanc_cli, which waits up to ${seconds(wait.capMs)} s for it`
  if (wait.overCap) cli += wait.maxTimeoutS === undefined ? `, where a smaller ${smaller} fits` : `, with --timeout ${wait.maxTimeoutS} or less`
  const ways = [cli, 'pass run_in_background: true and read the output when the command lands']
  return `Bash runs a command for at most ${seconds(timer.maxMs)} s, and 'orthanc ${wait.path}' waits ${seconds(wait.waitMs)} s here, so the command was not run. To get its result: ${ways.join('; ')}.`
}
