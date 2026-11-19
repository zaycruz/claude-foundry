// Yolo: nothing asks, and the work stays on branches that are not main.
//
// zay, 2026-10-22: "i need a yolo mode so the agent doesnt need more approval
// or get blocked". Asked what yolo should stop doing (every option dropped the
// dialogs; FDE keeps its holds), zay answered: "nohting refused but still
// siloed to a branch that is not main". So in yolo no Foundry call asks the
// operator, and what is refused is what keeps the agent off main: a write with
// no branch or naming main, a main-only write, a merge or approval, a push to
// the default branch. FDE mode, which the operator turns on, keeps its holds.
//
// Ways this can fail, written before the code:
//  Y1  In yolo a delete, or a write with --force, opens a dialog, or does not run
//      when no one can be asked (a subagent, a -p run).
//  Y2  In yolo a release tag apply asks, or does not run when no one can be asked.
//      Changed by zay, 2026-11-17 ("no approvals are necessary for anything on
//      the branch, only main"), board task FND-2: a tag with no --branch
//      <global branch RID> is a release on main, so in yolo it asks, and with
//      no one to ask it is refused. A tag on a global branch runs with no ask.
//  Y3  Another mode loosens: ask-always, allow-edits and auto stop asking for a
//      delete, a --force write or a tag apply.
//  Y4  In any mode a write that names main, master or HEAD as its branch runs
//      without the operator's approval (in yolo it ran in 0.5.0). zay,
//      2026-10-23: "we dont want to ever run against the default branch ... unless
//      we approve runs on master or main". So yolo asks for it, the one dialog yolo
//      keeps; declined, or no one to ask, it is refused. Any spelling counts
//      (--branch=main, -b master, -bmain, the args inside the command string);
//      in 0.5.0 allow-edits ran those without asking. A base, fallback or parent
//      branch of master (a pull request, a build, a new branch) still runs.
//  Y5  The silo loosens in yolo: an ontology write with no --branch, a main-only
//      write (object upsert), a proposal merge, accept or approve, a push to the
//      default branch or with --allow-default-branch, or a raw git push from a
//      Foundry clone runs or asks.
//  Y6  A write that lands on master by default runs without a branch:
//      connectivity import create-file and create-table (output branch defaults
//      to master), repository imports add and remove with
//      --allow-default-branch or --branch master. Refused in every mode; with a
//      work branch they run.
//  Y7  In yolo the loop guard refuses a third identical call. In other modes it
//      still does.
//  Y8  -f is read as --force: `ai-fde run … -f json` or `folder create … -f
//      <parent>` asks as a destructive call. For mutations -f is a format or a
//      folder, never force; --force still asks.
//  Y9  The prompt in yolo still says tags ask, or does not say what stays
//      refused; the prompt in other modes stops saying tags ask.
//  Y10 FDE mode loosens in yolo: an apply with no dry run runs. After its dry
//      run, a bound delete runs without a dialog.
//  Y11 A credential command runs in yolo. Orthanc names the commands that take
//      a secret the operator types with a manifest `input`: `token-on-stdin`
//      (`auth store`) and `host-and-token` (`configure profile create`,
//      `onboarding`). 0.6.2 refused the `token-on-stdin` spelling and two names,
//      so `configure profile create <name> --host … --token-stdin --force`,
//      which replaces the credentials the profile every later call runs on,
//      reached orthanc in every mode. Now any entry that names an `input` is
//      refused by name, in every mode, with no orthanc call.
//  Y12 An Orthanc write in Bash runs in yolo instead of going to orthanc_cli.
//
// zay, 2026-11-17: "when im in yolo mode of the plugin, no approvals are
// necessary for anything on the branch, only main." Checked against the real
// Orthanc commands (0.6.0 was checked only against dataset create, which has no
// --branch):
//  Y13 A real branch write (dataset schema set, a build, an ontology write, an
//      import) naming main, master or HEAD is refused outright, so the operator
//      cannot approve it; or it runs without asking. It must ask once in every
//      mode, run when approved, and be refused when declined or no one can be
//      asked.
//  Y14 A write whose --branch is optional and lands on main or master when it is
//      left out (dataset create-from-csv, workshop module update, automate
//      update/pause/resume, pipeline sandbox and edit/publish/deploy) runs with
//      no branch. Refused in every mode, asking no one; with a work branch it
//      runs in yolo with no ask.
//  Y15 workshop module publish, which only works on main, runs in yolo with no
//      ask. It asks in every mode.
//  Y16 The branch matcher misses a spelling of main, master or HEAD (case, a
//      refs/heads/ prefix, ./, +, :, a trailing / or ., a quoted value, any flag
//      form), or asks for a branch that is not main (main-fix, agent/main,
//      maintenance, headless, a --fallback-branch master). Checked over every
//      combination, at the ladder.
//  Y17 FDE mode stops pinning: with a bound branch, a write naming main asks or
//      runs instead of being refused.
//  Y18 A write that names its branch as a positional (dataset branches delete,
//      repository branch delete, repository checks required set/remove,
//      branch-protection repo protect/policy set/unprotect) deletes master, or
//      unprotects main, with no ask: in yolo for all of them, in allow-edits
//      for the ones that are not deletes. Each must ask in every mode; a work
//      branch runs in yolo with no ask.
//  Y19 A promotion into main other than a proposal (global-branch deploy, which
//      deploys a proposal to main; repository pull-request merge) runs in
//      yolo or allow-edits. Promotions are the operator's: refused in every
//      mode, asking no one, like proposal merge.
//  Y20 A schedule or an import carries its branch inside: the action JSON of
//      orchestration schedules create/replace, or the stored schedule or
//      import that schedules run/unpause and connectivity import run start.
//      One whose builds write master (named, or no branchName, which Foundry
//      reads as master) runs in yolo or allow-edits with no ask. Create and
//      replace must name a work branch (no branch, or an action the guard
//      cannot read, is refused; naming main asks). A run or unpause reads the
//      stored branch first: main, none, or a read that fails asks; a work
//      branch runs in yolo with no ask.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { classifyCall, ladderDecision, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-0000000000a1', name: 'Tester Ontology' }
const REPO = 'ri.stemma.main.repository.e0000000-0000-4000-8000-0000000000e1'
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const TAG = 'refs/tags/1.2.3-tester-20261022'
const MADE = 'ri.branch..branch.b0000000-0000-4000-8000-0000000000f3'
const GLOBAL = 'ri.branch..branch.b0000000-0000-4000-8000-0000000000f4'
const FOLDER = 'ri.compass.main.folder.c0000000-0000-4000-8000-0000000000c1'
const SOURCE = 'ri.magritte..source.c0000000-0000-4000-8000-0000000000c2'
const DATASET = 'ri.foundry.main.dataset.c0000000-0000-4000-8000-0000000000c3'
const TARGET = '{"type":"manual","targetRids":["ri.foundry.main.dataset.c0000000-0000-4000-8000-0000000000c3"]}'
const OTHER_MODES = ['ask-always', 'allow-edits', 'auto'] as const
const SCHED = (n: number) => `ri.scheduler.main.schedule.c0000000-0000-4000-8000-00000000000${n}`
const IMPORT = (n: number) => `ri.magritte..import.c0000000-0000-4000-8000-00000000000${n}`
const STORED: Record<string, { kind?: 'file' | 'table'; data: unknown }> = {
  [SCHED(1)]: { data: { rid: SCHED(1), action: { target: { type: 'manual', targetRids: [] }, branchName: 'master' } } },
  [SCHED(2)]: { data: { rid: SCHED(2), action: { target: { type: 'manual', targetRids: [] } } } },
  [SCHED(3)]: { data: { rid: SCHED(3), action: { target: { type: 'manual', targetRids: [] }, branchName: 'agent-nightly', fallbackBranches: ['master'] } } },
  [IMPORT(1)]: { kind: 'file', data: { rid: IMPORT(1), datasetRid: 'ri.foundry.main.dataset.x', branchName: 'master' } },
  [IMPORT(2)]: { kind: 'table', data: { rid: IMPORT(2), datasetRid: 'ri.foundry.main.dataset.x' } },
  [IMPORT(3)]: { kind: 'table', data: { rid: IMPORT(3), datasetRid: 'ri.foundry.main.dataset.x', branchName: 'agent-orders' } },
}
type Mode = 'ask-always' | 'allow-edits' | 'auto' | 'yolo'

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
// path, kind, and the manifest's `input` when the command needs a secret the
// operator types (orthanc marks those `token-on-stdin` or `host-and-token`).
const COMMANDS: [string, string, string?][] = [
  ['configure list', 'local'],
  ['auth store', 'local', 'token-on-stdin'],
  ['configure profile create', 'local', 'host-and-token'],
  ['configure profile set', 'local'],
  ['onboarding', 'local', 'host-and-token'],
  ['ontology list', 'read-only'],
  ['global-branch create', 'mutation'],
  ['ontology object-type-delete', 'mutation'],
  ['ontology object-type-upsert', 'mutation'],
  ['dataset schema set', 'mutation'],
  ['dataset create-from-csv', 'mutation'],
  ['workshop module update', 'mutation'],
  ['workshop module publish', 'mutation'],
  ['workshop module create', 'mutation'],
  ['automate create', 'mutation'],
  ['automate update', 'mutation'],
  ['automate pause', 'mutation'],
  ['automate resume', 'mutation'],
  ['pipeline sandbox create', 'mutation'],
  ['pipeline sandbox archive', 'mutation'],
  ['pipeline edit', 'mutation'],
  ['pipeline publish', 'mutation'],
  ['pipeline deploy', 'mutation'],
  ['dataset branches delete', 'mutation'],
  ['repository branch delete', 'mutation'],
  ['repository checks required set', 'mutation'],
  ['repository checks required remove', 'mutation'],
  ['branch-protection repo protect', 'mutation'],
  ['branch-protection repo policy set', 'mutation'],
  ['branch-protection repo unprotect', 'mutation'],
  ['global-branch deploy', 'mutation'],
  ['repository pull-request merge', 'mutation'],
  ['orchestration schedules create', 'mutation'],
  ['orchestration schedules replace', 'mutation'],
  ['orchestration schedules run', 'mutation'],
  ['orchestration schedules unpause', 'mutation'],
  ['orchestration schedules pause', 'mutation'],
  ['orchestration schedules get', 'read-only'],
  ['connectivity import run', 'mutation'],
  ['connectivity import get-file', 'read-only'],
  ['connectivity import get-table', 'read-only'],
  ['ontology object-upsert', 'mutation'],
  ['resource delete', 'mutation'],
  ['dataset create', 'mutation'],
  ['folder create', 'mutation'],
  ['ai-fde run', 'mutation'],
  ['orchestration builds create', 'mutation'],
  ['repository tag create', 'mutation'],
  ['repository push', 'mutation'],
  ['repository imports add', 'mutation'],
  ['repository imports remove', 'mutation'],
  ['connectivity import create-file', 'mutation'],
  ['connectivity import create-table', 'mutation'],
  ['proposal merge', 'mutation'],
  ['proposal accept', 'mutation'],
  ['proposal approve', 'mutation'],
]
const MANIFEST = envelope({
  commands: COMMANDS.map(([path, kind, input]) => ({ path, kind, args: [], ...(input ? { input } : {}) })),
})

type Answer = string | 'throw'
type Harness = {
  /** Every orthanc call, without --agent, --non-interactive and --profile. */
  calls: string[]
  /** Every question put to the operator. */
  asked: string[]
  /** What the operator answers; 'throw': dismissed, or no one to ask. */
  answer: Answer
  store: Map<string, unknown>
}

function harness(on: On, mode: Mode = 'yolo'): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve', store: new Map<string, unknown>([['approvalMode', mode]]) }
  on('process.run', (_$, e) => {
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    // A clone of a Foundry repository: its remote names a stemma repository.
    if (e.argv[0] === 'git') return reply(`origin\thttps://tester.example.com/stemma/git/${REPO}/repo.git (push)\n`)
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    if (line === 'agent-manifest') return reply(MANIFEST)
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
    if (line === 'ontology list') return reply(envelope({ data: [{ rid: ONT.rid, display_name: ONT.name, api_name: ONT.name }] }))
    if (line.startsWith('global-branch create ')) return reply(envelope({ branch: { rid: MADE, display_name: words[2] } }))
    // A stored schedule or import: its branch is what its builds write.
    if (line.startsWith('orchestration schedules get ') || line.startsWith('connectivity import get-')) {
      const stored = STORED[words.find(word => word.startsWith('ri.')) ?? '']
      if (stored === undefined) return { value: { exitCode: 1, stdout: JSON.stringify({ schema_version: 'foundry-agent-v1', data: null, errors: [{ code: 'not_found', message: 'no such resource' }], meta: {}, warnings: [], artifacts: [], pagination: null }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (line.startsWith('connectivity import get-table') && stored.kind !== 'table') return { value: { exitCode: 1, stdout: JSON.stringify({ schema_version: 'foundry-agent-v1', data: null, errors: [{ code: 'not_found', message: 'not a table import' }], meta: {}, warnings: [], artifacts: [], pagination: null }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      if (line.startsWith('connectivity import get-file') && stored.kind !== 'file') return { value: { exitCode: 1, stdout: JSON.stringify({ schema_version: 'foundry-agent-v1', data: null, errors: [{ code: 'not_found', message: 'not a file import' }], meta: {}, warnings: [], artifacts: [], pagination: null }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
      return reply(envelope(stored.data))
    }
    return reply(envelope({ ran: line }))
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: {} }
  })
  on('store.get', (_$, e) => ({ value: h.store.get(e.key) }))
  on('store.set', (_$, e) => {
    h.store.set(e.key, e.value)
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
const say = async ($: Engine, command: string, args = '') =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)).text ?? ''
const write = ($: Engine, command: string, args: string[] = []) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const shell = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, command: string) => h.calls.filter(call => call.startsWith(command))
const prompt = async ($: Engine) =>
  ((await $.classic.SubagentStart({ agent_id: 'a', agent_type: 'foundry:foundry-scout' } as never)).additionalContext ?? []).join('\n')

// The calls that ask in every other mode: a delete, a --force write, a tag apply.
const ASKING: [string, string[]][] = [
  ['ontology object-type-delete', ['T', '--branch', GLOBAL, '--apply']],
  ['resource delete', [FOLDER, '--apply']],
  ['orchestration builds create', [TARGET, '--branch', 'agent-rebuild', '--force', '--apply']],
  ['repository tag create', [REPO, TAG, '--commit-hash', COMMIT, '--apply']],
]

test('Y1: in yolo a delete and a --force write run with no dialog, even with no one to ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of ASKING.filter(([command]) => command !== 'repository tag create')) {
    const wrote = await write($, command, args)
    expect({ command, deny: wrote.deny }).toEqual({ command, deny: undefined })
    expect({ command, ran: ran(h, command) }).toEqual({ command, ran: [`${command} ${args.join(' ')}`] })
  }
  expect(h.asked).toEqual([])
})

test('Y2: in yolo a release tag with no branch asks and, with no one to ask, is refused; on a global branch it runs with no dialog', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  expect(typeof (await write($, 'repository tag create', [REPO, TAG, '--commit-hash', COMMIT, '--apply'])).deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'repository tag create')).toEqual([])
  const linked = [REPO, TAG, '--commit-hash', COMMIT, '--branch', GLOBAL, '--apply']
  expect((await write($, 'repository tag create', linked)).deny).toBe(undefined)
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'repository tag create')).toEqual([`repository tag create ${linked.join(' ')}`])
})

for (const mode of OTHER_MODES) {
  test(`Y3: in ${mode} mode a delete, a --force write and a tag apply still ask, and do not run when declined`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Decline'
    for (const [command, args] of ASKING) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ command, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ command, denied: true, asked: 1 })
      expect({ command, ran: ran(h, command) }).toEqual({ command, ran: [] })
    }
  })
}

// Every spelling of the branch flag: --branch v, --branch=v, -b v, -bv, any case,
// and the args inside the command string.
const ON_MAIN: [string, string[]][] = [
  ...['main', 'master', 'refs/heads/master', 'HEAD'].map(branch => ['dataset create', ['/Tester/scratch/x', '--branch', branch, '--apply']] as [string, string[]]),
  ['dataset create', ['/Tester/scratch/x', '--branch=main', '--apply']],
  ['dataset create', ['/Tester/scratch/x', '--BRANCH=master', '--apply']],
  ['dataset create', ['/Tester/scratch/x', '-b', 'master', '--apply']],
  ['dataset create', ['/Tester/scratch/x', '-bmain', '--apply']],
  ['dataset create /Tester/scratch/x --branch main --apply', []],
  ['dataset create /Tester/scratch/x -b master --apply', []],
]

test('Y4: in yolo a write naming main, master or HEAD as its branch asks; it runs only when approved', async ($, on) => {
  const h = harness(on)
  for (const answer of ['Decline', 'throw'] as Answer[]) {
    h.answer = answer
    for (const [command, args] of ON_MAIN) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ answer, command, args, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ answer, command, args, denied: true, asked: 1 })
    }
    expect(ran(h, 'dataset create')).toEqual([])
  }
  h.answer = 'Approve'
  const asked = h.asked.length
  expect((await write($, 'dataset create', ['/Tester/scratch/x', '--branch', 'main', '--apply'])).deny).toBe(undefined)
  expect(h.asked.length).toBe(asked + 1)
  expect(ran(h, 'dataset create').length).toBe(1)
  expect((await write($, 'dataset create', ['/Tester/scratch/x', '--branch', 'agent-scratch', '--apply'])).deny).toBe(undefined)
  expect(h.asked.length).toBe(asked + 1)
})

for (const mode of OTHER_MODES) {
  test(`Y4: in ${mode} mode a write naming main, in any spelling, still asks`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Decline'
    for (const [command, args] of ON_MAIN) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ command, args, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ command, args, denied: true, asked: 1 })
    }
    expect(ran(h, 'dataset create')).toEqual([])
  })
}

test('Y4: branching off master and naming master as a base, fallback or parent still run in yolo', async ($, on) => {
  const h = harness(on)
  for (const [command, args] of [
    ['global-branch create', ['agent/yolo-base']],
    ['orchestration builds create', [TARGET, '--branch', 'agent-rebuild', '--fallback-branch', 'master', '--apply']],
  ] as [string, string[]][]) {
    expect({ command, deny: (await write($, command, args)).deny }).toEqual({ command, deny: undefined })
  }
  expect(h.asked).toEqual([])
})

test('Y5: in yolo the silo holds: branchless, main-only, merges and default-branch pushes are refused and ask no one', async ($, on) => {
  const h = harness(on)
  for (const [command, args] of [
    ['ontology object-type-upsert', ['T', '--apply']],
    ['ontology object-type-delete', ['T', '--apply']],
    ['ontology object-upsert', ['T', '--apply']],
    ['proposal merge', ['ri.branch..proposal.c0000000-0000-4000-8000-0000000000f1', '--apply']],
    ['proposal accept', ['ri.branch..proposal.c0000000-0000-4000-8000-0000000000f1', '--apply']],
    ['proposal approve', ['ri.branch..proposal.c0000000-0000-4000-8000-0000000000f1', '--apply']],
    ['repository push', [REPO, 'HEAD', 'master', '--apply']],
    ['repository push', [REPO, 'HEAD', 'agent-fix', '--allow-default-branch', '--apply']],
  ] as [string, string[]][]) {
    const wrote = await write($, command, args)
    expect({ command, args, denied: typeof wrote.deny === 'string' }).toEqual({ command, args, denied: true })
  }
  const pushed = await shell($, 'cd /home/tester/clone && git push origin agent-fix')
  expect(typeof pushed.deny).toBe('string')
  expect(h.asked).toEqual([])
  expect(h.calls.filter(call => !['agent-manifest', 'version', 'configure list'].includes(call))).toEqual([])
})

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y6: in ${mode} mode writes that land on master by default need a work branch`, async ($, on) => {
    const h = harness(on, mode)
    for (const [command, args] of [
      ['connectivity import create-file', [SOURCE, '--dataset', DATASET, '--name', 'orders', '--apply']],
      ['connectivity import create-table', [SOURCE, '--dataset', DATASET, '--name', 'orders', '--apply']],
      ['repository imports add', [REPO, '--branch', 'agent-imports', '--allow-default-branch', '--source', SOURCE, '--apply']],
      ['repository imports remove', [REPO, '--source', SOURCE, '--apply']],
    ] as [string, string[]][]) {
      const wrote = await write($, command, args)
      expect({ command, args, denied: typeof wrote.deny === 'string' }).toEqual({ command, args, denied: true })
    }
    expect(h.asked).toEqual([])
    // Naming master or main is a write on main: it asks, and declined it does not run.
    h.answer = 'Decline'
    for (const [command, args] of [
      ['connectivity import create-file', [SOURCE, '--dataset', DATASET, '--name', 'orders', '--branch', 'master', '--apply']],
      ['repository imports add', [REPO, '--branch', 'master', '--source', SOURCE, '--apply']],
      ['repository imports remove', [REPO, '--branch', 'main', '--source', SOURCE, '--apply']],
    ] as [string, string[]][]) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ command, args, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ command, args, denied: true, asked: 1 })
    }
    expect(h.calls.filter(call => call.startsWith('connectivity ') || call.startsWith('repository imports'))).toEqual([])
  })
}

test('Y6: with a work branch, imports run in yolo', async ($, on) => {
  const h = harness(on)
  expect((await write($, 'connectivity import create-file', [SOURCE, '--dataset', DATASET, '--name', 'orders', '--branch', 'agent-orders', '--apply'])).deny).toBe(undefined)
  expect((await write($, 'repository imports add', [REPO, '--branch', 'agent-imports', '--source', SOURCE, '--apply'])).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(ran(h, 'connectivity import create-file').length).toBe(1)
  expect(ran(h, 'repository imports add').length).toBe(1)
})

test('Y7: in yolo a third identical call runs', async ($, on) => {
  harness(on)
  for (let index = 0; index < 4; index += 1) {
    expect({ index, deny: (await shell($, 'bd show hooks-y7')).deny }).toEqual({ index, deny: undefined })
  }
})

test('Y7: in auto mode the loop guard still refuses a third identical call', async ($, on) => {
  harness(on, 'auto')
  expect((await shell($, 'bd show hooks-y7-auto')).deny).toBe(undefined)
  expect((await shell($, 'bd show hooks-y7-auto')).deny).toBe(undefined)
  expect(typeof (await shell($, 'bd show hooks-y7-auto')).deny).toBe('string')
})

test('Y8: -f is not --force: in allow-edits mode ai-fde run -f json and folder create -f run without asking; --force asks', async ($, on) => {
  const h = harness(on, 'allow-edits')
  h.answer = 'Decline'
  expect((await write($, 'ai-fde run', ['List the object types', '-f', 'json', '--apply'])).deny).toBe(undefined)
  expect((await write($, 'folder create', ['Scratch', '-f', FOLDER, '--apply'])).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(typeof (await write($, 'orchestration builds create', [TARGET, '--branch', 'agent-rebuild', '--force', '--apply'])).deny).toBe('string')
  expect(h.asked.length).toBe(1)
})

test('Y9: the yolo prompt says nothing asks and what stays refused', async ($, on) => {
  harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  const text = await prompt($)
  expect(text).toContain('Foundry approval mode: yolo')
  expect(text).toContain('Nothing asks the operator except a write on main')
  expect(text).toContain('Writes without a branch, merges and default-branch pushes are blocked in every mode')
  expect(text).toContain('A write that names main or master as its branch asks the operator')
  expect(text.includes('ask the operator in every mode')).toBe(false)
})

test('Y9: the auto prompt still says release tags ask', async ($, on) => {
  harness(on, 'auto')
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  const text = await prompt($)
  expect(text).toContain('Foundry approval mode: auto')
  expect(text).toContain('Release tags (repository tag create --apply) ask the operator in every mode except yolo')
})

test('Y10: in FDE mode under yolo an apply still needs its dry run; then a bound delete runs with no dialog', async ($, on) => {
  const h = harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  expect(await say($, 'ontology', ONT.rid)).toContain(ONT.name)
  expect(await say($, 'fde', 'on')).toContain('FDE mode on')
  expect(typeof (await write($, 'ontology object-type-delete', [ONT.rid, 'T', '--apply'])).deny).toBe('string')
  expect(ran(h, 'ontology object-type-delete')).toEqual([])
  expect((await write($, 'ontology object-type-delete', [ONT.rid, 'T'])).deny).toBe(undefined)
  expect((await write($, 'ontology object-type-delete', [ONT.rid, 'T', '--apply'])).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(ran(h, 'ontology object-type-delete').filter(call => call.includes('--apply')).length).toBe(1)
})

const CREDENTIAL_CALLS: [string, string[]][] = [
  ['auth store', ['tester']],
  // Orthanc marks these `host-and-token`, not `token-on-stdin`: a name list
  // misses them, and `--force` replaces the credentials of a live profile.
  ['configure profile create', ['other', '--host', 'https://other.example.com', '--token-stdin']],
  ['configure profile create', ['tester', '--host', 'https://tester.example.com', '--token-stdin', '--force']],
  ['onboarding', []],
]

// What the tool answered with, for a call that never reached orthanc.
const refusedWith = (wrote: { result?: unknown }) => {
  if (typeof wrote.result !== 'string') return undefined
  try {
    const parsed = JSON.parse(wrote.result) as { errors?: { type?: string; message?: string }[] }
    return parsed.errors?.[0]
  } catch {
    return undefined
  }
}

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y11: in ${mode} mode no credential command runs, whatever flag it carries`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Approve'
    for (const [command, args] of CREDENTIAL_CALLS) {
      const error = refusedWith(await write($, command, args))
      expect({ command, args, type: error?.type }).toEqual({ command, args, type: 'credential-command-denied' })
      expect(error?.message ?? '').toContain(command)
    }
    for (const [command] of CREDENTIAL_CALLS) expect({ command, ran: ran(h, command) }).toEqual({ command, ran: [] })
  })
}

test('Y11: in yolo a credential command is refused by name, and asks no one', async ($, on) => {
  const h = harness(on)
  const error = refusedWith(await write($, 'configure profile create', ['other', '--host', 'https://other.example.com', '--token-stdin']))
  expect(error?.type).toBe('credential-command-denied')
  expect(error?.message ?? '').toContain("'configure profile create'")
  expect(h.asked).toEqual([])
})

test('Y12: an Orthanc write in Bash is refused in yolo and asks no one', async ($, on) => {
  const h = harness(on)
  expect(typeof (await shell($, `orthanc dataset create /Tester/scratch/x --branch agent-scratch --apply`)).deny).toBe('string')
  expect(h.asked).toEqual([])
  expect(ran(h, 'dataset create')).toEqual([])
})

// Real Orthanc commands that take --branch, each naming main in one spelling.
const BRANCH_WRITES_ON_MAIN: [string, string[]][] = [
  ['dataset schema set', [DATASET, '--schema-file', 's.json', '--branch', 'main', '--apply']],
  ['dataset schema set', [DATASET, '--schema-file', 's.json', '-b', 'master', '--apply']],
  ['dataset schema set', [DATASET, '--schema-file', 's.json', '-bmain', '--apply']],
  ['dataset schema set', [DATASET, '--schema-file', 's.json', '--branch=HEAD', '--apply']],
  ['orchestration builds create', [TARGET, '--branch', 'master', '--apply']],
  ['ontology object-type-upsert', ['T', '--branch', 'main', '--apply']],
  ['repository imports add', [REPO, '--branch=master', '--source', SOURCE, '--apply']],
  ['dataset create-from-csv', ['orders', FOLDER, 'orders.csv', '--branch', 'master', '--apply']],
  ['workshop module update', ['ri.workshop.main.module.c0000000-0000-4000-8000-0000000000c4', '--definition', 'm.json', '--branch', 'main', '--apply']],
  ['dataset schema set /x --branch main --apply', []],
]
const SETUP_CALLS = ['agent-manifest', 'version', 'configure list']

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y13: in ${mode} mode a real branch write naming main asks once; declined or no one to ask, it is refused; approved, it runs`, async ($, on) => {
    const h = harness(on, mode)
    for (const answer of ['Decline', 'throw'] as Answer[]) {
      h.answer = answer
      for (const [command, args] of BRANCH_WRITES_ON_MAIN) {
        const before = h.asked.length
        const wrote = await write($, command, args)
        expect({ answer, command, args, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ answer, command, args, denied: true, asked: 1 })
      }
    }
    expect(h.calls.filter(call => !SETUP_CALLS.includes(call))).toEqual([])
    h.answer = 'Approve'
    for (const [command, args] of BRANCH_WRITES_ON_MAIN) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ command, args, deny: wrote.deny, asked: h.asked.length - before }).toEqual({ command, args, deny: undefined, asked: 1 })
    }
    expect(ran(h, 'dataset schema set').length).toBe(5)
    expect(ran(h, 'orchestration builds create').length).toBe(1)
    expect(ran(h, 'ontology object-type-upsert').length).toBe(1)
  })
}

// Optional --branch, and main or master when it is left out.
const AUTOMATION = 'ri.automate.main.automation.c0000000-0000-4000-8000-0000000000c5'
const PIPELINE = 'ri.eddie.main.pipeline.c0000000-0000-4000-8000-0000000000c6'
const BRANCHLESS_ON_MAIN: [string, string[]][] = [
  ['dataset create-from-csv', ['orders', FOLDER, 'orders.csv', '--apply']],
  ['workshop module update', ['ri.workshop.main.module.c0000000-0000-4000-8000-0000000000c4', '--definition', 'm.json', '--apply']],
  ['automate update', [AUTOMATION, '--file', 'a.json', '--apply']],
  ['automate pause', [AUTOMATION, '--apply']],
  ['automate resume', [AUTOMATION, '--apply']],
  ['pipeline sandbox create', [PIPELINE, '--apply']],
  ['pipeline sandbox archive', [PIPELINE, '--apply']],
  ['pipeline edit', [PIPELINE, '--logic', 'l.json', '--apply']],
  ['pipeline publish', [PIPELINE, '--apply']],
  ['pipeline deploy', [PIPELINE, '--apply']],
]

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y14: in ${mode} mode a write that lands on main when --branch is left out is refused and asks no one`, async ($, on) => {
    const h = harness(on, mode)
    for (const [command, args] of BRANCHLESS_ON_MAIN) {
      const wrote = await write($, command, args)
      expect({ command, args, denied: typeof wrote.deny === 'string' }).toEqual({ command, args, denied: true })
    }
    expect(h.asked).toEqual([])
    expect(h.calls.filter(call => !SETUP_CALLS.includes(call))).toEqual([])
  })
}

test('Y14: with a work branch, those writes run in yolo with no ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of BRANCHLESS_ON_MAIN) {
    const branch = command.startsWith('dataset ') ? 'agent-orders' : GLOBAL
    const wrote = await write($, command, [...args.slice(0, -1), '--branch', branch, '--apply'])
    expect({ command, deny: wrote.deny }).toEqual({ command, deny: undefined })
  }
  expect(h.asked).toEqual([])
  for (const [command] of BRANCHLESS_ON_MAIN) expect({ command, ran: ran(h, command).length }).toEqual({ command, ran: 1 })
})

const MODULE = 'ri.workshop.main.module.c0000000-0000-4000-8000-0000000000c4'
for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y15: in ${mode} mode workshop module publish, which works on main only, asks; no one to ask, it is refused`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'throw'
    expect(typeof (await write($, 'workshop module publish', [MODULE, '--apply'])).deny).toBe('string')
    expect(h.asked.length).toBe(1)
    expect(ran(h, 'workshop module publish')).toEqual([])
    h.answer = 'Approve'
    expect((await write($, 'workshop module publish', [MODULE, '--apply'])).deny).toBe(undefined)
    expect(ran(h, 'workshop module publish').length).toBe(1)
  })
}

test('Y15: in yolo a new module or a paused automation, which change nothing on main, run with no ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  expect((await write($, 'workshop module create', ['--folder', FOLDER, '--name', 'm', '--apply'])).deny).toBe(undefined)
  expect((await write($, 'automate create', ['--file', 'a.json', '--apply'])).deny).toBe(undefined)
  expect(h.asked).toEqual([])
})

// Every spelling the matcher must read as main, master or HEAD, and every near
// miss it must not: a bounded, exhaustive check at the ladder.
const Y16_MANIFEST: ManifestCommand[] = [
  { path: 'dataset schema set', kind: 'mutation' },
  { path: 'orchestration builds create', kind: 'mutation' },
  { path: 'repository checks rerun', kind: 'mutation' },
]
const casings = (name: string) => [name.toLowerCase(), name.toUpperCase(), name[0]!.toUpperCase() + name.slice(1).toLowerCase()]
const PREFIXES = ['', 'refs/heads/', 'heads/', './', '+', ':', '+refs/heads/', 'refs//heads//']
const SUFFIXES = ['', '/', '.', ':']
const flagForms = (value: string): string[][] => [
  ['--branch', value], [`--branch=${value}`], ['-b', value], [`-b${value}`], ['-B', value], ['--BRANCH', value],
  ['--branch', `'${value}'`], ['--branch', `"${value}"`], [`--branch='${value}'`], ['--branch', ` ${value} `],
]
const ALL_MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const decide = (mode: Mode, command: string, args: string[]) => {
  const classified = classifyCall(CLI, { command, args }, Y16_MANIFEST, null)
  return classified === null ? 'read' : ladderDecision(mode, classified, { action: 'approve', reason: 'ok' }).outcome
}

test('Y16: every spelling of main, master and HEAD asks, in every mode', async () => {
  let checked = 0
  let asked = 0
  const missed: string[] = []
  for (const name of ['main', 'master', 'HEAD'])
    for (const cased of casings(name))
      for (const prefix of PREFIXES)
        for (const suffix of SUFFIXES)
          for (const form of flagForms(`${prefix}${cased}${suffix}`))
            for (const mode of ALL_MODES) {
              checked += 1
              const args = [DATASET, '--schema-file', 's.json', ...form, '--apply']
              const outcome = decide(mode, 'dataset schema set', args)
              // A real spelling asks. A malformed one (-B or --BRANCH, which Orthanc
              // does not take, or a value with a character no branch uses) may be
              // refused outright, but never runs.
              const value = `${prefix}${cased}${suffix}`
              const real = form[0] !== '-B' && form[0] !== '--BRANCH' && /^[A-Za-z0-9._/-]+$/.test(value)
              if (real ? outcome !== 'ask' : outcome === 'run') missed.push(`${mode} ${args.join(' ')} → ${outcome}`)
              if (real) asked += 1
            }
  expect({ missed: missed.length, first: missed.slice(0, 10) }).toEqual({ missed: 0, first: [] })
  // 5 prefixes and 3 suffixes are real spellings, and 8 of the 10 flag forms.
  expect(asked).toBe(3 * 3 * 5 * 3 * 8 * ALL_MODES.length)
  expect(checked).toBe(3 * 3 * PREFIXES.length * SUFFIXES.length * 10 * ALL_MODES.length)
})

test('Y16: a branch that only looks like main runs in yolo with no ask', async () => {
  const missed: string[] = []
  for (const branch of ['main-fix', 'agent/main', 'maintenance', 'mainline', 'master2', 'agent-master', 'headless', 'head-fix', 'refs/heads/main-x', 'feature/HEAD', GLOBAL])
    // -B and --BRANCH are not Orthanc flags: such a call names no branch and is refused.
    for (const form of flagForms(branch).filter(form => form[0] !== '-B' && form[0] !== '--BRANCH')) {
      const args = [DATASET, '--schema-file', 's.json', ...form, '--apply']
      const outcome = decide('yolo', 'dataset schema set', args)
      if (outcome !== 'run') missed.push(`${args.join(' ')} → ${outcome}`)
    }
  for (const args of [
    [TARGET, '--branch', 'agent-rebuild', '--fallback-branch', 'master', '--apply'],
    [TARGET, '--branch', 'agent-rebuild', '--fallback-branches', 'main,master', '--apply'],
  ]) {
    const outcome = decide('yolo', 'orchestration builds create', args)
    if (outcome !== 'run') missed.push(`${args.join(' ')} → ${outcome}`)
  }
  expect(missed).toEqual([])
})

test('Y17: in FDE mode under yolo a write naming main is refused, not asked', async ($, on) => {
  const h = harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  expect(await say($, 'ontology', ONT.rid)).toContain(ONT.name)
  expect(await say($, 'fde', 'on')).toContain('FDE mode on')
  for (const args of [[ONT.rid, 'T', '--branch', 'main'], [ONT.rid, 'T', '--branch', 'main', '--apply']]) {
    expect(typeof (await write($, 'ontology object-type-upsert', args)).deny).toBe('string')
  }
  expect(h.asked).toEqual([])
  expect(ran(h, 'ontology object-type-upsert')).toEqual([])
})

// The branch is a positional here, not a --branch flag.
const POSITIONAL_ON_MAIN: [string, string[]][] = [
  ['dataset branches delete', [DATASET, 'master', '--apply']],
  ['repository branch delete', [REPO, 'refs/heads/main', '--apply']],
  ['repository branch delete', ['--yes', REPO, 'main', '--apply']],
  ['repository checks required set', [REPO, 'master', '--check', 'build', '--apply']],
  ['repository checks required remove', [REPO, 'main', '--check', 'build', '--apply']],
  ['branch-protection repo protect', [REPO, 'master', '--apply']],
  ['branch-protection repo policy set', [REPO, 'master', '--min-approvals', '0', '--apply']],
  ['branch-protection repo unprotect', [REPO, 'master', '--apply']],
  ['branch-protection repo unprotect', [REPO, 'HEAD', '--apply']],
]

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y18: in ${mode} mode a write naming main as a positional branch asks; no one to ask, it is refused`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'throw'
    for (const [command, args] of POSITIONAL_ON_MAIN) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ command, args, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ command, args, denied: true, asked: 1 })
    }
    expect(h.calls.filter(call => !SETUP_CALLS.includes(call))).toEqual([])
  })
}

test('Y18: in yolo the same writes on a work branch run with no ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of POSITIONAL_ON_MAIN) {
    const onWork = args.map(arg => (['master', 'main', 'refs/heads/main', 'HEAD'].includes(arg) ? 'agent-work' : arg))
    expect({ command, deny: (await write($, command, onWork)).deny }).toEqual({ command, deny: undefined })
  }
  expect(h.asked).toEqual([])
})

test('Y16: on a command the branch rule does not cover, no spelling of main runs', async () => {
  const ran: string[] = []
  let checked = 0
  for (const name of ['main', 'master', 'HEAD'])
    for (const cased of casings(name))
      for (const prefix of PREFIXES)
        for (const suffix of SUFFIXES)
          for (const form of flagForms(`${prefix}${cased}${suffix}`))
            for (const mode of ALL_MODES) {
              checked += 1
              const args = [REPO, ...form, '--apply']
              const outcome = decide(mode, 'repository checks rerun', args)
              if (outcome === 'run') ran.push(`${mode} ${args.join(' ')}`)
            }
  expect({ ran: ran.length, first: ran.slice(0, 10) }).toEqual({ ran: 0, first: [] })
  expect(checked).toBe(3 * 3 * PREFIXES.length * SUFFIXES.length * 10 * ALL_MODES.length)
})

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y19: in ${mode} mode a promotion into main is refused and asks no one`, async ($, on) => {
    const h = harness(on, mode)
    for (const [command, args] of [
      ['global-branch deploy', [GLOBAL, '--proposal', 'ri.branch..proposal.c0000000-0000-4000-8000-0000000000f1', '--apply', '--yes']],
      ['repository pull-request merge', [REPO, '7', '--apply', '--yes']],
    ] as [string, string[]][]) {
      const wrote = await write($, command, args)
      expect({ command, denied: typeof wrote.deny === 'string' }).toEqual({ command, denied: true })
    }
    expect(h.asked).toEqual([])
    expect(h.calls.filter(call => !SETUP_CALLS.includes(call))).toEqual([])
  })
}

const action = (extra: Record<string, unknown>) => JSON.stringify({ type: 'build', target: { type: 'manual', targetRids: [DATASET] }, ...extra })

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y20: in ${mode} mode a schedule action with no branch, or one the guard cannot read, is refused and asks no one`, async ($, on) => {
    const h = harness(on, mode)
    for (const args of [
      [action({}), '--trigger', '{"type":"time","cronExpression":"0 3 * * *"}', '--apply'],
      ['--apply'],
      ['{not json', '--apply'],
    ]) {
      const wrote = await write($, 'orchestration schedules create', args)
      expect({ args, denied: typeof wrote.deny === 'string' }).toEqual({ args, denied: true })
    }
    expect(typeof (await write($, 'orchestration schedules replace', [SCHED(3), action({}), '--apply'])).deny).toBe('string')
    expect(h.asked).toEqual([])
    expect(ran(h, 'orchestration schedules')).toEqual([])
  })

  test(`Y20: in ${mode} mode a schedule or import whose builds write master asks; no one to ask, it is refused`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'throw'
    for (const [command, args] of [
      ['orchestration schedules create', [action({ branchName: 'master' }), '--apply']],
      ['orchestration schedules create', [action({ branchName: 'refs/heads/main' }), '--apply']],
      ['orchestration schedules replace', [SCHED(3), action({ branchName: 'master' }), '--apply']],
      ['orchestration schedules run', [SCHED(1), '--apply']],
      ['orchestration schedules run', [SCHED(2), '--apply']],
      ['orchestration schedules run', [SCHED(9), '--apply']],
      ['orchestration schedules unpause', [SCHED(1), '--apply']],
      ['connectivity import run', [IMPORT(1), '--apply']],
      ['connectivity import run', [IMPORT(2), '--kind', 'table', '--apply']],
      ['connectivity import run', [IMPORT(9), '--apply']],
    ] as [string, string[]][]) {
      const before = h.asked.length
      const wrote = await write($, command, args)
      expect({ command, args, denied: typeof wrote.deny === 'string', asked: h.asked.length - before }).toEqual({ command, args, denied: true, asked: 1 })
    }
    expect(ran(h, 'orchestration schedules create')).toEqual([])
    expect(ran(h, 'orchestration schedules replace')).toEqual([])
    expect(ran(h, 'orchestration schedules run')).toEqual([])
    expect(ran(h, 'orchestration schedules unpause')).toEqual([])
    expect(ran(h, 'connectivity import run')).toEqual([])
  })
}

test('Y20: in yolo a schedule or import on a work branch runs with no ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of [
    ['orchestration schedules create', [action({ branchName: 'agent-nightly', fallbackBranches: ['master'] }), '--trigger', '{"type":"time","cronExpression":"0 3 * * *"}', '--apply']],
    ['orchestration schedules replace', [SCHED(3), action({ branchName: 'agent-nightly' }), '--apply']],
    ['orchestration schedules run', [SCHED(3), '--apply']],
    ['orchestration schedules unpause', [SCHED(3), '--apply']],
    ['orchestration schedules pause', [SCHED(1), '--apply']],
    ['connectivity import run', [IMPORT(3), '--apply']],
  ] as [string, string[]][]) {
    expect({ command, args, deny: (await write($, command, args)).deny }).toEqual({ command, args, deny: undefined })
  }
  expect(h.asked).toEqual([])
  expect(ran(h, 'orchestration schedules run').length).toBe(1)
  expect(ran(h, 'connectivity import run').length).toBe(1)
})
