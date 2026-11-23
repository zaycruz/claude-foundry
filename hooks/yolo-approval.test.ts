// Yolo asks only on main, for manifest operator_approval too (board task FND-2).
//
// zay, 2026-11-17: "when im in yolo mode of the plugin, no approvals are
// necessary for anything on the branch, only main." orthanc PR #118 (SRC-15)
// keeps every `operator_approval` value and adds a sibling key,
// `operator_approval_scope`, that says where the write lands:
//   "always"       main, no branch, or the protection that guards main: asks.
//   "work-branch"  one global branch RID (never main): no ask in yolo.
//   {work_branch_flag, flag_aliases?}  the flag (or an alias) holds a global
//                  branch RID: no ask in yolo; no flag, or another value: asks.
// Any other or missing scope means "always". Other modes ask as before.
//
// Ways this can fail, written before the code:
//  O1  In yolo a work-branch write (global-branch roles set, remove-resources,
//      remove-repo with --apply, --yes) asks, though it names one global
//      branch RID. --yes is read as an ask.
//  O2  In yolo an "always" write runs with no ask: the four writes of bead
//      orthanc-9s1q (repo unprotect, resource set --off, project set
//      --no-auto-protect-new-resources, project policy delete), repo protect
//      --allow-weaken, checks required remove, tag-only-protected-branches,
//      project policy create/update.
//  O3  Another mode stops asking for a work-branch write.
//  O4  A scope the guard cannot read lets a call through in yolo: missing,
//      null, a number, an array, an unknown string, the wrong case, an object
//      with another key, a flag that is not a flag, aliases that are not a
//      list of flags. Or an unreadable operator_approval with a "work-branch"
//      scope runs.
//  O5  A "work-branch" call with no global branch RID, or naming main,
//      master or HEAD (as a positional, --branch=main, -bmain), runs in yolo.
//      A flag the guard does not know takes no value (--yes main): main hides
//      behind it and the call runs.
//  O6  A flag scope runs in yolo without proof: no flag, --branch=main,
//      -bmain, --branch HEAD, a value that is not a global branch RID, a
//      quoted RID, the flag twice, the flag in another case, -b instead of
//      the flag. Or it asks for --branch <RID>, --branch=<RID> or the alias.
//  O7  A release tag with no branch runs in yolo when the manifest has no
//      marker (an orthanc before #118), or with the marker. Or a tag linked by
//      --branch (not only --foundry-branch-rid) to a global branch RID asks in
//      yolo, or the question does not name the branch.
//  O8  No one to ask: an "always" write in yolo reaches orthanc. A
//      work-branch write in yolo is refused.
//  O9  (manifest-reload.test.ts R20) orthanc is upgraded mid-session: the
//      guard keeps the old manifest's scope.
//  O10 A work-branch write in Bash runs in yolo instead of going to
//      orthanc_cli.
//  O11 The yolo prompt says release tags run at once, or does not say which
//      marked writes still ask.
//  O12 A global-branch deploy, a proposal merge or a proposal accept (scope
//      "always") is a promotion into main through a proposal: not a direct
//      write to main, so since 2026-11-20 (zay: "raise the proposal and merge
//      the proposal") it runs in yolo with no ask and asks in every other
//      mode, the way its operator_approval mark says. Outside yolo it must not
//      run unasked.
//
// Synthetic stack only. The manifest entries are those of orthanc PR #118.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { classifyCall, ladderDecision, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const REPO = 'ri.stemma.main.repository.e0000000-0000-4000-8000-0000000000e1'
const MODULE = 'ri.workshop.main.module.e0000000-0000-4000-8000-0000000000e2'
const PROJECT = 'ri.compass.main.folder.e0000000-0000-4000-8000-0000000000e3'
const RID = 'ri.branch..branch.b0000000-0000-4000-8000-0000000000f4'
const DATASET = 'ri.foundry.main.dataset.e0000000-0000-4000-8000-0000000000e4'
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const TAG = 'refs/tags/1.2.3-tester-20261117'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const OTHER_MODES = MODES.filter(mode => mode !== 'yolo')
type Mode = (typeof MODES)[number]

const TAG_SCOPE = { work_branch_flag: '--branch', flag_aliases: ['--foundry-branch-rid'] }
const always = (path: string, flags: string[]) => ({ path, kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: flags }, operator_approval_scope: 'always' })
const ENTRIES = [
  { path: 'configure list', kind: 'local' },
  always('global-branch deploy', ['--apply', '--yes']),
  always('proposal merge', ['--apply', '--yes']),
  always('proposal accept', ['--apply', '--yes']),
  { path: 'global-branch roles set', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply'] }, operator_approval_scope: 'work-branch' },
  { path: 'global-branch remove-resources', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply', '--yes'] }, operator_approval_scope: 'work-branch' },
  { path: 'global-branch remove-repo', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply', '--yes'] }, operator_approval_scope: 'work-branch' },
  always('repository checks required remove', ['--apply', '--allow-weaken']),
  always('repository settings tag-only-protected-branches', ['--apply', '--allow-weaken']),
  always('branch-protection repo protect', ['--apply', '--allow-weaken']),
  always('branch-protection repo policy set', ['--apply', '--allow-weaken']),
  always('branch-protection repo unprotect', ['--apply']),
  always('branch-protection resource set', ['--apply', '--off']),
  always('branch-protection project set', ['--apply', '--no-auto-protect-new-resources']),
  always('branch-protection project policy create', ['--apply']),
  always('branch-protection project policy update', ['--apply']),
  always('branch-protection project policy delete', ['--apply']),
  { path: 'repository tag create', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply'] }, operator_approval_scope: TAG_SCOPE },
]
// orthanc before #118: the same markers with no scope, and no tag marker.
const OLD_ENTRIES = ENTRIES.map(entry => {
  const { operator_approval_scope: _scope, ...rest } = entry as Record<string, unknown>
  return rest.path === 'repository tag create' ? { path: rest.path, kind: 'mutation', auth: 'bearer-token' } : rest
})

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

type Answer = string | 'throw'
type Harness = { calls: string[]; asked: string[]; answer: Answer }

function harness(on: On, mode: Mode = 'yolo', entries: unknown[] = ENTRIES): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve' }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  const manifest = envelope({ commands: entries })
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const stdout =
      line === 'agent-manifest'
        ? manifest
        : line === 'configure list'
          ? envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] })
          : envelope({ ran: line })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/tester' : undefined }))
  on('env.set', () => ({ value: {} }))
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
const write = ($: Engine, command: string, args: string[] = []) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, path: string) => h.calls.filter(call => call.startsWith(path))
const say = async ($: Engine, command: string, args = '') =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)).text ?? ''
const prompt = async ($: Engine) =>
  ((await $.classic.SubagentStart({ agent_id: 'a', agent_type: 'foundry:foundry-scout' } as never)).additionalContext ?? []).join('\n')

const WORK_BRANCH: [string, string[]][] = [
  ['global-branch roles set', [RID, '--roles', '[]', '--apply']],
  ['global-branch remove-resources', [RID, DATASET, '--apply', '--yes']],
  ['global-branch remove-repo', [RID, REPO, '--apply', '--yes']],
  ['global-branch remove-repo', ['--apply', '--yes', RID, REPO]],
]
const ALWAYS: [string, string[]][] = [
  // The four writes of bead orthanc-9s1q.
  ['branch-protection repo unprotect', [REPO, 'feature-x', '--apply']],
  ['branch-protection resource set', [MODULE, '--off', '--apply']],
  ['branch-protection project set', [PROJECT, '--no-auto-protect-new-resources', '--apply']],
  ['branch-protection project policy delete', [PROJECT, '--expect-version', '3', '--apply']],
  // The other "always" markers.
  ['branch-protection repo protect', [REPO, 'feature-x', '--allow-weaken', '--apply']],
  ['branch-protection repo policy set', [REPO, 'feature-x', '--allow-weaken', '--apply']],
  ['repository checks required remove', [REPO, 'feature-x', 'ci/test', '--allow-weaken', '--apply']],
  ['repository settings tag-only-protected-branches', [REPO, '--allow-weaken', '--apply']],
  ['branch-protection project policy create', [PROJECT, '--apply']],
  ['branch-protection project policy update', [PROJECT, '--apply']],
]
const tagArgs = (...extra: string[]) => [REPO, TAG, '--commit-hash', COMMIT, ...extra]

test('O1: in yolo a work-branch write runs with no ask, even with no one to ask; --yes is not an ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of WORK_BRANCH) {
    expect({ command, deny: (await write($, command, args)).deny }).toEqual({ command, deny: undefined })
    expect(ran(h, command).at(-1)).toBe(`${command} ${args.join(' ')}`)
  }
  expect(h.asked).toEqual([])
})

for (const answer of ['Approve', 'Decline', 'throw'] as Answer[]) {
  test(`O2 O8: in yolo each "always" write asks once; answered ${answer}, it ${answer === 'Approve' ? 'runs' : 'never reaches orthanc'}`, async ($, on) => {
    const h = harness(on)
    h.answer = answer
    for (const [command, args] of ALWAYS) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ command, asked: h.asked.length - before }).toEqual({ command, asked: 1 })
      expect(h.asked.at(-1)).toContain(`'${command}'`)
      expect(h.asked.at(-1)).toContain('governance control')
      if (answer === 'Approve') {
        expect({ command, deny: wrote.deny }).toEqual({ command, deny: undefined })
        expect(ran(h, command)).toEqual([`${command} ${args.join(' ')}`])
      } else {
        expect({ command, denied: typeof wrote.deny }).toEqual({ command, denied: 'string' })
        expect(ran(h, command)).toEqual([])
      }
    }
  })
}

for (const mode of OTHER_MODES) {
  test(`O3: in ${mode} mode a work-branch write and an "always" write each ask once; declined, nothing runs`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Decline'
    for (const [command, args] of [...WORK_BRANCH, ...ALWAYS]) {
      const before = h.asked.length
      expect({ command, denied: typeof (await write($, command, args)).deny }).toEqual({ command, denied: 'string' })
      expect({ command, asked: h.asked.length - before }).toEqual({ command, asked: 1 })
      expect(h.asked.at(-1)).toContain('governance control')
    }
    // `configure list` is the plugin's own read of the stack's read-only mark.
    expect(h.calls.filter(call => call !== 'agent-manifest' && call !== 'version' && call !== 'configure list')).toEqual([])
  })
}

// Policy level: one manifest entry, every unreadable scope.
const rolesSet = (scope: unknown, approval: unknown = { when_all_flags: ['--apply'] }): ManifestCommand[] => [
  { path: 'global-branch roles set', kind: 'mutation', operatorApproval: approval, ...(scope === undefined ? {} : { operatorApprovalScope: scope }) },
]
const yoloOutcome = (manifest: ManifestCommand[], command: string, args: string[]) =>
  ladderDecision('yolo', classifyCall(CLI, { command, args }, manifest, null)!, null).outcome

test('O4: a scope the guard cannot read asks in yolo', async () => {
  const args = [RID, '--roles', '[]', '--apply']
  for (const scope of [
    undefined, null, 7, true, [], ['work-branch'], '', 'Work-Branch', 'work_branch', 'always', 'sometimes',
    {}, { work_branch_flag: '--branch', extra: 1 }, { work_branch_flag: 'branch' }, { work_branch_flag: '--branch x' },
    { work_branch_flag: 7 }, { flag_aliases: ['--branch'] }, { work_branch_flag: '--branch', flag_aliases: '--b' },
    { work_branch_flag: '--branch', flag_aliases: [7] }, { work_branch_flag: '--branch', flag_aliases: ['b'] },
  ]) {
    expect({ scope, outcome: yoloOutcome(rolesSet(scope), 'global-branch roles set', args) }).toEqual({ scope, outcome: 'ask' })
  }
  // An operator_approval the guard cannot read asks, whatever the scope says.
  for (const approval of [null, 'sometimes', { when_any_flags: ['--apply'] }, { when_all_flags: [] }]) {
    expect({ approval, outcome: yoloOutcome(rolesSet('work-branch', approval), 'global-branch roles set', args) }).toEqual({ approval, outcome: 'ask' })
  }
  // The readable scope, for contrast.
  expect(yoloOutcome(rolesSet('work-branch'), 'global-branch roles set', args)).toBe('run')
  // Object scopes the guard cannot read, on a call that does pass the flag with a RID.
  const tagged = [REPO, TAG, '--commit-hash', COMMIT, '--branch', RID, '--apply']
  const tagWith = (scope: unknown): ManifestCommand[] => [
    { path: 'repository tag create', kind: 'mutation', operatorApproval: { when_all_flags: ['--apply'] }, operatorApprovalScope: scope },
  ]
  for (const scope of [
    { work_branch_flag: '--branch', extra: 1 }, { work_branch_flag: '--branch', flag_aliases: '--foundry-branch-rid' },
    { work_branch_flag: '--branch', flag_aliases: [7] }, { work_branch_flag: '--branch', flag_aliases: ['branch'] },
    { work_branch_flag: 'branch' }, { work_branch_flag: '-b' }, { work_branch_flag: ['--branch'] }, { flag_aliases: ['--branch'] },
    [{ work_branch_flag: '--branch' }], 'work-branch-flag',
  ]) {
    expect({ scope, outcome: yoloOutcome(tagWith(scope), 'repository tag create', tagged) }).toEqual({ scope, outcome: 'ask' })
  }
  // A readable object scope with no aliases, for contrast (the release ask is skipped by --branch RID too).
  expect(yoloOutcome(tagWith({ work_branch_flag: '--branch' }), 'repository tag create', tagged)).toBe('run')
})

test('O5: a work-branch call with no global branch RID, or naming main, never runs in yolo', async () => {
  for (const args of [
    ['--roles', '[]', '--apply'],
    ['main', '--roles', '[]', '--apply'],
    ['master', '--roles', '[]', '--apply'],
    ['HEAD', '--roles', '[]', '--apply'],
    ['refs/heads/main', '--roles', '[]', '--apply'],
    ['agent/x', '--roles', '[]', '--apply'],
    ['ri.branch..branch.', '--roles', '[]', '--apply'],
    [`"${RID}"`, '--roles', '[]', '--apply'],
    [RID, 'main', '--roles', '[]', '--apply'],
    [RID, '--branch=main', '--roles', '[]', '--apply'],
    [RID, '-bmain', '--roles', '[]', '--apply'],
    [RID, '--branch', 'master', '--roles', '[]', '--apply'],
    [RID, '--apply', '--yes', 'main'],
    ['--yes', 'main', RID, '--apply'],
    ['--allow-weaken', 'master', RID, '--apply'],
  ]) {
    const classification = classifyCall(CLI, { command: 'global-branch roles set', args }, rolesSet('work-branch'), null)!
    const outcome = ladderDecision('yolo', classification, null).outcome
    expect({ args, runs: outcome === 'run' }).toEqual({ args, runs: false })
  }
})

const tagManifest: ManifestCommand[] = [
  { path: 'repository tag create', kind: 'mutation', operatorApproval: { when_all_flags: ['--apply'] }, operatorApprovalScope: TAG_SCOPE },
]
const tagOutcome = (args: string[], manifest = tagManifest, mode: Mode = 'yolo') => {
  const classification = classifyCall(CLI, { command: 'repository tag create', args }, manifest, null)!
  return classification.error !== undefined ? 'block' : ladderDecision(mode, classification, null).outcome
}

test('O6: a flag scope runs in yolo only when the flag or its alias holds one global branch RID', async () => {
  for (const extra of [['--branch', RID], [`--branch=${RID}`], ['--foundry-branch-rid', RID], [`--foundry-branch-rid=${RID}`]]) {
    expect({ extra, outcome: tagOutcome(tagArgs(...extra, '--apply')) }).toEqual({ extra, outcome: 'run' })
  }
  for (const extra of [
    [], ['--branch=main'], ['-bmain'], ['-b', 'main'], ['--branch', 'main'], ['--branch', 'HEAD'], ['--branch', 'master'],
    ['--branch', 'agent/x'], ['--branch', `"${RID}"`], ['--branch', RID, '--branch', RID], ['--branch', RID, '--foundry-branch-rid', RID],
    ['--branch', RID, '-bmain'], ['--BRANCH', RID], ['-b', RID], [`-b${RID}`], ['--branch'], ['--branch='],
    ['--foundry-branch-rid', 'master'],
  ]) {
    expect({ extra, runs: tagOutcome(tagArgs(...extra, '--apply')) === 'run' }).toEqual({ extra, runs: false })
  }
})

test('O7: a release tag with no branch asks in yolo with or without the manifest marker; a tag on a global branch runs', async () => {
  const unmarked: ManifestCommand[] = [{ path: 'repository tag create', kind: 'mutation' }]
  for (const manifest of [tagManifest, unmarked]) {
    expect(tagOutcome(tagArgs('--apply'), manifest)).toBe('ask')
    expect(tagOutcome(tagArgs('--branch', RID, '--apply'), manifest)).toBe('run')
    expect(tagOutcome(tagArgs('--foundry-branch-rid', RID, '--apply'), manifest)).toBe('run')
    for (const mode of OTHER_MODES) {
      expect({ mode, outcome: tagOutcome(tagArgs('--branch', RID, '--apply'), manifest, mode) }).toEqual({ mode, outcome: 'ask' })
    }
  }
  // The question names the branch however it is given.
  const linked = classifyCall(CLI, { command: 'repository tag create', args: tagArgs('--branch', RID, '--apply') }, unmarked, null)!
  expect(ladderDecision('auto', linked, null).reason).toContain(RID)
})

test('O7 O8: end to end in yolo, a release tag with no branch asks and, with no one to ask, never runs; on a global branch it runs', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  expect(typeof (await write($, 'repository tag create', tagArgs('--apply'))).deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).toContain('release')
  expect(ran(h, 'repository tag create')).toEqual([])
  expect((await write($, 'repository tag create', tagArgs('--branch', RID, '--apply'))).deny).toBe(undefined)
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'repository tag create')).toEqual([`repository tag create ${tagArgs('--branch', RID, '--apply').join(' ')}`])
})

test('O7: with an orthanc before #118 (no scope, no tag marker) yolo asks for every marked write and a release tag', async ($, on) => {
  const h = harness(on, 'yolo', OLD_ENTRIES)
  h.answer = 'Decline'
  for (const [command, args] of [...WORK_BRANCH, ...ALWAYS, ['repository tag create', tagArgs('--apply')] as [string, string[]]]) {
    const before = h.asked.length
    expect({ command, denied: typeof (await write($, command, args)).deny }).toEqual({ command, denied: 'string' })
    expect({ command, asked: h.asked.length - before }).toEqual({ command, asked: 1 })
  }
})

test('O10: a work-branch write in Bash is refused in yolo and asks no one', async ($, on) => {
  const h = harness(on)
  for (const [command, args] of WORK_BRANCH) {
    const wrote = (await $.tool.call({ tool: 'Bash', command: `orthanc ${command} ${args.join(' ')}` } as never)) as { deny?: string }
    expect({ command, denied: typeof wrote.deny }).toEqual({ command, denied: 'string' })
  }
  expect(h.asked).toEqual([])
  expect(ran(h, 'global-branch')).toEqual([])
})

test('O11: the yolo prompt says a release tag with no branch and marked writes off a work branch still ask', async ($, on) => {
  harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  const text = await prompt($)
  expect(text).toContain('Foundry approval mode: yolo')
  expect(text.includes('release tags run at once')).toBe(false)
  expect(text).toContain('a release tag (repository tag create --apply) with no --branch <global branch RID>')
  expect(text).toContain('operator_approval')
})

// A promotion into main through a proposal: runs in yolo with no ask, asks
// (the manifest's operator_approval, "governance control") in every other mode,
// auto — the default — included.
const PROMOTIONS: [string, string[]][] = [
  ['global-branch deploy', [RID, '--apply', '--yes']],
  ['proposal merge', ['ri.branch..proposal.b0000000-0000-4000-8000-0000000000f5', '--apply', '--yes']],
  ['proposal accept', ['ri.branch..proposal.b0000000-0000-4000-8000-0000000000f5', '--apply', '--yes']],
]

test('O12: in yolo each promotion runs with no ask, even with no one to ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of PROMOTIONS) {
    expect({ command, deny: (await write($, command, args)).deny }).toEqual({ command, deny: undefined })
    expect(ran(h, command)).toEqual([`${command} ${args.join(' ')}`])
  }
  expect(h.asked).toEqual([])
})

for (const mode of OTHER_MODES) {
  test(`O12: in ${mode} mode each promotion asks once; declined, it never reaches orthanc`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Decline'
    for (const [command, args] of PROMOTIONS) {
      const before = h.asked.length
      expect({ command, denied: typeof (await write($, command, args)).deny }).toEqual({ command, denied: 'string' })
      expect(h.asked.at(-1)).toContain(`'${command}'`)
      expect(h.asked.at(-1)).toContain('governance control')
      expect(h.asked.length).toBe(before + 1)
      expect(ran(h, command)).toEqual([])
    }
  })
}
