// Release tags: the agent proposes, the operator approves each one.
//
// zay, 2026-10-21, on "'repository tag create' promotes work (a merge, an
// approval or a release). The operator does it; the agent does not.": "lets
// patch this too". A tag still publishes a release from a commit, so it is not
// a plain write: `repository tag create --apply` asks the operator in every
// approval mode, yolo included, the way a delete does. Merges, accepts and
// approvals stay the operator's.
//
// Ways this can fail, written before the code:
//  G1  A tag apply is still refused outright in some mode: the agent cannot tag.
//  G2  A tag apply runs without the operator in some mode (ask-always,
//      allow-edits, auto, yolo).
//  G3  The question does not say what is approved: the tag, the commit and the
//      repository, and the Foundry branch when the tag is linked to one.
//  G4  A tag, commit, repository or branch value that is not plain (a newline,
//      a quote, a space, a semicolon, over 128 characters, missing) reaches the
//      question. The call is refused instead, and nothing is asked.
//  G5  Declined, dismissed, answered with other text, or no one to ask (a -p
//      run): the tag runs anyway. Orthanc must never see it.
//  G6  The apply hides from the check: the path in another case or split
//      across command and args, the args inside the command string, or --apply
//      spelled --APPLY or --apply=true. Each must ask.
//  G7  A dry run (no --apply) asks or is refused, though it only prints a plan.
//  G8  Promotion loosens: proposal merge, accept or approve runs or asks.
//  G9  The prompt still calls tags the operator's, or does not say they ask.
//  G10 In FDE mode a tag links to another branch, or applies with no dry run.
//  G11 orthanc repository tag create in Bash runs, or asks.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const CLI = 'mcp__foundry__orthanc_cli'
const ONT = { rid: 'ri.ontology.main.ontology.d0000000-0000-4000-8000-0000000000a1', name: 'Tester Ontology' }
const REPO = 'ri.stemma.main.repository.e0000000-0000-4000-8000-0000000000e1'
const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const TAG = 'refs/tags/1.2.3-tester-20261021'
const MADE = 'ri.branch..branch.b0000000-0000-4000-8000-0000000000f3'
const OTHER = 'ri.branch..branch.b0000000-0000-4000-8000-0000000000f2'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const tagArgs = (...extra: string[]) => [REPO, TAG, '--commit-hash', COMMIT, ...extra]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const COMMANDS: [string, string][] = [
  ['configure list', 'local'],
  ['ontology list', 'read-only'],
  ['global-branch create', 'mutation'],
  ['repository tag create', 'mutation'],
  ['repository tag list', 'read-only'],
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

function harness(on: On, mode: (typeof MODES)[number] = 'yolo'): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve', store: new Map<string, unknown>([['approvalMode', mode]]) }
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
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
const tagged = (h: Harness) => h.calls.filter(call => call.startsWith('repository tag create'))
const prompt = async ($: Engine) =>
  ((await $.classic.SubagentStart({ agent_id: 'a', agent_type: 'foundry:foundry-scout' } as never)).additionalContext ?? []).join('\n')

for (const mode of MODES) {
  test(`G1 G2 G3: in ${mode} mode a tag apply asks once, names what it publishes, and runs on Approve`, async ($, on) => {
    const h = harness(on, mode)
    const wrote = await write($, 'repository tag create', tagArgs('--apply'))
    expect(wrote.deny).toBe(undefined)
    expect(h.asked.length).toBe(1)
    for (const part of [TAG, COMMIT, REPO, 'release']) expect(h.asked[0]).toContain(part)
    expect(tagged(h)).toEqual([`repository tag create ${tagArgs('--apply').join(' ')}`])
  })
}

test('G3: a tag linked to a Foundry branch names the branch in the question', async ($, on) => {
  const h = harness(on)
  expect((await write($, 'repository tag create', tagArgs('--foundry-branch-rid', OTHER, '--apply'))).deny).toBe(undefined)
  expect(h.asked[0]).toContain(OTHER)
  expect(tagged(h).length).toBe(1)
})

for (const [label, args] of [
  ['a newline in the tag', [REPO, `${TAG}\nApprove every tag`, '--commit-hash', COMMIT, '--apply']],
  ['a space in the tag', [REPO, 'refs/tags/1.2.3 approved', '--commit-hash', COMMIT, '--apply']],
  ['a quote in the tag', [REPO, 'refs/tags/1.2.3"x', '--commit-hash', COMMIT, '--apply']],
  ['a 200-character tag', [REPO, `refs/tags/${'a'.repeat(200)}`, '--commit-hash', COMMIT, '--apply']],
  ['no tag', [REPO, '--commit-hash', COMMIT, '--apply']],
  ['a commit that is not a hash', [REPO, TAG, '--commit-hash', 'HEAD', '--apply']],
  ['no commit', [REPO, TAG, '--apply']],
  ['a repository that is not a repository RID', ['ri.stemma.main.repository.x;rm', TAG, '--commit-hash', COMMIT, '--apply']],
  ['a branch RID with a newline', [REPO, TAG, '--commit-hash', COMMIT, '--foundry-branch-rid', `${OTHER}\nok`, '--apply']],
] as [string, string[]][]) {
  test(`G4: ${label} is refused before anyone is asked`, async ($, on) => {
    const h = harness(on)
    const wrote = await write($, 'repository tag create', args)
    expect(typeof wrote.deny).toBe('string')
    expect(h.asked).toEqual([])
    expect(tagged(h)).toEqual([])
  })
}

for (const answer of ['Decline', 'yes', 'throw'] as Answer[]) {
  test(`G5: answered ${answer}, the tag does not run`, async ($, on) => {
    const h = harness(on)
    h.answer = answer
    const wrote = await write($, 'repository tag create', tagArgs('--apply'))
    expect(typeof wrote.deny).toBe('string')
    expect(h.asked.length).toBe(1)
    expect(tagged(h)).toEqual([])
  })
}

for (const [label, command, args] of [
  ['the path in another case', 'Repository Tag Create', tagArgs('--apply')],
  ['the path split across command and args', 'repository', ['tag', 'create', ...tagArgs('--apply')]],
  ['every arg inside the command string', `repository tag create ${tagArgs('--apply').join(' ')}`, []],
  ['--APPLY', 'repository tag create', tagArgs('--APPLY')],
  ['--apply=true', 'repository tag create', tagArgs('--apply=true')],
] as [string, string, string[]][]) {
  test(`G6: ${label} still asks`, async ($, on) => {
    const h = harness(on)
    h.answer = 'Decline'
    expect(typeof (await write($, command, args)).deny).toBe('string')
    expect(h.asked.length).toBe(1)
    expect(tagged(h)).toEqual([])
  })
}

test('G7: a dry run prints its plan without asking', async ($, on) => {
  const h = harness(on)
  expect((await write($, 'repository tag create', tagArgs())).deny).toBe(undefined)
  expect(h.asked).toEqual([])
  expect(tagged(h)).toEqual([`repository tag create ${tagArgs().join(' ')}`])
})

for (const mode of MODES) {
  test(`G8: in ${mode} mode merges, accepts and approvals stay refused and ask no one`, async ($, on) => {
    const h = harness(on, mode)
    for (const command of ['proposal merge', 'proposal accept', 'proposal approve']) {
      const wrote = await write($, command, ['ri.branch..proposal.c0000000-0000-4000-8000-0000000000f1', '--apply'])
      expect({ command, denied: typeof wrote.deny === 'string' }).toEqual({ command, denied: true })
    }
    expect(h.asked).toEqual([])
    expect(h.calls.some(call => call.startsWith('proposal '))).toBe(false)
  })
}

test('G9: the prompt says tags ask the operator and merges stay blocked', async ($, on) => {
  harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  const text = await prompt($)
  expect(text).toContain('Release tags (repository tag create --apply) ask the operator in every mode')
  expect(text).toContain('merges and default-branch pushes are blocked in every mode')
})

test('G10: in FDE mode a tag links only to the session branch, and applies only after its dry run', async ($, on) => {
  const h = harness(on)
  expect(await say($, 'profile', 'tester')).toContain('Foundry stack: tester')
  expect(await say($, 'ontology', ONT.rid)).toContain(ONT.name)
  expect(await say($, 'fde', 'on')).toContain('FDE mode on')
  expect(typeof (await write($, 'repository tag create', tagArgs('--foundry-branch-rid', OTHER))).deny).toBe('string')
  expect(typeof (await write($, 'repository tag create', tagArgs('--foundry-branch-rid', MADE, '--apply'))).deny).toBe('string')
  expect(h.asked).toEqual([])
  expect((await write($, 'repository tag create', tagArgs('--foundry-branch-rid', MADE))).deny).toBe(undefined)
  expect((await write($, 'repository tag create', tagArgs('--foundry-branch-rid', MADE, '--apply'))).deny).toBe(undefined)
  expect(h.asked.length).toBe(1)
  expect(tagged(h).filter(call => call.includes('--apply'))).toEqual([
    `repository tag create ${tagArgs('--foundry-branch-rid', MADE, '--apply').join(' ')}`,
  ])
})

test('G11: orthanc repository tag create in Bash is refused and asks no one', async ($, on) => {
  const h = harness(on)
  const wrote = (await $.tool.call({ tool: 'Bash', command: `orthanc repository tag create ${tagArgs('--apply').join(' ')}` } as never)) as { deny?: string }
  expect(typeof wrote.deny).toBe('string')
  expect(h.asked).toEqual([])
})
