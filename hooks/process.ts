// Running a child longer than $.process.run allows. $.process.run kills its
// child after ten minutes at most, while an Orthanc wait (repository checks
// wait --timeout 1500, branch-index-status --wait) can need up to 32. Past that
// cap register.tsx spawns the child with $.process.spawn and a $.clock.after
// deadline, and readToExit reads the stream. `$` stays in register.tsx.

import type { HookStream, ProcessSpawnChunk, ProcessSpawnResult } from 'claude-code'

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
