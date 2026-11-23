// Two commands hand a token or a secret value to whoever runs them, and the
// agent is whoever runs them.
//
// Measured on the sha-256-verified orthanc v0.7.11 binary (an isolated HOME, one
// profile whose token is `synthetic-not-a-real-token-9f3b`, no network):
//
//   $ printf 'protocol=https\nhost=probe.example.palantirfoundry.com\n\n' \
//       | orthanc --agent --non-interactive repository git-credential get
//   username=orthanc
//   password=synthetic-not-a-real-token-9f3b
//
// `repository git-credential` is `kind: read-only` in the agent manifest, so the
// guard let it through as a read: no ladder, no ask, in every approval mode, and
// the printed token came back as the tool's answer. `compute env get` is
// `read-only` too; its own help says the value "is never printed", because it
// goes to a new 0600 file or to the clipboard for the operator — and a file the
// agent names is a file the agent then reads. Both break what README promises:
// "Tokens stay in the macOS Keychain and never pass through Claude".
//
// Ways this can fail, written before the code:
//  Q1 `orthanc_cli repository git-credential get` runs: the profile token is in
//     the tool output. Refused in every mode, asked in none, orthanc never starts.
//  Q2 Only one spelling is caught: `store` and `erase` (which do nothing) are
//     refused too, so the rule is one command name, not a flag read.
//  Q3 Bash prints the token back the same way, plain or piped into `tee`, or fed
//     the git key=value lines on stdin.
//  Q4 The rule eats the operator's own setup: `git config credential.<host>.helper
//     '!orthanc … repository git-credential'` names the command and is not a call.
//  Q5 `compute env get` is refused with every destination: --to-file v,
//     --to-file=v, --copy, and none (the destination is required by orthanc).
//  Q6 A read that writes a *data* file still runs in yolo with no ask:
//     `sql export -o`, `alias export --output`, `capabilities --output`. The rule
//     is these two commands, not "any read with a file flag".
//  Q7 The refusal names the command and the operator's terminal. It never points
//     at orthanc_cli for a call orthanc_cli also refuses (foundry.test.ts F20).
//  Q8 orthanc_help says so on the command's own page, so the agent is not sent
//     to try the call.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { renderCommand } from './orthanc'
import { classifyCall, ladderDecision, type ManifestCommand, operatorOnlyReason } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const APP = 'ri.foundry.main.deployed-app.c0000000-0000-4000-8000-0000000000c5'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

// The two commands as orthanc 0.7.11 declares them, plus the reads a rule that
// over-reads would catch with them.
const MANIFEST: ManifestCommand[] = [
  { path: 'agent-manifest', kind: 'local' },
  { path: 'repository git-credential', kind: 'read-only', auth: 'bearer-token' },
  { path: 'compute env get', kind: 'read-only', auth: 'bearer-token', flags: [{ flag: '--to-file', takesValue: true }, { flag: '--copy', takesValue: false }] },
  { path: 'sql export', kind: 'read-only', auth: 'bearer-token' },
  { path: 'alias export', kind: 'local' },
  { path: 'capabilities', kind: 'local' },
  { path: 'repository list', kind: 'read-only', auth: 'bearer-token' },
  { path: 'dataset create', kind: 'mutation' },
]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const MANIFEST_TEXT = envelope({ commands: MANIFEST.map(entry => ({ path: entry.path, kind: entry.kind, args: [] })) })

/** 'run' as null: the guard has no classification for the call, so nothing asks and it runs. */
const decide = (mode: Mode, tool: string, input: Record<string, unknown>) => {
  const classified = classifyCall(tool, input, MANIFEST, 'agent/foundry-fix-12')
  return classified === null ? null : ladderDecision(mode, classified, { action: 'approve', reason: 'guard model absent' }).outcome
}
const cli = (command: string, args: string[]) => MODES.map(mode => decide(mode, CLI, { command, args }))
const bash = (command: string) => MODES.map(mode => decide(mode, 'Bash', { command }))

type Harness = { calls: string[]; asked: string[]; answer: string; store: Map<string, unknown> }

function harness(on: On, mode: Mode = 'yolo'): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve', store: new Map<string, unknown>([['approvalMode', mode]]) }
  on('process.run', (_$, e) => {
    const words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    h.calls.push(words.join(' '))
    if (words.join(' ') === 'agent-manifest') return { value: { exitCode: 0, stdout: MANIFEST_TEXT, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
    return { value: { exitCode: 0, stdout: envelope({ ran: words.join(' ') }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const env = new Map<string, string>([['HOME', '/home/tester']])
  on('env.get', (_$, e) => ({ value: env.get(e.name) }))
  on('env.set', (_$, e) => {
    if (e.value === undefined) env.delete(e.name)
    else env.set(e.name)
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
    return { result: { questions: call.questions, answers: { [question]: h.answer } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const cliCall = ($: Engine, command: string, args: string[]) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const shell = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, prefix: string) => h.calls.filter(call => call.startsWith(prefix))

for (const mode of MODES) {
  test(`Q1: in ${mode} mode orthanc_cli repository git-credential get is refused, asks no one, and never starts orthanc`, async ($, on) => {
    const h = harness(on, mode)
    const denied = await cliCall($, 'repository git-credential', ['get'])
    expect(typeof denied.deny).toBe('string')
    expect(h.asked).toEqual([])
    expect(ran(h, 'repository git-credential')).toEqual([])
  })
}

test('Q2: every action of the credential helper is refused, and the refusal is one command name', async () => {
  for (const action of ['get', 'store', 'erase', 'GET']) {
    expect({ action, modes: cli('repository git-credential', [action]) }).toEqual({ action, modes: ['block', 'block', 'block', 'block'] })
  }
})

test('Q3: Bash that runs the credential helper is refused, however it is wrapped or piped', async () => {
  for (const command of [
    'orthanc repository git-credential get',
    'orthanc --agent repository git-credential get | tee /tmp/tester/cred.txt',
    "printf 'protocol=https\\nhost=probe.example.com\\n\\n' | orthanc --profile probe repository git-credential get",
    'cd /tmp/tester && /usr/local/bin/orthanc repository git-credential get > out.txt',
  ]) {
    expect({ command, modes: bash(command) }).toEqual({ command, modes: ['block', 'block', 'block', 'block'] })
  }
})

test('Q4: setting the helper up in git config is not a call, and still runs', async () => {
  const setup = `git config credential.https://probe.example.com.helper '!orthanc --profile probe repository git-credential'`
  expect({ setup, modes: bash(setup) }).toEqual({ setup, modes: [null, null, null, null] })
  const check = "git config --get credential.https://probe.example.com.helper; cat ~/.gitconfig | grep -c orthanc"
  expect({ check, modes: bash(check) }).toEqual({ check, modes: [null, null, null, null] })
})

for (const mode of MODES) {
  test(`Q5: in ${mode} mode compute env get is refused with every destination, asked in none`, async ($, on) => {
    const h = harness(on, mode)
    for (const args of [
      [APP, 'MODEL_API_KEY', '--to-file', 'key.txt'],
      [APP, 'MODEL_API_KEY', '--to-file=key.txt'],
      [APP, 'MODEL_API_KEY', '--TO-FILE', 'key.txt'],
      [APP, 'MODEL_API_KEY', `--to-file='key.txt'`],
      [APP, 'MODEL_API_KEY', '--copy'],
      [APP, 'MODEL_API_KEY'],
    ]) {
      const denied = await cliCall($, 'compute env get', args)
      expect({ args, deny: typeof denied.deny }).toEqual({ args, deny: 'string' })
    }
    expect(h.asked).toEqual([])
    expect(ran(h, 'compute env get')).toEqual([])
  })
}

test('Q5: the same spellings in Bash are refused', async () => {
  for (const command of [
    'orthanc compute env get ' + APP + ' MODEL_API_KEY --to-file key.txt',
    'orthanc compute env get ' + APP + ' MODEL_API_KEY --copy',
  ]) {
    expect({ command, modes: bash(command) }).toEqual({ command, modes: ['block', 'block', 'block', 'block'] })
  }
})

test('Q6: a read that writes a data file is not caught; it runs in yolo with no ask', async ($, on) => {
  const h = harness(on)
  h.answer = 'throw'
  for (const [command, args] of [
    ['sql export', ['--format', 'csv', 'SELECT 1', '-o', 'rows.csv']],
    ['alias export', ['--output', 'aliases.json']],
    ['capabilities', ['--output', 'caps.json']],
    ['repository list', []],
  ] as [string, string[]][]) {
    const wrote = await cliCall($, command, args)
    expect({ command, deny: wrote.deny }).toEqual({ command, deny: undefined })
  }
  expect(h.asked).toEqual([])
  for (const [command] of [
    ['sql export'],
    ['alias export'],
    ['capabilities'],
    ['repository list'],
  ])
    expect({ command, ran: ran(h, command).length }).toEqual({ command, ran: 1 })
  for (const command of ['orthanc sql export --format csv "SELECT 1" -o rows.csv', 'orthanc alias export --output aliases.json']) {
    expect({ command, modes: bash(command) }).toEqual({ command, modes: [null, null, null, null] })
  }
})

test('Q7: the refusal names the command and the operator terminal, and never points back at orthanc_cli', async ($, on) => {
  const h = harness(on)
  const denied = await cliCall($, 'repository git-credential', ['get'])
  const text = String(denied.deny)
  expect(text).toContain('repository git-credential')
  expect(text).toContain('terminal')
  expect(text).not.toMatch(/run .*with orthanc_cli|then run it with orthanc_cli/)
  const env = await cliCall($, 'compute env get', [APP, 'MODEL_API_KEY', '--to-file', 'key.txt'])
  const envText = String(env.deny)
  expect(envText).toContain('compute env get')
  expect(envText).toContain('terminal')
  expect(envText).not.toMatch(/orthanc_cli/)
  expect(h.asked).toEqual([])
})

test('Q8: orthanc_help marks both commands, and says why, on their own page', () => {
  for (const path of ['repository git-credential', 'compute env get']) {
    const entry = MANIFEST.find(candidate => candidate.path === path)!
    const tail = renderCommand(entry, `orthanc ${path} --help`).split('\n').at(-1) ?? ''
    expect({ path, tail }).toEqual({ path, tail: `Refused through orthanc_cli and Bash: ${operatorOnlyReason(path)}` })
    expect(tail).toContain('terminal')
  }
  const other = renderCommand(MANIFEST.find(entry => entry.path === 'sql export')!, 'orthanc sql export --help')
  expect(other).not.toContain('Refused through orthanc_cli and Bash')
})
