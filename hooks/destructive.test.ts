// The destructive rule reads what a write leaves gone, not one word.
//
// hooks/policy.ts read a single word: a mutation was destructive when the last
// word of its command path was `delete`. Measured on the released orthanc
// 0.7.11 agent-manifest the pin ties to (541 commands, 260 of them mutation or
// local), 26 of those writes name an erasure in another word. 15 asked nobody
// outside yolo — `marketplace installation uninstall` ("the plan previews what
// is deleted"), `streams stream reset` ("Clear all records from the stream on a
// branch"), `dataset transactions abort` ("discard its changes"), `devops draft
// abort` ("Drop a draft"), `alias clear` ("Delete all saved aliases"), `alias
// remove`, the two `project …remove…`, `repository imports remove`,
// `dev-console scope remove`, `media-sets input-schema remove`,
// `connectivity code-import remove-importer`, `data-health check replace`,
// `orchestration schedules replace`, `admin org replace`: in `auto` one fell to
// the guard model, in `allow-edits` it ran at once. The other 11 asked only
// with the `--apply` their `operator_approval` condition names, so the same
// call without it ran.
//
// Also measured, so the list below stays on real commands and not on the names
// a report guessed: `orchestration job discard` and `ontology resource purge`
// are in no orthanc manifest, and `repository checks rerun` has no
// `--discard-passes`.
//
// Ways this can fail, written before the code:
//  D1  A destructive name the guard does not know gets no ask outside yolo — the
//      bug. Each named verb of the surface, and a verb no command uses yet
//      (`purge`), so a rename is covered before the next pin.
//  D2  The widening asks in yolo too, breaking zay's rule of 2026-11-17: "no
//      approvals are necessary for anything on the branch, only main".
//  D3  The widening sweeps in ordinary writes, so `set`, `update`, `add`,
//      `close`, `cancel`, `pause`, `restore`, `rename`, `reopen` and `rerun`
//      start asking in allow-edits and the operator stops reading the prompt.
//  D4  The widening sweeps in a read: an entry the manifest calls `read-only`
//      whose name holds a destructive word asks.
//  D5  A flag that holds a destructive word but erases nothing asks:
//      `orchestration builds create --abort-on-failure` is a routine build.
//      So does a negation (`--no-remove-check`, `--keep-data`).
//  D6  A flag that does erase is missed: `--remove`, `--remove-check`,
//      `--remove-resource`, `--delete-project`, `--delete-object-type`, in any
//      case, as `=value`, at any position.
//  D7  The rule only reads a path the manifest lists: the same words as a path
//      it does not list, the verb first rather than last, or the path split
//      across `command` and `args`, run unasked.
//  D8  The rule reads a word it should not: a branch name, a positional or a
//      flag value that happens to spell a destructive word asks.
//  D9  A block loosens: a destructive name on a call the branch rule blocks
//      runs, or the destructive reason replaces the block.
//  D10 The widening drops what the rule already read: `--force`, and a path
//      whose destructive word is not the whole last word
//      (`resource permanently-delete`). The Palantir MCP lane reads the same
//      words as the orthanc lane.
//
// Through the real hook, on a synthetic stack:
//  E1  In allow-edits and auto an uninstall asks the operator, names the
//      command in the question, does not run when declined or when no one can
//      be asked, and runs when approved.
//  E2  In those modes the widening costs no question where nothing is erased:
//      a build with `--abort-on-failure` and a check-group update that adds or
//      negates a check.
//  E3  In yolo an uninstall, a stream reset and a delete run with no dialog.
//
// Synthetic stack and RIDs only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import {
  classifyCall,
  classifyMcpIntent,
  destructiveTermIn,
  ladderDecision,
  type ManifestCommand,
  modeGuidance,
} from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const approve = { action: 'approve', reason: 'ok' } as const
const GLOBAL = 'ri.branch..branch.0f6c2a1e-1b2c-4d5e-8f90-a1b2c3d4e5f6'

// kind as orthanc 0.7.11 declares each, read from the released agent-manifest.
const MANIFEST: ManifestCommand[] = [
  { path: 'admin group member remove', kind: 'mutation' },
  { path: 'admin marking replace', kind: 'mutation' },
  { path: 'admin org replace', kind: 'mutation' },
  { path: 'alias clear', kind: 'local' },
  { path: 'alias list', kind: 'local' },
  { path: 'alias remove', kind: 'local' },
  { path: 'automate pause', kind: 'mutation' },
  { path: 'branch-protection repo unprotect', kind: 'mutation' },
  { path: 'connectivity code-import remove-importer', kind: 'mutation' },
  { path: 'connectivity sync list', kind: 'read-only' },
  { path: 'data-health check replace', kind: 'mutation' },
  { path: 'data-health check-group update', kind: 'mutation' },
  { path: 'dataset branches create', kind: 'mutation' },
  { path: 'dataset create', kind: 'mutation' },
  { path: 'dataset files delete', kind: 'mutation' },
  { path: 'dataset schema set', kind: 'mutation' },
  { path: 'dataset transactions abort', kind: 'mutation' },
  { path: 'dev-console scope remove', kind: 'mutation' },
  { path: 'devops draft abort', kind: 'mutation' },
  { path: 'devops draft set', kind: 'mutation' },
  { path: 'devops product undeprecate', kind: 'mutation' },
  { path: 'global-branch close', kind: 'mutation' },
  { path: 'global-branch remove-repo', kind: 'mutation' },
  { path: 'global-branch remove-resources', kind: 'mutation' },
  { path: 'global-branch rename', kind: 'mutation' },
  { path: 'global-branch reopen', kind: 'mutation' },
  { path: 'global-branch roles set', kind: 'mutation' },
  { path: 'global-proposal close', kind: 'mutation' },
  { path: 'marketplace installation create', kind: 'mutation' },
  { path: 'marketplace installation uninstall', kind: 'mutation' },
  { path: 'marketplace installation upgrade', kind: 'mutation' },
  { path: 'marketplace job cancel', kind: 'mutation' },
  { path: 'media-sets input-schema remove', kind: 'mutation' },
  { path: 'ontology object-type-delete', kind: 'mutation' },
  { path: 'orchestration builds cancel', kind: 'mutation' },
  { path: 'orchestration builds create', kind: 'mutation' },
  { path: 'orchestration schedules replace', kind: 'mutation' },
  { path: 'orchestration schedules unpause', kind: 'mutation' },
  { path: 'project imports remove', kind: 'mutation' },
  { path: 'project remove-orgs', kind: 'mutation' },
  { path: 'proposal close', kind: 'mutation' },
  { path: 'proposal request-review', kind: 'mutation' },
  { path: 'repository checks cancel', kind: 'mutation' },
  { path: 'repository checks required remove', kind: 'mutation' },
  { path: 'repository checks rerun', kind: 'mutation' },
  { path: 'repository imports remove', kind: 'mutation' },
  { path: 'resource delete', kind: 'mutation' },
  { path: 'resource delete-impact', kind: 'read-only' },
  { path: 'resource permanently-delete', kind: 'mutation' },
  { path: 'resource remove-markings', kind: 'mutation' },
  { path: 'resource restore', kind: 'mutation' },
  { path: 'resource-role revoke', kind: 'mutation' },
  { path: 'solution-design edge remove', kind: 'mutation' },
  { path: 'solution-design node remove', kind: 'mutation' },
  { path: 'sql cancel', kind: 'mutation' },
  { path: 'streams stream reset', kind: 'mutation' },
  { path: 'warehouse snapshot purge', kind: 'mutation' },
  { path: 'workshop module revert', kind: 'mutation' },
  { path: 'workshop module update', kind: 'mutation' },
]

const DATASET = 'ri.foundry.main.dataset.0f6c2a1e-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const REPO = 'ri.stemma.main.repository.0f6c2a1e-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const INSTALLATION = 'ri.marketplace.main.installation.0f6c2a1e-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const SCHEDULE = 'ri.scheduler.main.schedule.0f6c2a1e-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const WORK_BRANCH = 'agent-nightly'
/** A schedule action on a work branch: `orchestration schedules replace` needs
 * one, or the branch rule blocks it before the ladder. */
const ACTION = JSON.stringify({ type: 'build', target: { type: 'manual', targetRids: [DATASET] }, branchName: WORK_BRANCH })

/** [command, args] for every write the guard must mark destructive on 0.7.11,
 * plus the words no 0.7.11 command uses yet. `dataset files delete` and
 * `resource permanently-delete` are what the rule already read; the rest is the
 * gap. Each asks outside yolo and runs in yolo. */
const DESTRUCTIVE: [string, string[]][] = [
  ['marketplace installation uninstall', [INSTALLATION, '--mode', 'delete']],
  ['streams stream reset', [DATASET, '--branch', 'agent-x']],
  ['dataset transactions abort', [DATASET, 'ri.foundry.main.transaction.1']],
  ['devops draft abort', ['ri.devops.main.draft.1']],
  ['alias clear', []],
  ['alias remove', ['mk']],
  ['admin org replace', ['acme', 'Acme Holdings']],
  ['data-health check replace', ['ri.health.main.check.1', '--spec', 's.yaml']],
  ['orchestration schedules replace', [SCHEDULE, ACTION, '--apply']],
  ['project imports remove', ['ri.compass.main.project.1', '--import', 'ri.magritte..source.1']],
  ['project remove-orgs', ['ri.compass.main.project.1', '--org', 'acme']],
  ['repository imports remove', [REPO, '--branch', 'agent-x', '--source', 'ri.magritte..source.1']],
  ['dev-console scope remove', ['ri.workshop.main.module.1', '--object-type', 'Vessel']],
  ['media-sets input-schema remove', ['ri.mediaset.main.mediaset.1', '--format', 'video/x-msvideo']],
  ['connectivity code-import remove-importer', [REPO, '--source', 'ri.magritte..source.1']],
  ['resource remove-markings', ['ri.compass.main.folder.1', '--marking', 'restricted']],
  ['resource-role revoke', ['ri.compass.main.folder.1', '--role', 'OWNER', '--principal', 'u:zay']],
  ['branch-protection repo unprotect', [REPO, 'agent-x']],
  ['workshop module revert', ['ri.workshop.main.module.1', '--version', '3']],
  ['solution-design node remove', ['ri.diagram.main.diagram.1', '--node', 'n1']],
  ['solution-design edge remove', ['ri.diagram.main.diagram.1', '--edge', 'e1']],
  ['admin group member remove', ['ri.group.main.g1', '--user', 'zay']],
  ['admin marking replace', ['marking-1', 'Restricted']],
  ['global-branch remove-repo', [GLOBAL, REPO]],
  ['global-branch remove-resources', [GLOBAL, DATASET]],
  ['repository checks required remove', [REPO, '--branch', 'agent-x', '--check', 'ci/publish']],
  // A verb no 0.7.11 command uses: a rename into the table is read at once.
  // These four are the names the parity cycle (FND-17) reported; measured
  // against the released 0.7.11 manifest none of them is a command today, so
  // they pin the table rather than the surface.
  ['warehouse snapshot purge', [DATASET]],
  ['orchestration job discard', ['ri.jemma.main.build.1']],
  ['ontology resource purge', ['ri.compass.main.folder.1']],
  ['connectivity sync repair', ['ri.magritte..source.1']],
  // What the rule already read, so the widening cannot quietly drop it.
  ['dataset files delete', [DATASET, '--branch', 'agent-x', '--path', 'a.csv']],
  ['resource delete', ['ri.compass.main.folder.1']],
  ['resource permanently-delete', ['ri.compass.main.folder.1']],
  ['ontology object-type-delete', ['Vessel', '--branch', GLOBAL]],
]

/** Writes the ladder must keep running in allow-edits: an ordinary change, or a
 * stop or a recovery that erases nothing. The third item is the branches read
 * from a stored schedule or import (`orchestration schedules unpause` starts one,
 * so the guard reads its branch from the schedule). */
const ORDINARY: [string, string[], readonly string[]?][] = [
  ['dataset create', ['people']],
  ['dataset schema set', [DATASET, '--branch', 'agent-x', '--schema', 's.json']],
  ['workshop module update', ['ri.workshop.main.module.1', '--branch', 'agent-x']],
  ['automate pause', ['ri.automate.main.automation.1', '--branch', 'agent-x']],
  ['orchestration schedules unpause', [SCHEDULE], [WORK_BRANCH]],
  ['proposal close', ['ri.pull-request.main.pull-request.1']],
  ['global-proposal close', ['ri.proposal.main.proposal.1']],
  ['global-branch close', [GLOBAL]],
  ['global-branch reopen', [GLOBAL]],
  ['global-branch rename', [GLOBAL, 'agent-old', 'agent-new']],
  ['marketplace job cancel', ['ri.marketplace.main.job.1']],
  ['orchestration builds cancel', ['ri.jemma.main.build.1']],
  ['repository checks cancel', [REPO, '--branch', 'agent-x']],
  ['sql cancel', ['ri.sql.main.query.1']],
  ['repository checks rerun', [REPO, '--branch', 'agent-x', '--all']],
  ['resource restore', ['ri.compass.main.folder.1']],
  ['devops product undeprecate', ['ri.devops.main.product.1']],
  ['marketplace installation create', ['ri.marketplace.main.version.1']],
  ['marketplace installation upgrade', [INSTALLATION, '--mode', 'keep-outputs']],
  ['devops draft set', ['ri.devops.main.draft.1', '--resource', 'ri.compass.main.folder.1']],
  // A stop is no erasure: `compute manage --action stop` halts a running
  // module, which `--action start` undoes. Orthanc wants --yes for it.
  ['compute manage', ['--deployed-app-rid', 'ri.foundry.main.deployed-app.1', '--branch', 'agent-x', '--action', 'stop', '--yes']],
]

const outcomes = (command: string, args: string[], stored?: readonly string[]) =>
  MODES.map(mode => ladderDecision(mode, classifyCall(CLI, { command, args }, MANIFEST, 'agent/x', stored)!, approve).outcome)
const isDestructive = (command: string, args: string[], stored?: readonly string[]) =>
  classifyCall(CLI, { command, args }, MANIFEST, 'agent/x', stored)?.isDestructive

for (const [command, args] of DESTRUCTIVE) {
  test(`D1 D2: '${command}' asks outside yolo and runs in yolo`, async () => {
    expect(isDestructive(command, args)).toBe(true)
    expect({ command, outcomes: outcomes(command, args) }).toEqual({ command, outcomes: ['ask', 'ask', 'ask', 'run'] })
  })
}

for (const [command, args, stored] of ORDINARY) {
  test(`D3: '${command}' is no ask in allow-edits`, async () => {
    expect({ command, destructive: isDestructive(command, args, stored) }).toEqual({ command, destructive: false })
    expect({ command, outcomes: outcomes(command, args, stored) }).toEqual({ command, outcomes: ['ask', 'run', 'run', 'run'] })
  })
}

test('D4: a read-only entry named like a removal never reaches the ladder', async () => {
  expect(classifyCall(CLI, { command: 'resource delete-impact', args: ['ri.compass.main.folder.1'] }, MANIFEST, 'agent/x')).toBe(null)
  expect(classifyCall(CLI, { command: 'connectivity sync list', args: ['ri.magritte..source.1'] }, MANIFEST, 'agent/x')).toBe(null)
})

test('D5: a flag whose name holds a destructive word but erases nothing is no ask', async () => {
  for (const args of [
    ['--branch', 'agent-x', '--abort-on-failure'],
    ['--abort-on-failure', '--branch', 'agent-x'],
    ['--ABORT-ON-FAILURE', '--branch', 'agent-x'],
    ['--abort-on-failure=true', '--branch', 'agent-x'],
  ]) {
    expect({ args, destructive: isDestructive('orchestration builds create', args) }).toEqual({ args, destructive: false })
    expect({ args, outcomes: outcomes('orchestration builds create', args) }).toEqual({ args, outcomes: ['ask', 'run', 'run', 'run'] })
  }
  for (const args of [['--no-remove-check', 'ri.health.main.check.1'], ['--remove-check', 'ri.health.main.check.1', '--keep-data']]) {
    const negated = classifyCall(CLI, { command: 'data-health check-group update', args: [args[0]!, ...args.slice(1)] }, MANIFEST, 'agent/x')
    expect({ args, destructive: negated?.isDestructive }).toEqual({ args, destructive: args[0] !== '--no-remove-check' })
  }
})

test('D6: a flag that erases asks, in any case, as =value, at any position', async () => {
  for (const [command, args] of [
    ['data-health check-group update', ['ri.health.main.group.1', '--remove-check', 'ri.health.main.check.1']],
    ['devops draft set', ['ri.devops.main.draft.1', '--remove-resource', 'ri.compass.main.folder.1']],
    ['global-branch roles set', [GLOBAL, '--principal', 'u:zay', '--remove']],
    ['proposal request-review', ['ri.proposal.main.proposal.1', '--remove', 'u:zay']],
    ['marketplace installation uninstall', [INSTALLATION, '--delete-project']],
  ] as [string, string[]][]) {
    expect({ command, args, destructive: isDestructive(command, args) }).toEqual({ command, args, destructive: true })
    expect({ command, args, outcomes: outcomes(command, args) }).toEqual({ command, args, outcomes: ['ask', 'ask', 'ask', 'run'] })
  }
  // The same flags spelled with a value, in another case, with other words first.
  for (const args of [
    ['--remove-check=ri.health.main.check.1', 'ri.health.main.group.1'],
    ['ri.health.main.group.1', '--REMOVE-CHECK=ri.health.main.check.1'],
    ['ri.health.main.group.1', '--add-check', 'ri.health.main.check.2', '--remove-check', 'ri.health.main.check.1'],
  ]) {
    expect({ args, destructive: isDestructive('data-health check-group update', args) }).toEqual({ args, destructive: true })
  }
  // A flag a later orthanc could add (`--discard-passes`, reported by FND-17 and
  // not on 0.7.11) is read the day it appears, on a command whose own name is
  // no claim.
  expect(isDestructive('repository checks rerun', [REPO, '--branch', 'agent-x', '--discard-passes'])).toBe(true)
})

test('D7: the words are read when the manifest does not list them, and when they split across command and args', async () => {
  const unknown: ManifestCommand[] = [{ path: 'marketplace installation list', kind: 'read-only' }]
  expect(classifyCall(CLI, { command: 'catalog archive destroy', args: ['ri.compass.main.folder.1'] }, unknown, 'agent/x')?.isDestructive).toBe(true)
  // A name that puts the verb first, as no 0.7.11 command does.
  expect(classifyCall(CLI, { command: 'remove resource', args: ['ri.compass.main.folder.1'] }, unknown, 'agent/x')?.isDestructive).toBe(true)
  expect(destructiveTermIn('remove resource') === null).toBe(false)
  expect(classifyCall(CLI, { command: 'marketplace', args: ['installation', 'uninstall', INSTALLATION] }, MANIFEST, 'agent/x')?.isDestructive).toBe(true)
  expect(classifyCall(CLI, { command: 'MARKETPLACE Installation Uninstall', args: [INSTALLATION] }, MANIFEST, 'agent/x')?.isDestructive).toBe(true)
  expect(outcomes('marketplace', ['installation', 'uninstall', INSTALLATION])).toEqual(['ask', 'ask', 'ask', 'run'])
})

test('D8: a branch name, a positional or a flag value spelling a destructive word is no ask', async () => {
  for (const [command, args] of [
    ['dataset create', ['remove']],
    ['dataset create', ['--branch', 'delete-me']],
    ['dataset create', ['--branch', 'agent-x', '--description', 'a delete of the old rows']],
    ['marketplace installation upgrade', [INSTALLATION, '--mode', 'keep-outputs']],
    ['orchestration builds create', ['--branch', 'agent-x', '--job', 'revert']],
  ] as [string, string[]][]) {
    expect({ command, args, destructive: isDestructive(command, args) }).toEqual({ command, args, destructive: false })
  }
})

test('D9: the branch rule still blocks a destructive write; the ask does not loosen a block', async () => {
  const blocked = MODES.map(mode =>
    ladderDecision(mode, classifyCall(CLI, { command: 'repository imports remove', args: [REPO, '--allow-default-branch', '--source', 'ri.magritte..source.1'] }, MANIFEST, 'agent/x')!, approve).outcome,
  )
  expect(blocked).toEqual(['block', 'block', 'block', 'block'])
  // A destructive name does not make an unreadable branch run, or ask instead
  // of block: the schedule action must name the branch its builds write.
  const branchless = MODES.map(mode =>
    ladderDecision(mode, classifyCall(CLI, { command: 'orchestration schedules replace', args: [SCHEDULE, '{"type":"build"}', '--apply'] }, MANIFEST, 'agent/x')!, approve).outcome,
  )
  expect(branchless).toEqual(['block', 'block', 'block', 'block'])
  // A write naming main asks in yolo too: the destructive rule does not make it run.
  const onMain = classifyCall(CLI, { command: 'streams stream reset', args: [DATASET, '--branch', 'master'] }, MANIFEST, 'agent/x')
  expect(MODES.map(mode => ladderDecision(mode, onMain!, approve).outcome)).toEqual(['ask', 'ask', 'ask', 'ask'])
  // A branch creation is pre-authorized: `dataset branches create` erases nothing.
  const created = classifyCall(CLI, { command: 'dataset branches create', args: [DATASET, '--name', 'agent-x'] }, MANIFEST, 'agent/x')
  expect(created?.isDestructive).toBe(false)})

test('D10: --force still asks, the ask reason names the command, and the MCP lane reads the same words', async () => {
  const forced = classifyCall(CLI, { command: 'dataset create', args: ['people', '--force'] }, MANIFEST, 'agent/x')
  expect(forced?.isDestructive).toBe(true)
  for (const mode of ['ask-always', 'allow-edits', 'auto'] as const) {
    expect(ladderDecision(mode, forced!, approve).reason).toContain('destructive mutation')
  }
  expect(ladderDecision('yolo', forced!, approve).outcome).toBe('run')
  expect(modeGuidance('yolo')).toContain('--force')
  // A widened name carries the same reason, so the operator sees the same kind
  // of ask for an uninstall as for a delete.
  const uninstalled = classifyCall(CLI, { command: 'marketplace installation uninstall', args: [INSTALLATION] }, MANIFEST, 'agent/x')
  expect(ladderDecision('allow-edits', uninstalled!, approve).reason).toContain("destructive mutation 'marketplace installation uninstall'")
  // A Palantir MCP write is blocked either way; the words say whether it reads
  // as destructive too, and a name mixing a read verb with a destructive word
  // is not let through as a read.
  const mcpDelete = classifyCall('mcp__palantir__delete_object', {}, MANIFEST, 'agent/x')
  const mcpUninstall = classifyCall('mcp__palantir__marketplace-uninstall', {}, MANIFEST, 'agent/x')
  expect([mcpDelete?.isDestructive, mcpUninstall?.isDestructive]).toEqual([true, true])
  expect(classifyCall('mcp__palantir__get_object', {}, MANIFEST, 'agent/x')).toBe(null)
  expect([classifyMcpIntent('get_object'), classifyMcpIntent('get_uninstall_plan'), classifyMcpIntent('search_reset_history')]).toEqual([
    'read',
    'write',
    'write',
  ])
})

// The term table's effect on every command name of the tied 0.7.11 surface that
// carries a word in it, or a word a reader could mistake for one. The names are
// copied from hooks/orthanc-snapshot.json; each verdict was read against that
// command's own description in the released agent-manifest, so this pins the
// table's meaning and not the table: adding or dropping a term flips a line.
const SURFACE: [string, boolean][] = [
  ['admin group delete', true],
  ['admin group member remove', true],
  ['admin marking replace', true],
  ['admin org replace', true],
  ['alias clear', true],
  ['alias remove', true],
  ['auth delete', true],
  ['branch-protection project policy delete', true],
  ['branch-protection repo unprotect', true],
  ['connectivity code-import remove-importer', true],
  ['connectivity import delete', true],
  ['data-health check delete', true],
  ['data-health check replace', true],
  ['data-health check-group delete', true],
  ['dataset branches delete', true],
  ['dataset files delete', true],
  ['dataset transactions abort', true],
  ['dev-console scope remove', true],
  ['devops draft abort', true],
  ['global-branch remove-repo', true],
  ['global-branch remove-resources', true],
  ['marketplace installation uninstall', true],
  ['media-sets input-schema remove', true],
  ['models deployment delete', true],
  ['ontology action-type-delete', true],
  ['ontology interface-delete', true],
  ['ontology link-type-delete', true],
  ['ontology object-type-delete', true],
  ['ontology object-type-guarded-delete', true],
  ['ontology shared-property-delete', true],
  ['ontology type-group-delete', true],
  ['orchestration schedules delete', true],
  ['orchestration schedules replace', true],
  ['project imports remove', true],
  ['project remove-orgs', true],
  ['repository branch delete', true],
  ['repository checks required remove', true],
  ['repository imports remove', true],
  ['resource delete', true],
  ['resource permanently-delete', true],
  ['resource remove-markings', true],
  ['resource-role revoke', true],
  ['solution-design delete', true],
  ['solution-design edge remove', true],
  ['solution-design node remove', true],
  ['space delete', true],
  ['streams stream reset', true],
  ['workshop module delete', true],
  ['workshop module revert', true],
  // A word like one in the table, in the same shape, meaning something else.
  ['admin group member add', false],
  ['automate pause', false],
  ['automate unmute', false],
  ['configure profile set', false],
  ['dataset schema set', false],
  ['dataset transactions commit', false],
  ['devops draft publish', false],
  ['devops product undeprecate', false],
  ['global-branch close', false],
  ['global-branch deploy', false],
  ['global-branch mark-inactive', false],
  ['global-branch reopen', false],
  ['marketplace installation create', false],
  ['marketplace installation upgrade', false],
  ['marketplace job cancel', false],
  ['orchestration builds cancel', false],
  ['orchestration builds create', false],
  ['orchestration schedules unpause', false],
  ['proposal close', false],
  ['proposal request-review', false],
  ['repository checks cancel', false],
  ['repository checks required set', false],
  ['repository checks rerun', false],
  ['repository pull-request close', false],
  ['resource restore', false],
  ['streams stream publish', false],
  ['streams stream publish-batch', false],
  ['workshop module update', false],
]

test('the term table reads the 0.7.11 surface by what each write leaves gone', async () => {
  for (const [path, destructive] of SURFACE) {
    expect({ path, term: destructiveTermIn(path) !== null }).toEqual({ path, term: destructive })
  }
})

// ---------------------------------------------------------------------------
// E1-E3: through the real hook, on a synthetic stack (the same engine seams
// yolo.test.ts uses). The widening must reach the operator, and must cost no
// prompt where it has nothing to say.
// ---------------------------------------------------------------------------
type Mode = 'ask-always' | 'allow-edits' | 'auto' | 'yolo'
const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const E2E_MANIFEST = envelope({
  commands: [
    { path: 'configure list', kind: 'local' },
    { path: 'ontology list', kind: 'read-only' },
    { path: 'marketplace installation uninstall', kind: 'mutation' },
    { path: 'streams stream reset', kind: 'mutation' },
    { path: 'data-health check-group update', kind: 'mutation' },
    { path: 'orchestration builds create', kind: 'mutation' },
    { path: 'resource delete', kind: 'mutation' },
  ],
})

function rig(on: On, mode: Mode) {
  const h = { ran: [] as string[], asked: [] as string[], answer: 'Approve' as string | 'throw' }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  on('process.run', (_$, e) => {
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    const line = words.join(' ')
    // The stack lookups and the version probe the plugin makes for itself: what
    // is counted here is a write.
    if (!['agent-manifest', 'configure list', 'version'].includes(line) && e.argv[0] !== 'git') h.ran.push(line)
    if (line === 'agent-manifest') return reply(E2E_MANIFEST)
    if (line === 'version') return reply('orthanc 0.7.11\n')
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
    if (e.argv[0] === 'git') return reply('origin\thttps://tester.example.com/stemma/git/ri.stemma.main.repository.x/repo.git (push)\n')
    return reply(envelope({ ran: line }))
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } as never }))
  on('fs.read', (_$, e) => {
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('ui.open', () => ({ value: { isPlaced: false, reason: 'test: no surface' } }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('model.complete', () => ({ value: { isAnswered: true, text: '{"action":"approve","reason":"routine branch work"}' } }) as never)
  on('classic.SubagentStart', () => ({}))
  on('tool.call', (_$, e) => {
    const call = e as unknown as { tool: string; questions?: { question: string }[] }
    if (call.tool !== 'AskUserQuestion') return { result: 'ran' } as never
    const question = call.questions?.[0]?.question ?? ''
    h.asked.push(question)
    if (h.answer === 'throw') throw new Error('test: no one to ask')
    return { result: { questions: call.questions, answers: { [question]: h.answer } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const write = ($: Engine, command: string, args: string[]) => $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string }>
const UNINSTALL = [INSTALLATION, '--mode', 'delete', '--apply']
const BUILD = [JSON.stringify({ type: 'build', target: { type: 'manual', targetRids: [] }, branchName: WORK_BRANCH }), '--branch', WORK_BRANCH, '--abort-on-failure', '--apply']

for (const mode of ['allow-edits', 'auto'] as Mode[]) {
  test(`E1: in ${mode} mode an uninstall asks the operator by name; declined, or no one to ask, it does not run; approved, it runs`, async ($, on) => {
    const h = rig(on, mode)
    for (const answer of ['Decline', 'throw'] as (string | 'throw')[]) {
      h.answer = answer
      const before = h.asked.length
      const wrote = await write($, 'marketplace installation uninstall', UNINSTALL)
      expect({ answer, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ answer, denied: true, asked: 1 })
    }
    expect(h.asked[0]).toContain("'marketplace installation uninstall'")
    expect(h.asked[0]).toContain('destructive')
    expect(h.ran.filter(line => line.startsWith('marketplace installation uninstall'))).toEqual([])
    h.answer = 'Approve'
    expect((await write($, 'marketplace installation uninstall', UNINSTALL)).deny).toBe(undefined)
    expect(h.ran.filter(line => line.startsWith('marketplace installation uninstall'))).toEqual([`marketplace installation uninstall ${UNINSTALL.join(' ')}`])
  })
}

for (const mode of ['allow-edits', 'auto'] as Mode[]) {
  test(`E2: in ${mode} mode the widening asks nothing where nothing is erased`, async ($, on) => {
    const h = rig(on, mode)
    h.answer = 'throw'
    for (const [command, args] of [
      ['orchestration builds create', BUILD],
      ['data-health check-group update', ['ri.health.main.group.1', '--no-remove-check', 'ri.health.main.check.1', '--apply']],
      ['data-health check-group update', ['ri.health.main.group.1', '--add-check', 'ri.health.main.check.1', '--apply']],
    ] as [string, string[]][]) {
      const wrote = await write($, command, args)
      expect({ command, args, deny: wrote.deny }).toEqual({ command, args, deny: undefined })
    }
    expect(h.asked).toEqual([])
    expect(h.ran.length).toBe(3)
  })
}

test('E3: in yolo an uninstall, a stream reset and a delete run with no dialog', async ($, on) => {
  const h = rig(on, 'yolo')
  h.answer = 'throw'
  for (const [command, args] of [
    ['marketplace installation uninstall', UNINSTALL],
    ['streams stream reset', [DATASET, '--branch', 'agent-x', '--apply']],
    ['resource delete', ['ri.compass.main.folder.1', '--apply']],
  ] as [string, string[]][]) {
    expect({ command, deny: (await write($, command, args)).deny }).toEqual({ command, deny: undefined })
  }
  expect(h.asked).toEqual([])
  expect(h.ran.length).toBe(3)
})
