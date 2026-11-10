// Manifest operator_approval, end to end through the plugin (bead orthanc-9s1q).
//
// The manifest below is orthanc PR #84's `branch-protection` entries as
// `orthanc agent-manifest` prints them (src/manifest_branch_protection.rs).
// These tests drive the real hooks: the manifest is parsed by manifestFrom,
// the call goes through the ladder, the operator is asked through the UI, and
// the harness records what reaches orthanc. Failure modes (A1-A12) are listed
// in foundry.test.ts; these cover the whole path for A1, A5, A7, A9 and the
// operator's answer:
//  E1  In some mode a governance write runs without a question.
//  E2  Declined, answered with other text, or no one to ask: it runs anyway.
//  E3  manifestFrom drops the field, so the guard never sees it.
//  E4  A partial match (a plan, turning protection on) asks in yolo.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const CLI = 'mcp__foundry__orthanc_cli'
const REPO = 'ri.stemma.main.repository.e0000000-0000-4000-8000-0000000000e1'
const MODULE = 'ri.workshop.main.module.e0000000-0000-4000-8000-0000000000e2'
const PROJECT = 'ri.compass.main.folder.e0000000-0000-4000-8000-0000000000e3'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const PROTECTION_ENTRIES = [
  { path: 'branch-protection repo list', kind: 'read-only', auth: 'bearer-token' },
  { path: 'branch-protection repo protect', kind: 'mutation', auth: 'bearer-token' },
  { path: 'branch-protection repo unprotect', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply'] } },
  { path: 'branch-protection resource get', kind: 'read-only', auth: 'bearer-token' },
  { path: 'branch-protection resource set', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply', '--off'] } },
  { path: 'branch-protection project get', kind: 'read-only', auth: 'bearer-token' },
  { path: 'branch-protection project set', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply', '--no-auto-protect-new-resources'] } },
  { path: 'branch-protection project policy get', kind: 'read-only', auth: 'bearer-token' },
  { path: 'branch-protection project policy create', kind: 'mutation', auth: 'bearer-token' },
  { path: 'branch-protection project policy update', kind: 'mutation', auth: 'bearer-token' },
  { path: 'branch-protection project policy delete', kind: 'mutation', auth: 'bearer-token', operator_approval: { when_all_flags: ['--apply'] } },
]
const BASE = [{ path: 'configure list', kind: 'local' }]

type Answer = string | 'throw'
type Harness = { calls: string[]; asked: string[]; answer: Answer }

function harness(on: On, mode: (typeof MODES)[number] = 'yolo', entries: unknown[] = PROTECTION_ENTRIES): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve' }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  const manifest = envelope({ commands: [...BASE, ...entries] })
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const stdout = line === 'agent-manifest' ? manifest : envelope({ ran: line })
    return { value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/tester' : undefined }))
  on('env.set', () => ({ value: undefined }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.stat', () => ({ value: { kind: 'other', size: 0, mtimeMs: 0, isLink: false } as never }))
  on('fs.read', (_$, e) => {
    throw new Error(`ENOENT: ${e.path}`)
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
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

const GOVERNANCE: [string, string[]][] = [
  ['branch-protection repo unprotect', [REPO, 'master', '--apply']],
  ['branch-protection resource set', [MODULE, '--off', '--apply']],
  ['branch-protection project set', [PROJECT, '--no-auto-protect-new-resources', '--apply']],
  ['branch-protection project policy delete', [PROJECT, '--expect-version', '3', '--apply']],
]

for (const mode of MODES) {
  test(`E1 E3: in ${mode} mode each governance write asks once, names itself, and runs on Approve`, async ($, on) => {
    const h = harness(on, mode)
    for (const [command, args] of GOVERNANCE) {
      const before = h.asked.length
      expect({ command, deny: (await write($, command, args)).deny }).toEqual({ command, deny: undefined })
      expect(h.asked.length).toBe(before + 1)
      expect(h.asked.at(-1)).toContain(`'${command}'`)
      expect(h.asked.at(-1)).toContain('governance control')
      expect(ran(h, command)).toEqual([`${command} ${args.join(' ')}`])
    }
  })
}

for (const answer of ['Decline', 'yes', 'throw'] as Answer[]) {
  test(`E2: answered ${answer}, a governance write never reaches orthanc`, async ($, on) => {
    const h = harness(on)
    h.answer = answer
    for (const [command, args] of GOVERNANCE) {
      expect(typeof (await write($, command, args)).deny).toBe('string')
      expect(ran(h, command)).toEqual([])
    }
    expect(h.asked.length).toBe(GOVERNANCE.length)
  })
}

test('E4: in yolo, plans and turning protection on run without a question', async ($, on) => {
  const h = harness(on)
  for (const [command, args] of [
    ['branch-protection repo unprotect', [REPO, 'master']],
    ['branch-protection resource set', [MODULE, '--off']],
    ['branch-protection resource set', [MODULE, '--on', '--apply']],
    ['branch-protection project set', [PROJECT, '--auto-protect-new-resources', '--apply']],
    ['branch-protection repo protect', [REPO, 'master', '--require-approval', '--apply']],
  ] as [string, string[]][]) {
    expect({ command, args, deny: (await write($, command, args)).deny }).toEqual({ command, args, deny: undefined })
  }
  expect(h.asked).toEqual([])
  expect(ran(h, 'branch-protection ').length).toBe(5)
})

test('E3 A7: an unreadable operator_approval in the manifest asks in yolo, even for a plan', async ($, on) => {
  const h = harness(on, 'yolo', [{ path: 'branch-protection resource set', kind: 'mutation', operator_approval: { when_any_flags: ['--off'] } }])
  h.answer = 'Decline'
  expect(typeof (await write($, 'branch-protection resource set', [MODULE])).deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]).toContain('governance control')
  expect(ran(h, 'branch-protection')).toEqual([])
})

test('A9: in Bash a governance write is refused and asks no one', async ($, on) => {
  const h = harness(on)
  const wrote = (await $.tool.call({ tool: 'Bash', command: `orthanc branch-protection repo unprotect ${REPO} master --apply` } as never)) as { deny?: string }
  expect(typeof wrote.deny).toBe('string')
  expect(h.asked).toEqual([])
  expect(ran(h, 'branch-protection')).toEqual([])
})
