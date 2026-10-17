// orthanc_cli's process timeout (bead hooks-a5y).
//
// Ways this can fail, written before the code:
//  T1  A call that names --timeout 1500 still dies at the fixed 300 s.
//  T2  A waiting command with no flags dies before its own default wait:
//      repository checks wait (600 s), branch-index-status --wait (1800 s).
//  T3  branch-index-status --timeout without --wait (a quick read) gets a long
//      timer; sdk generate --no-wait still waits.
//  T4  The --timeout=1500 spelling is missed.
//  T5  --publish-grace is ignored, so a tag's publish wait dies after its checks pass.
//  T6  Orthanc overshoots its own deadline by one poll interval and the tool
//      kills it before it writes its timeout envelope.
//  T7  A garbage, negative or huge value gives NaN, zero or an unbounded timer.
//  T8  Commands that do not wait lose the 300 s floor.
//  T9  Flags written inside the command string (F16) are not seen.
//  T10 An older manifest without flag defaults breaks the derivation.
//  T11 A manifest without args loses the flags it does carry.

import { expect, test } from 'claude-code/testing'

import { CLI_TIMEOUT_CAP_MS, CLI_TIMEOUT_FLOOR_MS, cliTimeoutMs, manifestFrom } from './orthanc'
import { type ManifestCommand, resolveOrthancCommand } from './policy'

const CHECKS_WAIT: ManifestCommand = {
  path: 'repository checks wait',
  kind: 'read-only',
  flags: [
    { flag: '--timeout', takesValue: true, default: '600' },
    { flag: '--interval', takesValue: true, default: '10' },
    { flag: '--publish-grace', takesValue: true, default: '120' },
  ],
}
const INDEX_STATUS: ManifestCommand = {
  path: 'ontology branch-index-status',
  kind: 'read-only',
  flags: [
    { flag: '--wait', takesValue: false },
    { flag: '--timeout', takesValue: true, default: '1800' },
    { flag: '--poll-interval', takesValue: true, default: '15' },
  ],
}
const SDK_GENERATE: ManifestCommand = {
  path: 'dev-console sdk generate',
  kind: 'mutation',
  flags: [
    { flag: '--no-wait', takesValue: false },
    { flag: '--timeout', takesValue: true, default: '180' },
  ],
}
const SQL_WAIT: ManifestCommand = { path: 'sql wait', kind: 'read-only', flags: [{ flag: '--timeout', takesValue: true, default: '300' }] }
const LIST: ManifestCommand = { path: 'ontology list', kind: 'read-only', flags: [] }
const seconds = (ms: number) => ms / 1000

test('T1 T4 T5 T6: the timer follows --timeout, both spellings, plus publish grace and one poll interval', async () => {
  // 1500 wait + 120 default grace + 120 margin + 10 s interval.
  expect(seconds(cliTimeoutMs(CHECKS_WAIT, ['ri.r', 'refs/tags/v1', '--timeout', '1500']))).toBe(1750)
  expect(seconds(cliTimeoutMs(CHECKS_WAIT, ['ri.r', 'refs/tags/v1', '--timeout=1500']))).toBe(1750)
  expect(seconds(cliTimeoutMs(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '900', '--publish-grace', '300']))).toBe(900 + 300 + 120 + 10)
  expect(seconds(cliTimeoutMs(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '900', '--publish-grace', '0', '--interval', '60']))).toBe(900 + 120 + 60)
  expect(seconds(cliTimeoutMs(SQL_WAIT, ['q', '--timeout', '1000']))).toBe(1120)
})

test('T2: a waiting command with no flags gets its own default wait', async () => {
  expect(seconds(cliTimeoutMs(CHECKS_WAIT, ['ri.r', 'refs/heads/master']))).toBe(600 + 120 + 120 + 10)
  expect(seconds(cliTimeoutMs(SQL_WAIT, ['q']))).toBe(420)
  expect(cliTimeoutMs(INDEX_STATUS, ['ri.o', '--branch', 'ri.b', '--wait'])).toBe(CLI_TIMEOUT_CAP_MS)
  expect(seconds(cliTimeoutMs(INDEX_STATUS, ['ri.o', '--branch', 'ri.b', '--wait', '--timeout', '600']))).toBe(600 + 120 + 15)
})

test('T3: --wait and --no-wait decide whether --timeout is a wait at all', async () => {
  expect(cliTimeoutMs(INDEX_STATUS, ['ri.o', '--branch', 'ri.b'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(INDEX_STATUS, ['ri.o', '--branch', 'ri.b', '--timeout', '1800'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(SDK_GENERATE, ['ri.app', '--no-wait', '--timeout', '900'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(seconds(cliTimeoutMs(SDK_GENERATE, ['ri.app', '--timeout', '900']))).toBe(1020)
})

test('T7 T8: the floor is 300 s, the cap is 1800 s plus the margin, garbage counts as no wait', async () => {
  expect(seconds(CLI_TIMEOUT_FLOOR_MS)).toBe(300)
  expect(seconds(CLI_TIMEOUT_CAP_MS)).toBe(1920)
  expect(cliTimeoutMs(LIST, ['ri.o'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(undefined, [])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '99999'])).toBe(CLI_TIMEOUT_CAP_MS)
  expect(cliTimeoutMs(CHECKS_WAIT, ['ri.r', 'v1', '--timeout', '1e9'])).toBe(CLI_TIMEOUT_CAP_MS)
  expect(cliTimeoutMs(SQL_WAIT, ['q', '--timeout', '30'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  for (const value of ['abc', '-5', '', 'NaN', 'Infinity']) {
    const ms = cliTimeoutMs(SQL_WAIT, ['q', '--timeout', value])
    expect({ value, ms }).toEqual({ value, ms: CLI_TIMEOUT_FLOOR_MS })
  }
  expect(cliTimeoutMs(SQL_WAIT, ['q', '--timeout'])).toBe(CLI_TIMEOUT_FLOOR_MS)
})

test('T9: flags inside the command string count once resolved', async () => {
  const manifest = [CHECKS_WAIT, LIST]
  const resolved = resolveOrthancCommand('repository checks wait ri.r refs/tags/v1 --timeout 1500', [], manifest)
  expect(resolved.path).toBe('repository checks wait')
  expect(seconds(cliTimeoutMs(CHECKS_WAIT, resolved.args))).toBe(1750)
})

test('T10 T11: the manifest keeps flag defaults; without them only explicit values count', async () => {
  const parsed = manifestFrom({
    schema_version: 'foundry-agent-v1',
    data: {
      commands: [
        {
          path: 'repository checks wait',
          kind: 'read-only',
          args: [
            { kind: 'positional', name: 'repository_rid' },
            { kind: 'option', flag: '--timeout', takes_value: true, default: '600' },
            { kind: 'option', flag: '--wait', takes_value: false },
            { kind: 'option', flag: 7 },
          ],
        },
        { path: 'version', kind: 'local' },
      ],
    },
  })
  expect(parsed[0]!.flags).toEqual([
    { flag: '--timeout', takesValue: true, default: '600' },
    { flag: '--wait', takesValue: false },
  ])
  expect(parsed[1]!.flags).toEqual([])
  const bare: ManifestCommand = { path: 'repository checks wait' }
  expect(cliTimeoutMs(bare, ['ri.r', 'v1'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(seconds(cliTimeoutMs(bare, ['ri.r', 'v1', '--timeout', '1500']))).toBe(1620)
})
