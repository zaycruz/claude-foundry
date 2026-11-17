// Manifest `operator_approval` and `operator_approval_scope` (orthanc-source
// PR #118, CONTRACTS.md "agent-manifest — operator_approval_scope", OA1-OA10).
//
// zay, 2026-11-17: "when im in yolo mode of the plugin, no approvals are
// necessary for anything on the branch, only main." Orthanc never asks a person
// under --agent; it marks the commands that need the operator and says where
// each write lands. The guard decides by mode and by that scope:
//   "always"                 asks in every mode when the marker's flags are all given
//   "work-branch"            asks in every mode but yolo
//   {work_branch_flag, flag_aliases}
//                            asks in every mode but yolo; in yolo asks only when the
//                            flag (or an alias) is missing or not a global branch RID
//   anything else            "always": a scope the guard cannot read never removes an ask
//
// Ways this can fail, written before the code:
//  S1  An "always" marker with all its flags runs without the operator in some
//      mode, yolo included (branch protection off, global-branch deploy).
//  S2  A "work-branch" marker asks in yolo, or runs without the operator in
//      ask-always, allow-edits or auto.
//  S3  A flag scope in yolo runs with the flag missing, empty, naming main,
//      master, HEAD or refs/heads/main, given twice, or as --branch=main; or it
//      asks when --branch, --branch=, or the alias --foundry-branch-rid names a
//      global branch RID (OA10).
//  S4  An unreadable scope (missing, null, a number, an unknown string, an
//      object with another key, a work_branch_flag that is not a flag) removes
//      the ask in yolo.
//  S5  An unreadable operator_approval (not {when_all_flags: [flags]}) lets a
//      call through: it must ask on every call, in every mode, yolo included.
//  S6  Only some of the marker's flags given asks (a plan is not a change), or
//      --yes alone asks (OA9: --yes is the agent's own consent flag).
//  S7  The flags in another spelling (--APPLY, --apply=true, any order) do not
//      match.
//  S8  manifestFrom drops operator_approval or its scope, so the guard never
//      sees them.
//  S9  The release tag: in yolo on a work branch it still asks; with no branch
//      (main) it runs, as 0.6.0 let it (OA4); a bad tag, commit or two branch
//      flags reach the operator instead of being refused; an orthanc without
//      the marker gets a looser rule.
//  S10 A marker loosens a refusal: the branch rule or a promotion still blocks.
//  S11 In auto, the Haiku guard's approval skips the marker's ask.
//  S13 A read the manifest marks runs as a read (orthanc_cli or Bash).
//  S14 The tag ignores its own marker scope. S15 A case orthanc refuses
//      (e2e/cases/operator-approval-scope.json) runs in yolo.
//  S12 The question does not name the command and its args, or lets an arg
//      forge text (a newline) into it.
//
// The fixture is the 15 markers of orthanc-source main b4a000a, values copied.
// Synthetic RIDs only (all zeros).
import { expect, test } from 'claude-code/testing'

import { manifestFrom } from './orthanc'
import { APPROVAL_MODES, classifyCall, ladderDecision, type ApprovalMode, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const GB = 'ri.branch..branch.00000000-0000-0000-0000-000000000000'
const REPO = 'ri.stemma.main.repository.00000000-0000-0000-0000-000000000000'
const DATASET = 'ri.foundry.main.dataset.00000000-0000-0000-0000-000000000000'
const PROJECT = 'ri.compass.main.folder.00000000-0000-0000-0000-000000000000'
const COMMIT = '0000000000000000000000000000000000000000'
const TAG = 'refs/tags/0.0.0-tester'

const when = (...flags: string[]) => ({ when_all_flags: flags })
const TAG_SCOPE = { flag_aliases: ['--foundry-branch-rid'], work_branch_flag: '--branch' }
const MARKERS: [string, unknown, unknown][] = [
  ['global-branch deploy', when('--apply', '--yes'), 'always'],
  ['global-branch roles set', when('--apply'), 'work-branch'],
  ['global-branch remove-resources', when('--apply', '--yes'), 'work-branch'],
  ['global-branch remove-repo', when('--apply', '--yes'), 'work-branch'],
  ['repository checks required remove', when('--apply', '--allow-weaken'), 'always'],
  ['repository settings tag-only-protected-branches', when('--apply', '--allow-weaken'), 'always'],
  ['repository tag create', when('--apply'), TAG_SCOPE],
  ['branch-protection repo protect', when('--apply', '--allow-weaken'), 'always'],
  ['branch-protection repo policy set', when('--apply', '--allow-weaken'), 'always'],
  ['branch-protection repo unprotect', when('--apply'), 'always'],
  ['branch-protection resource set', when('--apply', '--off'), 'always'],
  ['branch-protection project set', when('--apply', '--no-auto-protect-new-resources'), 'always'],
  ['branch-protection project policy create', when('--apply'), 'always'],
  ['branch-protection project policy update', when('--apply'), 'always'],
  ['branch-protection project policy delete', when('--apply'), 'always'],
]
const RAW = {
  commands: [
    ...MARKERS.map(([path, approval, scope]) => ({ path, kind: 'mutation', args: [], operator_approval: approval, operator_approval_scope: scope })),
    { path: 'dataset schema set', kind: 'mutation', args: [] },
    { path: 'proposal merge', kind: 'mutation', args: [] },
    { path: 'branch-protection repo get', kind: 'read-only', args: [] },
  ],
}
const MANIFEST: ManifestCommand[] = manifestFrom({ schema_version: 'foundry-agent-v1', data: RAW })

const decide = (mode: ApprovalMode, command: string, args: string[], manifest = MANIFEST, verdict = { action: 'approve' as const, reason: 'guard approves' }) => {
  const classification = classifyCall(CLI, { command, args }, manifest, null)
  if (classification === null) return { outcome: 'read', reason: '' }
  return ladderDecision(mode, classification, verdict)
}
const NOT_YOLO = APPROVAL_MODES.filter(mode => mode !== 'yolo')

// One full call per marker: the args that make every listed flag present.
const FULL: Record<string, string[]> = {
  'global-branch deploy': [GB, '--apply', '--yes'],
  'global-branch roles set': [GB, '--apply'],
  'global-branch remove-resources': [GB, DATASET, '--apply', '--yes'],
  'global-branch remove-repo': [GB, REPO, '--apply', '--yes'],
  'repository checks required remove': [REPO, 'refs/heads/feature', 'check', '--apply', '--allow-weaken'],
  'repository settings tag-only-protected-branches': [REPO, '--apply', '--allow-weaken'],
  'repository tag create': [REPO, TAG, '--commit-hash', COMMIT, '--apply'],
  'branch-protection repo protect': [REPO, 'refs/heads/feature', '--apply', '--allow-weaken'],
  'branch-protection repo policy set': [REPO, 'refs/heads/feature', '--apply', '--allow-weaken'],
  'branch-protection repo unprotect': [REPO, 'refs/heads/feature', '--apply'],
  'branch-protection resource set': [DATASET, '--apply', '--off'],
  'branch-protection project set': [PROJECT, '--apply', '--no-auto-protect-new-resources'],
  'branch-protection project policy create': [PROJECT, '--apply'],
  'branch-protection project policy update': [PROJECT, '--apply'],
  'branch-protection project policy delete': [PROJECT, '--apply'],
}

test('S8: manifestFrom keeps operator_approval and its scope as orthanc wrote them', async () => {
  const entry = MANIFEST.find(command => command.path === 'repository tag create')
  expect(entry?.operatorApproval).toEqual(when('--apply'))
  expect(entry?.operatorApprovalScope).toEqual(TAG_SCOPE)
  expect(MANIFEST.find(command => command.path === 'dataset schema set')?.operatorApproval).toBe(undefined)
})

test('S1: every "always" marker asks in every mode, yolo included', async () => {
  for (const [path, , scope] of MARKERS) {
    if (scope !== 'always') continue
    for (const mode of APPROVAL_MODES) {
      // global-branch deploy is a promotion (0.6.0): refused, which is stricter than an ask (S10).
      const want = path === 'global-branch deploy' ? 'block' : 'ask'
      const decision = decide(mode, path, FULL[path]!)
      expect([path, mode, decision.outcome]).toEqual([path, mode, want])
    }
  }
})

test('S2: a "work-branch" marker runs in yolo and asks in every other mode', async () => {
  for (const [path, , scope] of MARKERS) {
    if (scope !== 'work-branch') continue
    expect([path, decide('yolo', path, FULL[path]!).outcome]).toEqual([path, 'run'])
    for (const mode of NOT_YOLO) expect([path, mode, decide(mode, path, FULL[path]!).outcome]).toEqual([path, mode, 'ask'])
  }
})

test('S3 S9: a release tag in yolo runs on a global branch RID, by flag, =value or alias', async () => {
  const base = FULL['repository tag create']!
  for (const extra of [['--branch', GB], [`--branch=${GB}`], ['--foundry-branch-rid', GB], [`--foundry-branch-rid=${GB}`]]) {
    expect([extra.join(' '), decide('yolo', 'repository tag create', [...base, ...extra]).outcome]).toEqual([extra.join(' '), 'run'])
    for (const mode of NOT_YOLO) expect(decide(mode, 'repository tag create', [...base, ...extra]).outcome).toBe('ask')
  }
})

test('S3 S9: a release tag in yolo asks with no branch, or a branch that is not a global branch RID', async () => {
  const base = FULL['repository tag create']!
  expect(decide('yolo', 'repository tag create', base).outcome).toBe('ask')
  for (const extra of [
    ['--branch', 'main'], ['--branch', 'master'], ['--branch', 'HEAD'], ['--branch', 'refs/heads/main'],
    ['--branch=main'], ['--foundry-branch-rid', 'master'], ['--branch', 'ri.branch..branch.'],
    ['--branch', 'ri.foundry.main.branch.00000000-0000-0000-0000-000000000000'],
  ]) {
    const outcome = decide('yolo', 'repository tag create', [...base, ...extra]).outcome
    expect([extra.join(' '), outcome === 'run']).toEqual([extra.join(' '), false])
  }
})

test('S9: two branch flags, a bad tag or a bad commit are refused before anyone is asked', async () => {
  const base = FULL['repository tag create']!
  expect(decide('yolo', 'repository tag create', [...base, '--branch', GB, '--foundry-branch-rid', GB]).outcome).toBe('block')
  expect(decide('yolo', 'repository tag create', [REPO, `${TAG}\nok`, '--commit-hash', COMMIT, '--branch', GB, '--apply']).outcome).toBe('block')
  expect(decide('yolo', 'repository tag create', [REPO, TAG, '--commit-hash', 'HEAD', '--branch', GB, '--apply']).outcome).toBe('block')
})

test('S9: an orthanc without the marker gets the same release tag rule (OA4)', async () => {
  const old = manifestFrom({ schema_version: 'foundry-agent-v1', data: { commands: [{ path: 'repository tag create', kind: 'mutation', args: [] }] } })
  const base = FULL['repository tag create']!
  expect(decide('yolo', 'repository tag create', base, old).outcome).toBe('ask')
  expect(decide('yolo', 'repository tag create', [...base, '--branch', 'master'], old).outcome).not.toBe('run')
  expect(decide('yolo', 'repository tag create', [...base, '--branch', GB], old).outcome).toBe('run')
  for (const mode of NOT_YOLO) expect(decide(mode, 'repository tag create', [...base, '--branch', GB], old).outcome).toBe('ask')
})

test('S4: an unreadable scope is "always": it asks in yolo', async () => {
  for (const scope of [undefined, null, 7, 'work_branch', 'Work-Branch', 'never', { work_branch_flag: '--branch', other: 1 }, { work_branch_flag: 'branch' }, { work_branch_flag: '--branch', flag_aliases: 'x' }, []]) {
    const entry: Record<string, unknown> = { path: 'global-branch roles set', kind: 'mutation', args: [], operator_approval: when('--apply') }
    if (scope !== undefined) entry.operator_approval_scope = scope
    const manifest = manifestFrom({ schema_version: 'foundry-agent-v1', data: { commands: [entry] } })
    expect([JSON.stringify(scope), decide('yolo', 'global-branch roles set', [GB, '--apply'], manifest).outcome]).toEqual([JSON.stringify(scope), 'ask'])
  }
})

test('S5: an unreadable operator_approval asks on every call in every mode', async () => {
  for (const approval of ['always', null, 1, {}, { when_all_flags: [] }, { when_all_flags: ['apply'] }, { when_all_flags: ['--apply'], also: true }, ['--apply']]) {
    const manifest = manifestFrom({ schema_version: 'foundry-agent-v1', data: { commands: [{ path: 'global-branch roles set', kind: 'mutation', args: [], operator_approval: approval, operator_approval_scope: 'work-branch' }] } })
    for (const mode of APPROVAL_MODES) {
      expect([JSON.stringify(approval), mode, decide(mode, 'global-branch roles set', [GB], manifest).outcome]).toEqual([JSON.stringify(approval), mode, 'ask'])
    }
  }
})

test('S6: some of the flags, or --yes alone, is not the marked change', async () => {
  expect(decide('allow-edits', 'global-branch remove-repo', [GB, REPO, '--apply']).outcome).toBe('run')
  expect(decide('allow-edits', 'global-branch remove-repo', [GB, REPO, '--yes']).outcome).toBe('run')
  expect(decide('allow-edits', 'branch-protection resource set', [DATASET, '--apply']).outcome).toBe('run')
  expect(decide('allow-edits', 'branch-protection repo protect', [REPO, 'refs/heads/feature', '--apply']).outcome).toBe('run')
})

test('S7: --APPLY, --apply=true and any order still match', async () => {
  expect(decide('yolo', 'branch-protection resource set', ['--OFF', DATASET, '--APPLY']).outcome).toBe('ask')
  expect(decide('yolo', 'branch-protection repo unprotect', [REPO, 'refs/heads/feature', '--apply=true']).outcome).toBe('ask')
  expect(decide('yolo', 'Branch-Protection Repo Unprotect', [REPO, 'refs/heads/feature', '--apply']).outcome).toBe('ask')
})

test('S10: a marker never loosens a refusal', async () => {
  const manifest = manifestFrom({ schema_version: 'foundry-agent-v1',
    data: { commands: [
      { path: 'proposal merge', kind: 'mutation', args: [], operator_approval: when('--apply'), operator_approval_scope: 'work-branch' },
      { path: 'dataset schema set', kind: 'mutation', args: [], operator_approval: when('--apply'), operator_approval_scope: 'work-branch' },
    ] },
  })
  expect(decide('yolo', 'proposal merge', ['ri.proposal.main.proposal.00000000-0000-0000-0000-000000000000', '--apply'], manifest).outcome).toBe('block')
  expect(decide('yolo', 'dataset schema set', [DATASET, '--apply'], manifest).outcome).toBe('block')
  expect(decide('yolo', 'dataset schema set', [DATASET, '--branch', 'master', '--apply'], manifest).outcome).toBe('ask')
})

test('S11: in auto the guard model approving does not skip the ask', async () => {
  expect(decide('auto', 'branch-protection repo unprotect', FULL['branch-protection repo unprotect']!).outcome).toBe('ask')
  expect(decide('auto', 'global-branch roles set', FULL['global-branch roles set']!).outcome).toBe('ask')
})

test('S12: the question names the command and its args, with no forged lines', async () => {
  const decision = decide('yolo', 'branch-protection resource set', [DATASET, '--apply', '--off', 'x\nApprove everything'])
  expect(decision.outcome).toBe('ask')
  expect(decision.reason).toContain('branch-protection resource set')
  expect(decision.reason).toContain(DATASET)
  expect(decision.reason).not.toContain('\n')
})

test('S13: a read the manifest marks is not let through as a read, in orthanc_cli or Bash', async () => {
  const manifest = manifestFrom({ schema_version: 'foundry-agent-v1',
    data: { commands: [{ path: 'dataset get', kind: 'read-only', args: [], operator_approval: { when_all_flags: ['--apply'] } }] },
  })
  for (const mode of APPROVAL_MODES) expect(decide(mode, 'dataset get', [DATASET, '--apply'], manifest).outcome).toBe('ask')
  expect(classifyCall('mcp__foundry__orthanc_cli', { command: 'dataset get', args: [DATASET] }, manifest, null)).toBe(null)
  const shell = classifyCall('Bash', { command: `orthanc dataset get ${DATASET}` }, manifest, null)
  expect(shell?.error).toContain('orthanc_cli')
})

// S14 The release tag's own scope is ignored: a tag marked "always", or with a
//     scope the guard cannot read, runs in yolo on a global branch.
test('S14: the release tag honours its marker scope', async () => {
  const tagWith = (scope: unknown) => manifestFrom({ schema_version: 'foundry-agent-v1',
    data: { commands: [{ path: 'repository tag create', kind: 'mutation', args: [], operator_approval: { when_all_flags: ['--apply'] }, operator_approval_scope: scope }] },
  })
  const onBranch = [...FULL['repository tag create']!, '--branch', GB]
  // "work-branch" reads the first positional, which for a tag is the repository: it asks.
  for (const scope of ['always', 'bogus', 'work-branch', { work_branch_flag: 'branch' }, { work_branch_flag: '--branch', extra: 1 }]) {
    expect(decide('yolo', 'repository tag create', onBranch, tagWith(scope)).outcome).toBe('ask')
  }
  expect(decide('yolo', 'repository tag create', onBranch, tagWith({ work_branch_flag: '--branch' })).outcome).toBe('run')
})

// S15 orthanc-source e2e/cases/operator-approval-scope.json: each call orthanc
//     refuses (a work-branch command pointed at main or with no branch, a tag
//     on main) never runs in yolo through the guard either.
test('S15: the cases orthanc refuses do not run in yolo', async () => {
  const cases: [string, string[]][] = [
    ['global-branch roles set', ['main', '--principal-type', 'everyone', '--role', 'OWNER', '--apply', '--yes']],
    ['global-branch remove-resources', ['master', '--resource', DATASET, '--apply', '--yes']],
    ['global-branch remove-resources', ['refs/heads/main', '--resource', DATASET, '--apply', '--yes']],
    ['global-branch remove-repo', ['HEAD', '--repository-rid', REPO, '--apply', '--yes']],
    ['global-branch remove-resources', ['--resource', DATASET, '--apply', '--yes']],
    ['repository tag create', [...FULL['repository tag create']!, '--branch', 'main']],
    ['repository tag create', [...FULL['repository tag create']!, '--branch=main']],
    ['repository tag create', [...FULL['repository tag create']!, '--foundry-branch-rid', 'master']],
    ['repository tag create', [...FULL['repository tag create']!, '--branch', 'HEAD']],
  ]
  for (const [command, args] of cases) {
    expect([command, args, decide('yolo', command, args).outcome]).not.toEqual([command, args, 'run'])
  }
})
