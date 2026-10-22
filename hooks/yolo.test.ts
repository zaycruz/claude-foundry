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
//  Y3  Another mode loosens: ask-always, allow-edits and auto stop asking for a
//      delete, a --force write or a tag apply.
//  Y4  In yolo a write that names main, master or HEAD as its branch runs (it did
//      in 0.5.0) or asks. It is refused, and no one is asked. Any spelling counts
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
//  Y11 A credential command (auth store) runs in yolo.
//  Y12 An Orthanc write in Bash runs in yolo instead of going to orthanc_cli.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

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
type Mode = 'ask-always' | 'allow-edits' | 'auto' | 'yolo'

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const COMMANDS: [string, string][] = [
  ['configure list', 'local'],
  ['auth store', 'local'],
  ['ontology list', 'read-only'],
  ['global-branch create', 'mutation'],
  ['ontology object-type-delete', 'mutation'],
  ['ontology object-type-upsert', 'mutation'],
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
const MANIFEST = envelope({ commands: COMMANDS.map(([path, kind]) => ({ path, kind, args: [] })) })

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
    return reply(envelope({ ran: line }))
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name, e.value)
    return { value: undefined }
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

test('Y1 Y2: in yolo a delete, a --force write and a tag apply run with no dialog, even with no one to ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of ASKING) {
    const wrote = await write($, command, args)
    expect({ command, deny: wrote.deny }).toEqual({ command, deny: undefined })
    expect({ command, ran: ran(h, command) }).toEqual({ command, ran: [`${command} ${args.join(' ')}`] })
  }
  expect(h.asked).toEqual([])
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

test('Y4: in yolo a write naming main, master or HEAD as its branch is refused and asks no one', async ($, on) => {
  const h = harness(on)
  for (const [command, args] of ON_MAIN) {
    const wrote = await write($, command, args)
    expect({ command, args, denied: typeof wrote.deny === 'string' }).toEqual({ command, args, denied: true })
  }
  expect(h.asked).toEqual([])
  expect(ran(h, 'dataset create')).toEqual([])
  expect((await write($, 'dataset create', ['/Tester/scratch/x', '--branch', 'agent-scratch', '--apply'])).deny).toBe(undefined)
  expect(ran(h, 'dataset create').length).toBe(1)
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
  expect(h.calls.filter(call => !['agent-manifest', 'configure list'].includes(call))).toEqual([])
})

for (const mode of ['ask-always', 'allow-edits', 'auto', 'yolo'] as const) {
  test(`Y6: in ${mode} mode writes that land on master by default need a work branch`, async ($, on) => {
    const h = harness(on, mode)
    for (const [command, args] of [
      ['connectivity import create-file', [SOURCE, '--dataset', DATASET, '--name', 'orders', '--apply']],
      ['connectivity import create-file', [SOURCE, '--dataset', DATASET, '--name', 'orders', '--branch', 'master', '--apply']],
      ['connectivity import create-table', [SOURCE, '--dataset', DATASET, '--name', 'orders', '--apply']],
      ['repository imports add', [REPO, '--branch', 'master', '--source', SOURCE, '--apply']],
      ['repository imports add', [REPO, '--branch', 'agent-imports', '--allow-default-branch', '--source', SOURCE, '--apply']],
      ['repository imports remove', [REPO, '--branch', 'main', '--source', SOURCE, '--apply']],
      ['repository imports remove', [REPO, '--source', SOURCE, '--apply']],
    ] as [string, string[]][]) {
      const wrote = await write($, command, args)
      expect({ command, args, denied: typeof wrote.deny === 'string' }).toEqual({ command, args, denied: true })
    }
    expect(h.asked).toEqual([])
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
  expect(text).toContain('Nothing asks the operator')
  expect(text).toContain('Writes without a branch, merges and default-branch pushes are blocked in every mode')
  expect(text).toContain('A write that names main or master as its branch is refused')
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

test('Y11: a credential command does not run in yolo', async ($, on) => {
  const h = harness(on)
  await write($, 'auth store', ['tester'])
  expect(ran(h, 'auth store')).toEqual([])
})

test('Y12: an Orthanc write in Bash is refused in yolo and asks no one', async ($, on) => {
  const h = harness(on)
  expect(typeof (await shell($, `orthanc dataset create /Tester/scratch/x --branch agent-scratch --apply`)).deny).toBe('string')
  expect(h.asked).toEqual([])
  expect(ran(h, 'dataset create')).toEqual([])
})
