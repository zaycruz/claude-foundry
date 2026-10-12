import { expect, test } from 'claude-code/testing'

import {
  classifyCall,
  flagValue,
  gitPushDirectories,
  gitPushNamesFoundry,
  ladderDecision,
  loopStep,
  type ManifestCommand,
  resolveOrthancCommand,
  rulesWriteReason,
  validateBranchName,
} from './policy'

const MANIFEST: ManifestCommand[] = [
  { path: 'ontology list', kind: 'read-only' },
  { path: 'ontology object-type-delete', kind: 'mutation' },
  { path: 'ontology object-type-upsert', kind: 'mutation' },
  { path: 'dataset create', kind: 'mutation' },
  { path: 'global-branch create', kind: 'mutation' },
  { path: 'repository clone', kind: 'mutation' },
  { path: 'configure list', kind: 'local' },
  { path: 'ontology object-upsert', kind: 'mutation' },
  { path: 'ontology action-apply', kind: 'mutation' },
  { path: 'dataset schema set', kind: 'mutation' },
  { path: 'repository push', kind: 'mutation' },
  { path: 'proposal merge', kind: 'mutation' },
  { path: 'orchestration builds create', kind: 'mutation' },
  { path: 'auth delete', kind: 'local' },
  { path: 'cp', kind: 'mutation' },
  { path: 'repository tag create', kind: 'mutation' },
  { path: 'search', kind: 'read-only' },
]
const CLI = 'mcp__foundry__orthanc_cli'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const GLOBAL = 'ri.branch..branch.0f6c2a1e-1b2c-4d5e-8f90-a1b2c3d4e5f6'
const approve = { action: 'approve', reason: 'ok' } as const
const blockedEverywhere = (classification: ReturnType<typeof classifyCall>) =>
  MODES.every(mode => ladderDecision(mode, classification!, approve).outcome === 'block')

test('reads, clone and non-Foundry tools never reach the ladder', async () => {
  expect(classifyCall(CLI, { command: 'ontology list' }, MANIFEST, null)).toBe(null)
  expect(classifyCall(CLI, { command: 'configure list' }, MANIFEST, null)).toBe(null)
  expect(classifyCall(CLI, { command: 'repository clone', args: ['ri.x'] }, MANIFEST, null)).toBe(null)
  expect(classifyCall('Read', { file_path: 'a' }, MANIFEST, null)).toBe(null)
  expect(classifyCall('Bash', { command: 'orthanc --agent ontology list' }, MANIFEST, null)).toBe(null)
})

test('destructive mutations ask in every mode, yolo included', async () => {
  const deleting = classifyCall(CLI, { command: 'ontology object-type-delete', args: ['T', '--branch', GLOBAL] }, MANIFEST, 'agent/x')
  expect(deleting?.isDestructive).toBe(true)
  for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
    expect(ladderDecision(mode, deleting!, { action: 'approve', reason: 'ok' }).outcome).toBe('ask')
  }
  const forced = classifyCall(CLI, { command: 'dataset create', args: ['foo', '--force'] }, MANIFEST, 'agent/x')
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

test('F1 F10: an ontology write without --branch blocks in every mode, yolo included', async () => {
  expect(blockedEverywhere(classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['T'] }, MANIFEST, 'agent/x'))).toBe(true)
  expect(blockedEverywhere(classifyCall(CLI, { command: 'ontology action-apply', args: ['a', '--branch'] }, MANIFEST, null))).toBe(true)
})

test('F2 F3 F5: protected, defaulted or non-global branches block; a global branch RID passes the rule', async () => {
  expect(blockedEverywhere(classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['T', '--branch', 'main'] }, MANIFEST, null))).toBe(true)
  expect(blockedEverywhere(classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['T', '--branch', 'ri.ontology.main.branch.x'] }, MANIFEST, null))).toBe(true)
  expect(blockedEverywhere(classifyCall(CLI, { command: 'dataset schema set', args: ['ri.foundry.main.dataset.x', '--json', '{}'] }, MANIFEST, null))).toBe(true)
  expect(blockedEverywhere(classifyCall(CLI, { command: 'dataset schema set', args: ['d', '--branch', 'master'] }, MANIFEST, null))).toBe(true)
  const dataset = classifyCall(CLI, { command: 'dataset schema set', args: ['d', '--branch', 'agent-fix-1'] }, MANIFEST, null)
  expect(ladderDecision('allow-edits', dataset!).outcome).toBe('run')
  const onBranch = classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['T', `--branch=${GLOBAL}`] }, MANIFEST, null)
  expect(onBranch?.error).toBe(undefined)
  expect(ladderDecision('allow-edits', onBranch!).outcome).toBe('run')
  expect(ladderDecision('auto', onBranch!, null).outcome).toBe('ask')
  expect(ladderDecision('auto', onBranch!, { action: 'approve', reason: 'fine' }).outcome).toBe('run')
  expect(ladderDecision('auto', onBranch!, { action: 'deny', reason: 'no' }).outcome).toBe('ask')
})

test('F4: flags keep their = and quoted forms', async () => {
  const quoted = classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['T', '--branch', `"${GLOBAL}"`] }, MANIFEST, null)
  expect(quoted?.error).toBe(undefined)
  expect(flagValue(['--branch=x'], '--branch')).toBe('x')
  expect(flagValue(["--branch", "'y'"], '--branch')).toBe('y')
  expect(flagValue(['--branch', '--apply'], '--branch')).toBe('')
})

test('F6 F8 F11: unbranchable ontology writes, merges and Palantir MCP writes block everywhere', async () => {
  expect(blockedEverywhere(classifyCall(CLI, { command: 'ontology object-upsert', args: ['T'] }, MANIFEST, 'agent/x'))).toBe(true)
  expect(blockedEverywhere(classifyCall(CLI, { command: 'proposal merge', args: ['p'] }, MANIFEST, 'agent/x'))).toBe(true)
  expect(blockedEverywhere(classifyCall('mcp__palantir-mcp__create_object_type', { name: 'x' }, MANIFEST, 'agent/x'))).toBe(true)
})

test('F7: repository push to the default branch blocks; a work branch passes the rule', async () => {
  const push = (args: string[]) => classifyCall(CLI, { command: 'repository push', args }, MANIFEST, null)
  expect(blockedEverywhere(push(['ri.stemma.main.repository.x', 'refs/heads/a', 'refs/heads/master']))).toBe(true)
  expect(blockedEverywhere(push(['ri.stemma.main.repository.x', 'refs/heads/a', 'refs/heads/a', '--allow-default-branch']))).toBe(true)
  expect(push(['ri.stemma.main.repository.x', 'refs/heads/agent-a', 'refs/heads/agent-a'])?.error).toBe(undefined)
})

test('F9: a build without --branch blocks', async () => {
  expect(blockedEverywhere(classifyCall(CLI, { command: 'orchestration builds create', args: ['ri.x', '--apply'] }, MANIFEST, null))).toBe(true)
})

test('F12 F23: every directory a git push could run in is checked', async () => {
  expect(gitPushDirectories('git status')).toBe(null)
  expect(gitPushDirectories('git commit -m "fix push"')).toBe(null)
  expect(gitPushDirectories('git push origin agent-x')).toEqual([''])
  expect(gitPushDirectories('cd /tmp/clone && git push')).toEqual(['', '/tmp/clone'])
  expect(gitPushDirectories('git -C ~/clone push origin HEAD:master')).toEqual(['', '~/clone'])
  expect(gitPushDirectories('git -c http.x=y push')).toEqual([''])
  expect(gitPushDirectories('(cd /tmp/clone&&git push)')).toEqual(['', '/tmp/clone'])
  expect(gitPushDirectories(`sh -c 'cd /tmp/clone; git push'`)).toContain('/tmp/clone')
  expect(gitPushDirectories('git -C "/tmp/my clone" push')).toEqual(['', '/tmp/my clone'])
  expect(gitPushDirectories('git --git-dir=/tmp/clone/.git push')).toEqual(['', '/tmp/clone/.git'])
  expect(gitPushDirectories('echo x | xargs git push')).toEqual([''])
})

test('F14: an ontology RID is not a protected branch', async () => {
  const onBranch = classifyCall(CLI, { command: 'ontology object-type-upsert', args: ['ri.ontology.main.ontology.x', '--branch', GLOBAL] }, MANIFEST, null)
  expect(onBranch?.targetsProtected).toBe(false)
})

test('F16: orthanc_cli resolves case and trailing words the way the executor runs them', async () => {
  expect(resolveOrthancCommand('Ontology Object-Type-Upsert T', ['--apply'], MANIFEST)).toEqual({ path: 'ontology object-type-upsert', args: ['T', '--apply'] })
  expect(blockedEverywhere(classifyCall(CLI, { command: 'Ontology Object-Type-Upsert' }, MANIFEST, null))).toBe(true)
  expect(blockedEverywhere(classifyCall(CLI, { command: 'ontology object-type-upsert T --apply' }, MANIFEST, null))).toBe(true)
  expect(blockedEverywhere(classifyCall(CLI, { command: '  PROPOSAL   merge ' }, MANIFEST, null))).toBe(true)
})

test('F17: Orthanc writes in Bash block in every mode, however the shell hides them; plain reads pass', async () => {
  const bash = (command: string) => classifyCall('Bash', { command }, MANIFEST, 'agent/x')
  expect(bash('orthanc --agent ontology list')).toBe(null)
  expect(bash('orthanc --profile acme search "Person"')).toBe(null)
  expect(bash('orthanc ontology object-type-upsert --help')).toBe(null)
  expect(bash('grep orthanc README.md')).toBe(null)
  expect(bash('cd ~/projects/orthanc && cargo test')).toBe(null)
  for (const command of [
    `orthanc ontology object-type-upsert T --branch ${GLOBAL}`,
    'orthanc ontology object-type-upsert T',
    'bash -c "orthanc ontology object-type-upsert T"',
    'ls;orthanc ontology object-type-upsert T',
    'echo $(orthanc ontology object-type-upsert T)',
    'echo `orthanc proposal merge p`',
    '$ORTHANC_BIN ontology object-type-upsert T',
    'env X=1 orthanc dataset schema set d',
    'echo T | xargs orthanc ontology object-type-upsert',
    'orthanc --profile acme ontology object-type-upsert T',
    '/usr/local/bin/orthanc proposal merge p',
    'orthanc ontology --profile acme object-type-upsert T',
    'O=orthanc; $O proposal merge p',
    'X="orthanc proposal merge p"; eval $X',
    `python3 -c "import subprocess; subprocess.run(['orthanc','proposal','merge','p'])"`,
    'orthanc Proposal Merge p',
  ]) {
    expect({ command, blocked: blockedEverywhere(bash(command)) }).toEqual({ command, blocked: true })
  }
})

test('F18 F19 F20: one plain branch value; -b counts; cp is gated', async () => {
  const cli = (command: string, args: string[]) => classifyCall(CLI, { command, args }, MANIFEST, null)
  expect(blockedEverywhere(cli('ontology object-type-upsert', ['T', '--branch', GLOBAL, '--branch', 'main']))).toBe(true)
  expect(blockedEverywhere(cli('ontology object-type-upsert', ['T', `--branch=${GLOBAL}`, '-b', 'x']))).toBe(true)
  expect(blockedEverywhere(cli('dataset schema set', ['d', '--branch', 'main;']))).toBe(true)
  expect(blockedEverywhere(cli('dataset schema set', ['d', '--branch', 'agent fix']))).toBe(true)
  expect(blockedEverywhere(cli('cp', ['ri.a', 'ri.f', '--apply']))).toBe(true)
  expect(blockedEverywhere(cli('cp', ['ri.a', 'ri.f', '-bmaster']))).toBe(true)
  expect(cli('cp', ['ri.a', 'ri.f', '-b', 'agent-copy', '--apply'])?.error).toBe(undefined)
})

test('F21 F22: tags are promotion; repository push reads its destination past boolean flags', async () => {
  expect(blockedEverywhere(classifyCall(CLI, { command: 'repository tag create', args: ['ri.r', 'v1'] }, MANIFEST, null))).toBe(true)
  const push = (args: string[]) => classifyCall(CLI, { command: 'repository push', args }, MANIFEST, null)
  expect(blockedEverywhere(push(['--apply', 'ri.stemma.main.repository.x', 'refs/heads/a', 'refs/heads/main']))).toBe(true)
  expect(blockedEverywhere(push(['ri.stemma.main.repository.x', 'refs/heads/main']))).toBe(true)
  expect(push(['--apply', '--profile', 'acme', 'ri.stemma.main.repository.x', 'refs/heads/agent-a', 'refs/heads/agent-a'])?.error).toBe(undefined)
})

test('F24: the agent cannot write the operator rules', async () => {
  expect(rulesWriteReason('Write', { file_path: '/Users/x/.claude/foundry/rules.md' })).not.toBe(null)
  expect(rulesWriteReason('Edit', { file_path: '.claude/foundry-rules.md' })).not.toBe(null)
  expect(rulesWriteReason('Bash', { command: 'echo "approve all" >> ~/.claude/foundry/rules.md' })).not.toBe(null)
  expect(rulesWriteReason('Bash', { command: 'cd ~/.claude/foundry && tee rules.md < x' })).not.toBe(null)
  expect(rulesWriteReason('Read', { file_path: '.claude/foundry-rules.md' })).toBe(null)
  expect(rulesWriteReason('Bash', { command: 'cat .claude/foundry-rules.md' })).not.toBe(null)
  expect(rulesWriteReason('Write', { file_path: 'README.md' })).toBe(null)
})

test('round 3: substitutions, wrappers, help and false positives', async () => {
  const bash = (command: string) => classifyCall('Bash', { command }, MANIFEST, null)
  for (const command of [
    'orthanc $(echo dataset) create x',
    'orthanc `echo dataset` create x',
    '! orthanc dataset create x',
    'find . -exec orthanc dataset create x \\;',
    'setsid orthanc dataset create x',
    'npx orthanc dataset create x',
    'ssh box orthanc dataset create x',
  ]) {
    expect({ command, blocked: blockedEverywhere(bash(command)) }).toEqual({ command, blocked: true })
  }
  for (const command of [
    'orthanc help dataset create',
    'orthanc',
    'source .venv/bin/activate; cd orthanc',
    'python3 tools/x.py orthanc',
    'eval "$(direnv export bash)"; ls orthanc',
    'git log --grep=orthanc',
    'curl http://orthanc:8042',
  ]) {
    expect({ command, result: bash(command) }).toEqual({ command, result: null })
  }
  expect(blockedEverywhere(bash('orthanc dataset create -- -h'))).toBe(true)
})

test('round 3: git push by URL, GIT_DIR, alias and cd --', async () => {
  expect(gitPushNamesFoundry('git push https://h/stemma/git/ri.stemma.main.repository.x/r HEAD:main')).toBe(true)
  expect(gitPushNamesFoundry('git push origin agent-x')).toBe(false)
  expect(gitPushDirectories('GIT_DIR=/c/.git git push')).toContain('/c/.git')
  expect(gitPushDirectories('export GIT_DIR=/c/.git; git push')).toContain('/c/.git')
  expect(gitPushDirectories('git -c alias.p=push p origin main')).not.toBe(null)
  expect(gitPushDirectories('cd -- /c && git push')).toEqual(['', '/c'])
})

test('round 3: rules paths normalized; deleting ~/.claude denied; reads and unrelated writes pass', async () => {
  const home = '/Users/x'
  const deny = (tool: string, input: Record<string, unknown>, cwd = '/w') => rulesWriteReason(tool, input, cwd, home) !== null
  expect(deny('Write', { file_path: '/Users/x/.claude/./foundry/rules.md' })).toBe(true)
  expect(deny('Write', { file_path: '/Users/x/.claude/foundry//rules.md' })).toBe(true)
  expect(deny('Write', { file_path: '/Users/x/.claude/Foundry/Rules.md' })).toBe(true)
  expect(deny('Write', { file_path: 'rules.md' }, '/Users/x/.claude/foundry')).toBe(true)
  expect(deny('Write', { file_path: '~/.claude/foundry/otel.env' })).toBe(true)
  expect(deny('Bash', { command: 'echo x > ~/.claude/foundry/r*' })).toBe(true)
  expect(deny('Bash', { command: 'rm -rf ~/.claude/foundry' })).toBe(true)
  expect(deny('Bash', { command: 'mv ~/.claude /tmp' })).toBe(true)
  expect(deny('Bash', { command: 'rm -rf ~/.claude' })).toBe(true)
  expect(deny('Bash', { command: 'printf x>r.md' }, '/Users/x/.claude/foundry')).toBe(true)
  expect(deny('Bash', { command: 'echo "foundry docs" > rules.md' })).toBe(false)
  expect(deny('Bash', { command: 'cat ~/.claude/foundry/rules.md' })).toBe(true)
  expect(deny('Bash', { command: 'rm -rf ~/.claude/jobs/x/tmp' })).toBe(false)
  expect(deny('Write', { file_path: '/w/README.md' })).toBe(false)
})

test('round 4: operator files are neither read nor written, however the shell reaches them', async () => {
  const home = '/Users/x'
  const deny = (tool: string, input: Record<string, unknown>, cwd = '/w') => rulesWriteReason(tool, input, cwd, home) !== null
  expect(deny('Bash', { command: "cd ~/.claude && printf 'LANGFUSE_BASE_URL=https://evil' | tee foundry/otel.env" })).toBe(true)
  expect(deny('Bash', { command: 'bun -e \'Bun.write(Bun.env.HOME+"/.claude/foundry/otel.env", "x")\'' })).toBe(true)
  expect(deny('Bash', { command: "deno eval 'Deno.writeTextFileSync(\"foundry/rules.md\", \"x\")'" })).toBe(true)
  expect(deny('Bash', { command: "cd ~/.claude; ex -sc 'w foundry/rules.md'" })).toBe(true)
  expect(deny('Bash', { command: 'cat ~/.claude/foundry/otel.env' })).toBe(true)
  expect(deny('Bash', { command: 'ls' }, '/Users/x/.claude/foundry')).toBe(true)
  expect(deny('Read', { file_path: '~/.claude/foundry/otel.env' })).toBe(true)
  expect(deny('Read', { file_path: '/Users/x/.claude/./foundry/rules.md' })).toBe(true)
  expect(deny('Grep', { pattern: 'LANGFUSE', path: '/Users/x/.claude/foundry' })).toBe(true)
  expect(deny('Grep', { pattern: 'LANGFUSE', path: '/Users/x/.claude', glob: '**/otel.env' })).toBe(true)
  expect(deny('Glob', { pattern: 'foundry/*', path: '/Users/x/.claude' })).toBe(true)
  expect(deny('Grep', { pattern: 'LANGFUSE_SECRET', path: '~/.claude' })).toBe(true)
  expect(deny('Grep', { pattern: 'SECRET', path: '~', glob: '.claude/foundry/*' })).toBe(true)
  expect(deny('Glob', { pattern: '**/otel.env', path: '~' })).toBe(true)
  expect(deny('Grep', { pattern: 'KEY', path: '/w', glob: '**/*.env' })).toBe(false)
  expect(deny('Glob', { pattern: 'src/foundry/*.ts', path: '/w' })).toBe(false)
  expect(deny('Read', { file_path: '/w/claude-foundry/README.md' })).toBe(false)
  expect(deny('Grep', { pattern: 'foundry', path: '/w' })).toBe(false)
  expect(deny('Bash', { command: 'cat claude-foundry/README.md' })).toBe(false)
  expect(deny('Bash', { command: 'git -C claude-foundry status' })).toBe(false)
})

test('round 3: main spelled any way is main', async () => {
  const cli = (command: string, args: string[]) => classifyCall(CLI, { command, args }, MANIFEST, null)
  for (const branch of ['refs/heads/master', 'heads/main', 'main/', './main', 'master.', 'MAIN']) {
    expect({ branch, blocked: blockedEverywhere(cli('dataset schema set', ['d', '--branch', branch])) }).toEqual({ branch, blocked: true })
  }
  const push = (dest: string) => classifyCall(CLI, { command: 'repository push', args: ['ri.r', 'refs/heads/a', dest] }, MANIFEST, null)
  for (const dest of ['+refs/heads/main', ':main', 'refs/heads/main:', 'Refs/Heads/Main', 'refs/heads//main', 'HEAD']) {
    expect({ dest, blocked: blockedEverywhere(push(dest)) }).toEqual({ dest, blocked: true })
  }
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

