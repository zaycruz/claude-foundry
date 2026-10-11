import { expect, test } from 'claude-code/testing'

import { classifyCall, ladderDecision, loopStep, type ManifestCommand, validateBranchName } from './policy'

const MANIFEST: ManifestCommand[] = [
  { path: 'ontology list', kind: 'read-only' },
  { path: 'ontology object-type-delete', kind: 'mutation' },
  { path: 'ontology object-type-upsert', kind: 'mutation' },
  { path: 'dataset create', kind: 'mutation' },
  { path: 'global-branch create', kind: 'mutation' },
  { path: 'repository clone', kind: 'mutation' },
  { path: 'configure list', kind: 'local' },
  { path: 'auth delete', kind: 'local' },
]
const CLI = 'mcp__foundry__orthanc_cli'

test('reads, clone and non-Foundry tools never reach the ladder', async () => {
  expect(classifyCall(CLI, { command: 'ontology list' }, MANIFEST, null)).toBe(null)
  expect(classifyCall(CLI, { command: 'configure list' }, MANIFEST, null)).toBe(null)
  expect(classifyCall(CLI, { command: 'repository clone', args: ['ri.x'] }, MANIFEST, null)).toBe(null)
  expect(classifyCall('Read', { file_path: 'a' }, MANIFEST, null)).toBe(null)
  expect(classifyCall('Bash', { command: 'orthanc --agent ontology list' }, MANIFEST, null)).toBe(null)
})

test('destructive mutations ask in every mode, yolo included', async () => {
  const deleting = classifyCall(CLI, { command: 'ontology object-type-delete', args: ['T'] }, MANIFEST, 'agent/x')
  expect(deleting?.isDestructive).toBe(true)
  for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
    expect(ladderDecision(mode, deleting!, { action: 'approve', reason: 'ok' }).outcome).toBe('ask')
  }
  const forced = classifyCall('Bash', { command: 'orthanc dataset create foo --force' }, MANIFEST, 'agent/x')
  expect(forced?.isDestructive).toBe(true)
})

test('protected baselines ask unless yolo; branchless mutations skip the branch gate', async () => {
  const onMain = classifyCall(CLI, { command: 'dataset create', args: ['--branch', 'main'] }, MANIFEST, 'agent/x')
  expect(onMain?.targetsProtected).toBe(true)
  expect(ladderDecision('allow-edits', onMain!).outcome).toBe('ask')
  expect(ladderDecision('yolo', onMain!).outcome).toBe('run')
  const created = classifyCall(CLI, { command: 'dataset create', args: ['x'] }, MANIFEST, null)
  expect(created?.isBranchScoped).toBe(false)
  expect(ladderDecision('allow-edits', created!).outcome).toBe('run')
})

test('branch-scoped mutation without a working branch asks; auto fails closed without a verdict', async () => {
  const upsert = classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['T'] }, MANIFEST, null)
  expect(ladderDecision('allow-edits', upsert!).outcome).toBe('ask')
  const onBranch = classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['T'] }, MANIFEST, 'agent/fix-1')
  expect(ladderDecision('auto', onBranch!, null).outcome).toBe('ask')
  expect(ladderDecision('auto', onBranch!, { action: 'approve', reason: 'fine' }).outcome).toBe('run')
  expect(ladderDecision('auto', onBranch!, { action: 'deny', reason: 'no' }).outcome).toBe('ask')
})

test('branch creation: invalid names block in every mode; valid ones run', async () => {
  const bad = classifyCall(CLI, { command: 'global-branch create', args: ['Feature_X'] }, MANIFEST, null)
  expect(ladderDecision('yolo', bad!).outcome).toBe('block')
  const missing = classifyCall(CLI, { command: 'global-branch create', args: ['--x'] }, MANIFEST, null)
  expect(ladderDecision('allow-edits', missing!).outcome).toBe('block')
  const good = classifyCall(CLI, { command: 'global-branch create', args: ['agent/fix-12'] }, MANIFEST, null)
  expect(ladderDecision('allow-edits', good!).outcome).toBe('run')
  expect(ladderDecision('ask-always', good!).outcome).toBe('ask')
  expect(validateBranchName('dataset branches create', 'agent-fix-12').ok).toBe(true)
  expect(validateBranchName('global-branch create', 'agent/main').ok).toBe(true)
  expect(validateBranchName('global-branch create', 'agent/a--b').ok).toBe(false)
})

test('loop guard blocks the third identical call, not the second', async () => {
  let state = null as ReturnType<typeof loopStep>['next'] | null
  const reasons: (string | null)[] = []
  for (let index = 0; index < 3; index += 1) {
    const step = loopStep(state, 'Bash', { command: 'ls', b: 1 })
    state = step.next
    reasons.push(step.reason)
  }
  expect(reasons[1]).toBe(null)
  expect(reasons[2]).not.toBe(null)
  expect(loopStep(state, 'Bash', { command: 'pwd' }).reason).toBe(null)
})

test('the guard denies any tool call naming the Compass root folder', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }))
  const ran = await $.tool.call({ tool: 'Read', file_path: 'ri.compass.main.folder.0' })
  expect(ran.deny).toContain('Compass root folder')
  const fine = await $.tool.call({ tool: 'Read', file_path: 'README.md' })
  expect(fine.deny).toBe(undefined)
})

