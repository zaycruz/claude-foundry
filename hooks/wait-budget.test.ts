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
// Measured against the orthanc v0.7.11 agent-manifest (claude-foundry FND-17),
// written before the fix: every command that declares a wait, its flags and
// its manifest defaults, run through cliWait. Every flag, positional and default
// in the fixtures below is as the release lists it, and orthanc-source names the
// file where each bound lives.
//  W19 A wait bounded by a flag other than --timeout is not counted at all, so
//      the call dies at the 300 s floor: `functions execute --timeout-seconds`
//      (src/functions.rs, default 300), `models deployment get --wait
//      --timeout-seconds` (src/models.rs, 300), `repository checks rerun
//      --readback-timeout` on top of its --wait (src/repository_checks.rs, 60),
//      `dependency object-type --time-budget-seconds` (src/dependency.rs, up to
//      600). `--timeout-seconds` is also the spelling orthanc uses for `search`,
//      `verify` and `update`.
//  W20 A command that waits a fixed time with a bare --wait, and no flag to say
//      how long, is cut at the floor: `devops draft publish --apply --wait`
//      waits FINALIZE_TIMEOUT 900 s (src/devops_publish.rs). A plan (no --apply)
//      or --wait=false keeps the floor.
//  W21 So do the Marketplace writes, whose draft waits and job wait are in code
//      and not in the manifest: `marketplace installation create`/`upgrade
//      --apply --wait` wait two drafts (120 s each) and the job (540 s) = 780 s,
//      `marketplace job cancel --apply --wait` the job (540 s)
//      (src/marketplace_draft.rs, MI30), and `marketplace installation
//      uninstall --apply` polls its delete job for 600 s with no --wait flag.
//  W22 A call over the cap because of one of these new flags is told to pass a
//      smaller --timeout, which it does not have. And a per-request ceiling
//      (--timeout-seconds on search, update, functions) must never refuse: that
//      call ran before this change, and the number says nothing about its length.
//  W23 Orthanc's fixed wait is no flag, so no flag an agent passes may erase it,
//      and every command's own defaults still fit under the cap.
//  W24 A flag the command does not have counts for nothing: orthanc's own usage
//      error names its real flags, and a refusal built on a flag it would reject
//      sends the agent into a usage error.
//  W25 `marketplace installation uninstall` has no --wait and polls its own
//      delete job for 600 s after the POST (src/marketplace_uninstall_verify.rs).
//  W26 `marketplace installation upgrade` waits what an install waits.
//  W27 A manifest default that arrives as a JSON number still counts.
//  W28 A fixed-wait write whose own wait ran out is reported as an unknown
//      mutation; a 404 on any other command is not.

import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { CLI_TIMEOUT_CAP_MS, CLI_TIMEOUT_FLOOR_MS, cliTimeoutMs, cliWait, failure, guideEnvelope, manifestFrom, notRunFailure } from './orthanc'
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

// Every flag below, and its default, is as the orthanc v0.7.11 agent-manifest
// lists it. What the manifest cannot say is a wait orthanc bounds in code with
// no flag of its own (W20, W21).
const DEVOPS_DRAFT_PUBLISH: ManifestCommand = {
  path: 'devops draft publish',
  kind: 'mutation',
  flags: [
    { flag: '--wait', takesValue: false },
    { flag: '--apply', takesValue: false },
    { flag: '--yes', takesValue: false },
  ],
}
// The release lists store_rid and spec_rid as positionals on create; --store is
// only a flag on `marketplace job list`. The argv here is what the command
// really takes, so a test cannot pass on a flag orthanc would reject.
const MARKETPLACE_INSTALL: ManifestCommand = {
  path: 'marketplace installation create',
  kind: 'mutation',
  flags: [
    { flag: '--folder', takesValue: true },
    { flag: '--ontology', takesValue: true },
    { flag: '--wait', takesValue: false },
    { flag: '--apply', takesValue: false },
    { flag: '--yes', takesValue: false },
  ],
}
// Same wait, same code path, and the release lists `upgrade` with no --wait
// either way of spelling it: it shares the install entry.
const MARKETPLACE_UPGRADE: ManifestCommand = { ...MARKETPLACE_INSTALL, path: 'marketplace installation upgrade' }
// No --wait flag anywhere: after the POST it polls its own delete job for 600 s.
const MARKETPLACE_UNINSTALL: ManifestCommand = {
  path: 'marketplace installation uninstall',
  kind: 'mutation',
  flags: [
    { flag: '--mode', takesValue: true, default: 'detach' },
    { flag: '--delete-project', takesValue: false },
    { flag: '--apply', takesValue: false },
    { flag: '--yes', takesValue: false },
  ],
}
const MARKETPLACE_JOB_CANCEL: ManifestCommand = {
  path: 'marketplace job cancel',
  kind: 'mutation',
  flags: [
    { flag: '--wait', takesValue: false },
    { flag: '--apply', takesValue: false },
    { flag: '--yes', takesValue: false },
  ],
}
const FUNCTIONS_EXECUTE: ManifestCommand = {
  path: 'functions execute',
  kind: 'mutation',
  flags: [
    { flag: '--timeout-seconds', takesValue: true, default: '300' },
    { flag: '--apply', takesValue: false },
  ],
}
const DEPENDENCY_GRAPH: ManifestCommand = {
  path: 'dependency object-type',
  kind: 'read-only',
  flags: [
    { flag: '--depth', takesValue: true, default: '2' },
    { flag: '--time-budget-seconds', takesValue: true, default: '60' },
  ],
}
const CHECKS_RERUN: ManifestCommand = {
  path: 'repository checks rerun',
  kind: 'mutation',
  flags: [
    { flag: '--branch', takesValue: true },
    { flag: '--wait', takesValue: false },
    { flag: '--timeout', takesValue: true, default: '600' },
    { flag: '--interval', takesValue: true, default: '10' },
    { flag: '--readback-timeout', takesValue: true, default: '60' },
    { flag: '--apply', takesValue: false },
  ],
}
// --timeout-seconds here caps one HTTP request (default 30 s on a GET), not a
// wait: these calls must never be refused over it.
const SEARCH: ManifestCommand = {
  path: 'search',
  kind: 'read-only',
  flags: [
    { flag: '--limit', takesValue: true, default: '20' },
    { flag: '--timeout-seconds', takesValue: true, default: '30' },
  ],
}
const UPDATE: ManifestCommand = {
  path: 'update',
  kind: 'mutation',
  flags: [
    { flag: '--timeout-seconds', takesValue: true, default: '120' },
    { flag: '--apply', takesValue: false },
    { flag: '--yes', takesValue: false },
  ],
}
const DEPLOYMENT_WAIT: ManifestCommand = {
  path: 'models deployment get',
  kind: 'read-only',
  flags: [
    { flag: '--wait', takesValue: false },
    { flag: '--timeout-seconds', takesValue: true, default: '300' },
    { flag: '--poll-interval', takesValue: true, default: '5' },
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

// orthanc bounds its own wait with four flag spellings and, for three commands,
// with a constant in Rust. A wait the timer does not add is a call it cuts.
const MARKETPLACE_DRAFT_WAITS_S = 120 + 120
const FINALIZE_WAIT_S = 900
const JOB_WAIT_S = 540

test('W19: a wait bounded by --timeout-seconds, --readback-timeout or --time-budget-seconds is counted', async () => {
  // functions execute: HTTP timeout 300 s by default, an AIP Logic run past the floor.
  expect(seconds(cliTimeoutMs(FUNCTIONS_EXECUTE, ['fn', '{}', '--apply']))).toBe(300 + MARGIN_S)
  expect(seconds(cliTimeoutMs(FUNCTIONS_EXECUTE, ['fn', '{}', '--apply', '--timeout-seconds', '1200']))).toBe(1200 + MARGIN_S)
  expect(seconds(cliTimeoutMs(FUNCTIONS_EXECUTE, ['fn', '--apply', '--timeout-seconds=900']))).toBe(900 + MARGIN_S)
  // models deployment get --wait: its own 300 s, one poll of overshoot, the margin.
  expect(seconds(cliTimeoutMs(DEPLOYMENT_WAIT, ['dep', '--wait']))).toBe(300 + 5 + MARGIN_S)
  // repository checks rerun --wait waits --timeout and then reads back for --readback-timeout.
  expect(seconds(cliTimeoutMs(CHECKS_RERUN, ['agent/x', '--wait', '--apply']))).toBe(600 + 60 + 10 + MARGIN_S)
  expect(seconds(cliTimeoutMs(CHECKS_RERUN, ['agent/x', '--wait', '--apply', '--readback-timeout', '300']))).toBe(600 + 300 + 10 + MARGIN_S)
  // A plan never waits; a short default stays at the floor.
  expect(cliTimeoutMs(CHECKS_RERUN, ['agent/x', '--wait'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(DEPENDENCY_GRAPH, ['ri.ot', '--time-budget-seconds', '600'])).not.toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(seconds(cliTimeoutMs(DEPENDENCY_GRAPH, ['ri.ot', '--time-budget-seconds', '600']))).toBe(600 + MARGIN_S)
  expect(cliTimeoutMs(DEPENDENCY_GRAPH, ['ri.ot'])).toBe(CLI_TIMEOUT_FLOOR_MS)
})

test('W20: devops draft publish --wait gets orthanc\'s 900 s finalise, a plan does not', async () => {
  expect(seconds(cliTimeoutMs(DEVOPS_DRAFT_PUBLISH, ['draft', 'v1', '--apply', '--yes', '--wait']))).toBe(FINALIZE_WAIT_S + MARGIN_S)
  expect(cliTimeoutMs(DEVOPS_DRAFT_PUBLISH, ['draft', 'v1', '--yes', '--wait'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(DEVOPS_DRAFT_PUBLISH, ['draft', 'v1', '--apply', '--yes', '--wait=false'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(DEVOPS_DRAFT_PUBLISH, ['draft', 'v1', '--apply', '--yes'])).toBe(CLI_TIMEOUT_FLOOR_MS)
})

test('W21: the Marketplace waits cover two draft waits and the job wait', async () => {
  // MI30: 120 + 120 + 540 = 780 s, orthanc's own e2e bound.
  expect(seconds(cliTimeoutMs(MARKETPLACE_INSTALL, ['ri.ms', 'ri.spec', '--wait', '--apply', '--yes']))).toBe(
    JOB_WAIT_S + MARKETPLACE_DRAFT_WAITS_S + MARGIN_S,
  )
  expect(seconds(cliTimeoutMs(MARKETPLACE_JOB_CANCEL, ['ri.job', '--wait', '--apply', '--yes']))).toBe(JOB_WAIT_S + MARGIN_S)
  expect(cliTimeoutMs(MARKETPLACE_INSTALL, ['ri.ms', 'ri.spec', '--wait'])).toBe(CLI_TIMEOUT_FLOOR_MS)
  expect(cliTimeoutMs(MARKETPLACE_JOB_CANCEL, ['ri.job', '--apply', '--yes'])).toBe(CLI_TIMEOUT_FLOOR_MS)
})

test('W22: a request ceiling never refuses; a wait deadline is named with a value that fits', async () => {
  // --timeout-seconds on a command with no --wait bounds one HTTP request. Such
  // a call ran before this PR at the cap, and a refusal would take that away.
  for (const [command, args] of [
    [FUNCTIONS_EXECUTE, ['fn', '--apply', '--timeout-seconds', '5000']],
    [SEARCH, ['dataset', '--timeout-seconds', '3600']],
    [UPDATE, ['--target', 'linux-x86_64', '--apply', '--yes', '--timeout-seconds', '2400']],
  ] as [ManifestCommand, string[]][]) {
    const wait = cliWait(command, args)
    expect({ path: command.path, overCap: wait.overCap, timeoutMs: wait.timeoutMs, capMs: wait.capMs, flags: wait.overFlags }).toEqual({
      path: command.path,
      overCap: false,
      timeoutMs: wait.capMs,
      capMs: CLI_TIMEOUT_CAP_MS,
      flags: undefined,
    })
  }
  // The same flag on a command that waits on it (--wait present) is the caller's
  // to lower, and the refusal names it with the largest value that fits.
  const deployment = cliWait(DEPLOYMENT_WAIT, ['dep', '--wait', '--timeout-seconds', '2500'])
  expect({ overCap: deployment.overCap, flag: deployment.maxFlag, max: deployment.maxValueS, flags: deployment.overFlags }).toEqual({
    overCap: true,
    flag: '--timeout-seconds',
    max: 2165,
    flags: ['--timeout-seconds'],
  })
  // A --readback-timeout over the cap is named too, and no --timeout is invented.
  const readback = cliWait(CHECKS_RERUN, ['agent/x', '--wait', '--apply', '--readback-timeout', '3000'])
  expect({ overCap: readback.overCap, flag: readback.maxFlag, max: readback.maxValueS, flags: readback.overFlags }).toEqual({
    overCap: true,
    flag: '--readback-timeout',
    max: 1560,
    flags: ['--readback-timeout'],
  })
})

test('W24: a flag the command does not have counts for nothing', async () => {
  // `marketplace installation create` has no --timeout: orthanc's own usage
  // error is the answer to that flag, not a timer of ours or a refusal.
  const extra = cliWait(MARKETPLACE_INSTALL, ['ri.ms', 'ri.spec', '--wait', '--apply', '--yes', '--timeout', '2000'])
  expect({ timeoutMs: seconds(extra.timeoutMs), overCap: extra.overCap, flags: extra.overFlags }).toEqual({
    timeoutMs: JOB_WAIT_S + MARKETPLACE_DRAFT_WAITS_S + MARGIN_S,
    overCap: false,
    flags: undefined,
  })
})

test('W25: uninstall waits its 600 s verify, and a plan does not', async () => {
  expect(seconds(cliTimeoutMs(MARKETPLACE_UNINSTALL, ['ri.msi.x', '--apply', '--yes']))).toBe(600 + MARGIN_S)
  expect(seconds(cliTimeoutMs(MARKETPLACE_UNINSTALL, ['ri.msi.x', '--mode', 'detach', '--apply', '--yes']))).toBe(600 + MARGIN_S)
  // A plan (no --apply) sends nothing and waits for nothing.
  expect(cliTimeoutMs(MARKETPLACE_UNINSTALL, ['ri.msi.x'])).toBe(CLI_TIMEOUT_FLOOR_MS)
})

test('W26: an install upgrade waits what an install waits', async () => {
  expect(cliTimeoutMs(MARKETPLACE_UPGRADE, ['ri.msi.x', 'ri.spec', '--wait', '--apply', '--yes'])).toBe(
    cliTimeoutMs(MARKETPLACE_INSTALL, ['ri.ms', 'ri.spec', '--wait', '--apply', '--yes']),
  )
})

test('W27: a manifest default that arrives as a number still counts', async () => {
  // JSON may carry seconds as a number. One that is dropped is a wait that
  // silently falls back to the floor: the failure this file exists to stop.
  const envelope = {
    data: {
      commands: [
        {
          path: 'repository checks wait',
          kind: 'mutation',
          args: [
            { kind: 'positional', name: 'branch' },
            { flag: '--wait', takes_value: false },
            { flag: '--timeout', takes_value: true, default: 600 },
          ],
        },
      ],
    },
  }
  const [command] = manifestFrom(envelope)
  expect(seconds(cliTimeoutMs(command, ['agent/x', '--wait', '--apply']))).toBe(600 + MARGIN_S)
})

test('W28: a fixed-wait write whose own wait ran out is an unknown mutation', async () => {
  // Orthanc sends the write, then polls its own constant. When that poll runs
  // out the answer is an unsupported-capability error, and the write is out.
  const timedOut = { errors: [{ type: 'unsupported-capability', message: 'job ri.job did not end within 540 s' }] }
  expect(guideEnvelope(timedOut, MARKETPLACE_INSTALL, null).uncertain_mutation).toBe(true)
  expect(guideEnvelope(timedOut, MARKETPLACE_UNINSTALL, null).uncertain_mutation).toBe(true)
  // A command whose wait the caller sets is orthanc's own answer to report: a
  // 404 is a 404, and a flag that always cries uncertain teaches to ignore it.
  expect(guideEnvelope(timedOut, CHECKS_RERUN, null).uncertain_mutation).toBeUndefined()
  expect(guideEnvelope({ errors: [{ type: 'foundry-api-error', message: 'HTTP 404 not found' }] }, MARKETPLACE_INSTALL, null).uncertain_mutation).toBeUndefined()
})

test('W23: a flag an agent can lower never removes Orthanc\'s fixed wait, and every default here fits', async () => {
  // FINALIZE_TIMEOUT is not a flag: a command that also declares --timeout still
  // finalises for 900 s.
  const declared: ManifestCommand = {
    ...DEVOPS_DRAFT_PUBLISH,
    flags: (DEVOPS_DRAFT_PUBLISH.flags ?? []).concat({ flag: '--timeout', takesValue: true, default: '300' }),
  }
  expect(seconds(cliTimeoutMs(declared, ['draft', '--apply', '--yes', '--wait']))).toBe(900 + 300 + MARGIN_S)
  expect(seconds(cliTimeoutMs(declared, ['draft', '--apply', '--yes', '--wait', '--timeout', '60']))).toBe(900 + 60 + MARGIN_S)
  for (const [command, args] of [
    [DEVOPS_DRAFT_PUBLISH, ['draft', '--apply', '--yes', '--wait']],
    [MARKETPLACE_INSTALL, ['ri.ms', 'ri.spec', '--wait', '--apply', '--yes']],
    [MARKETPLACE_UPGRADE, ['ri.msi.x', 'ri.spec', '--wait', '--apply', '--yes']],
    [MARKETPLACE_JOB_CANCEL, ['ri.job', '--wait', '--apply', '--yes']],
    [MARKETPLACE_UNINSTALL, ['ri.msi.x', '--apply', '--yes']],
    [FUNCTIONS_EXECUTE, ['fn', '--apply']],
    [CHECKS_RERUN, ['agent/x', '--wait', '--apply']],
    [DEPLOYMENT_WAIT, ['dep', '--wait']],
    [DEPENDENCY_GRAPH, ['ri.ot']],
  ] as [ManifestCommand, string[]][]) {
    const wait = cliWait(command, args)
    expect({ path: command.path, overCap: wait.overCap, cap: seconds(wait.capMs) }).toEqual({
      path: command.path,
      overCap: false,
      cap: seconds(CLI_TIMEOUT_CAP_MS),
    })
  }
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
    ...[AI_FDE_RUN, CHECKS_WAIT, DEVOPS_DRAFT_PUBLISH, MARKETPLACE_JOB_CANCEL, MARKETPLACE_INSTALL, MARKETPLACE_UPGRADE, MARKETPLACE_UNINSTALL, FUNCTIONS_EXECUTE, SEARCH, UPDATE, CHECKS_RERUN, DEPLOYMENT_WAIT].map(command => ({
      path: command.path,
      kind: command.kind,
      args: manifestArgs(command),
    })),
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
}

const lineOf = (argv: readonly string[]) => {
  let words = argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
  if (words[0] === '--profile') words = words.slice(2)
  return words.join(' ')
}

function harness(on: On) {
  const clock = mock.clock(on, { now: 1_000_000 })
  const h: Harness = { runs: [], spawns: [], stopped: [], child: 'finish', missing: false, asks: [], mode: 'yolo' }
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
  const env = new Map<string, string>([['HOME', '/home/tester']])
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
    const asked = e as unknown as { tool: string; questions?: { question: string }[] }
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

test('W3 W20: through the tool, devops draft publish --wait is not stopped at the 300 s floor', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = 'hang'
  const running = call($, 'devops draft publish', ['draft', 'v1', '--apply', '--yes', '--wait'])
  expect(await after(clock, running, 1_019_000)).toBe(false)
  expect(await after(clock, running, 2000)).toBe(true)
  expect(h.spawns).toEqual(['devops draft publish draft v1 --apply --yes --wait'])
  expect(parsed(await running).errors[0]!.timeout_seconds).toBe(1020)
})

test('W22: through the tool, an over-cap wait is refused and the answer names the flag and a value', async ($, on) => {
  const { h } = harness(on)
  // 1900 + 300 + 10 + 120 = 2330 s over a 2290 s cap: --timeout is the flag with
  // room, and the agent is told the number, not a search.
  const out = parsed(await call($, 'repository checks rerun', ['agent/x', '--wait', '--apply', '--timeout', '1900', '--readback-timeout', '300']))
  expect(h.spawns).toEqual([])
  expect(h.runs).toEqual([])
  const error = out.errors[0]!
  expect(error.type).toBe('timeout-over-cap')
  expect(error.cap_seconds).toBe(2290)
  expect(error.max_timeout_seconds).toBe(1860)
  expect(String(error.message)).toContain('Pass --timeout 1860 or less')
})

test('W22: through the tool, a big request ceiling runs at the cap instead of being refused', async ($, on) => {
  const { h, clock } = harness(on)
  h.child = 'hang'
  const running = call($, 'update', ['--target', 'linux-x86_64', '--apply', '--yes', '--timeout-seconds', '2400'])
  expect(await after(clock, running, 2_289_000)).toBe(false)
  expect(await after(clock, running, 2_000)).toBe(true)
  expect(parsed(await running).errors[0]!.timeout_seconds).toBe(2290)
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
  // Names a flag this command really has (and its grace), not a bare guess.
  expect(String(error.hint)).toContain('with a --timeout or --publish-grace that fits')
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
