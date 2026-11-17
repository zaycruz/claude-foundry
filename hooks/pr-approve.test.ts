// Orthanc 0.7.7 added `repository pull-request approve`: approve a Foundry code
// pull request as the signed-in user, or --reject, or --withdraw an earlier
// review. An approval is a promotion step, like `proposal approve`: it lets
// work into main under the operator's name. The operator gives it; the agent
// does not. A rejection or a withdrawal lets nothing in, so it is an ordinary
// write and the approval ladder judges it.
//
// Ways this can fail, written before the code:
//  A1  An approve with --apply --expect-head runs, or only asks, in some
//      approval mode (ask-always, allow-edits, auto, yolo).
//  A2  The plan form (no --apply) runs or asks, while `proposal approve` is
//      refused in every form: the two promotions disagree.
//  A3  The approve hides from the check: the path in another case, split
//      across command and args, or written inside the command string.
//  A4  A --reject or --withdraw is refused as if it were an approval, so the
//      agent cannot block a bad pull request or take back its own review.
//  A5  A spelling that only looks like a rejection (--reject=false,
//      --REJECT, a quoted '--reject x') lets an approval through.
//  A6  The refusal does not say the operator approves pull requests.
//  A7  The other promotions loosen: proposal merge, accept or approve run.
//
// Synthetic manifest only; no Foundry stack.
import { expect, test } from 'claude-code/testing'

import { classifyCall, ladderDecision, APPROVAL_MODES, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const REPO = 'ri.stemma.main.repository.e0000000-0000-4000-8000-0000000000e1'
const HEAD = '0123456789abcdef0123456789abcdef01234567'
const MANIFEST: ManifestCommand[] = [
  { path: 'repository pull-request approve', kind: 'mutation' },
  { path: 'repository pull-request approval', kind: 'read-only' },
  { path: 'repository pull-request create', kind: 'mutation' },
  { path: 'proposal approve', kind: 'mutation' },
  { path: 'proposal merge', kind: 'mutation' },
  { path: 'proposal accept', kind: 'mutation' },
]

const decide = (mode: (typeof APPROVAL_MODES)[number], command: string, args: string[]) => {
  const classification = classifyCall(CLI, { command, args }, MANIFEST, null)
  if (classification === null) return { outcome: 'read', reason: '' }
  return ladderDecision(mode, classification, { action: 'approve', reason: 'guard approves' })
}

const APPLY = [REPO, '7', '--apply', '--expect-head', HEAD]

test('A1 A6: an approve apply is refused in every mode, and says the operator approves', async () => {
  for (const mode of APPROVAL_MODES) {
    const decision = decide(mode, 'repository pull-request approve', APPLY)
    expect(decision.outcome).toBe('block')
    expect(decision.reason).toContain('repository pull-request approve')
    expect(decision.reason).toContain('The operator does it')
  }
})

test('A2: the plan form is refused like proposal approve', async () => {
  for (const mode of APPROVAL_MODES) {
    expect(decide(mode, 'repository pull-request approve', [REPO, '7']).outcome).toBe('block')
    expect(decide(mode, 'proposal approve', ['ri.proposal.x']).outcome).toBe('block')
  }
})

test('A3: case, a split path and args in the command string do not hide an approve', async () => {
  expect(decide('yolo', 'Repository Pull-Request APPROVE', APPLY).outcome).toBe('block')
  expect(decide('yolo', 'repository', ['pull-request', 'approve', ...APPLY]).outcome).toBe('block')
  expect(decide('yolo', 'repository pull-request', ['approve', ...APPLY]).outcome).toBe('block')
  expect(decide('yolo', `repository pull-request approve ${REPO} 7 --apply`, []).outcome).toBe('block')
})

test('A4: a rejection or a withdrawal is an ordinary write the ladder judges', async () => {
  for (const flag of ['--reject', '--withdraw']) {
    expect(decide('yolo', 'repository pull-request approve', [...APPLY, flag]).outcome).toBe('run')
    expect(decide('allow-edits', 'repository pull-request approve', [...APPLY, flag]).outcome).toBe('run')
    expect(decide('ask-always', 'repository pull-request approve', [...APPLY, flag]).outcome).toBe('ask')
  }
})

test('A5: spellings that only look like a rejection stay refused', async () => {
  for (const flag of ['--reject=false', '--REJECT', '--withdraw=no', '"--reject x"', '--rejected', '-r']) {
    expect(decide('yolo', 'repository pull-request approve', [...APPLY, flag]).outcome).toBe('block')
  }
})

test('A7: proposal merge, accept and approve stay refused; the approval read stays a read', async () => {
  for (const mode of APPROVAL_MODES) {
    for (const command of ['proposal merge', 'proposal accept', 'proposal approve']) {
      expect(decide(mode, command, ['ri.proposal.x']).outcome).toBe('block')
    }
  }
  expect(decide('yolo', 'repository pull-request approval', [REPO, '7']).outcome).toBe('read')
  expect(decide('yolo', 'repository pull-request create', [REPO, '--source-branch', 'feat/x']).outcome).toBe('run')
})
