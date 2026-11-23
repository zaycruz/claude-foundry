// A stack the operator marked read-only runs no write.
//
// Orthanc v0.7.8 stores and enforces a read-only mark per profile: `orthanc
// configure profile set <name> --read-only`, and `configure list` reports it as
// `read_only`. The plugin read that list but kept only name, host, is_default
// and status, so nothing consulted the mark: in yolo a work-branch write on such
// a stack went up the ladder as 'run', orthanc started, and the refusal came
// back as an api/orthanc error — after the operator was asked, or after nothing
// was asked at all. the standing rule: a client's production stack is read-only, and a
// blocked call is reported with the exact call.
//
// Ways this can fail, written before the code:
//  Q1 A write on a marked stack goes up the ladder, so in yolo it runs, or the
//     operator is asked about it, instead of being refused before both.
//  Q2 The refusal does not name the exact call, or does not name the profile's
//     read_only mark, so the operator cannot see what was blocked or why.
//  Q3 A read on a marked stack is refused too; reads are what such a stack is for.
//  Q4 An unmarked stack changes decisions: a write the operator could run before
//     now asks or is refused.
//  Q5 `configure list` fails and the write runs blind. It must ask, and with no
//     answer it must not run.
//  Q6 `configure profile set <name> --no-read-only` runs in yolo with no ask, so
//     the agent clears the mark the operator set. It asks once, either way the
//     manifest marks it.
//  Q7 orthanc_help's first lines and /profile say nothing about which stacks are
//     read-only, so the agent learns it by being refused.
//  Q9 The plugin is stricter than orthanc: a plan (the same mutation with
//     --apply left off, or set false) is refused on a marked stack, though
//     orthanc runs "reads, plans and local commands", so an agent cannot preview
//     a change on a customer stack. A mutation with no --apply flag has no plan
//     to leave off, so it stays a write (orthanc reads that as no flag, RO14).
//  Q10 A local command (marking another stack, reading the aliases) is refused
//     too, though orthanc's gate skips kind local, so the operator's agent cannot
//     even add a mark while the active stack is read-only.
//  Q11 Nothing guards profile-settings.json, where orthanc keeps the mark, so a
//     Write, Edit or rm clears a mark past both the plugin gate and orthanc's.
//
// Synthetic stacks only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'

const CLI = 'mcp__foundry__orthanc_cli'
const HELP = 'mcp__foundry__orthanc_help'
const FOLDER = 'ri.compass.main.folder.00000000-0000-4000-8000-000000000000'
const DATASET = 'ri.foundry.main.dataset.00000000-0000-4000-8000-000000000000'
const ONT = 'ri.ontol.main.ontology.00000000-0000-4000-8000-000000000000'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })
const error = JSON.stringify({
  schema_version: 'foundry-agent-v1',
  data: null,
  errors: [{ type: 'internal', message: 'cannot read the profile store' }],
  meta: {},
  warnings: [],
  artifacts: [],
  pagination: null,
})
const APPLY = { flag: '--apply', kind: 'option', takes_value: false }
const ENTRIES = [
  { path: 'configure list', kind: 'local' },
  // The shipped shape of the clear (orthanc #SRC-163, src/manifest.rs:88): only
  // --no-read-only is operator_approval, scope "always"; --read-only is not.
  { path: 'configure profile set', kind: 'local', operator_approval: { when_all_flags: ['--no-read-only'] }, operator_approval_scope: 'always' },
  { path: 'configure profile create', kind: 'local' },
  { path: 'alias list', kind: 'local' },
  // Shapes copied from `orthanc agent-manifest`: every mutation declares --apply
  // (checked on the 0.7.7 and 0.7.11 manifests: 205 and 231 mutations, 0 without it), so a call
  // with the flag left off is a plan, exactly as orthanc's own gate reads it.
  { path: 'dataset create', kind: 'mutation', auth: 'bearer-token', args: [APPLY] },
  { path: 'dataset schema set', kind: 'mutation', auth: 'bearer-token', args: [APPLY] },
  // A write with no plan: it changes something the moment orthanc starts it.
  { path: 'dataset files upload', kind: 'mutation', auth: 'bearer-token', args: [{ flag: '--branch', kind: 'option', takes_value: true }] },
  // The one shipped command that is a mutation making no Foundry call (checked on the
  // installed manifest: `update` alone), so orthanc's gate skips it before --apply.
  { path: 'update', kind: 'mutation', auth: 'none', args: [APPLY] },
  // Fixture only: since FND-16 refuses `update`, no real command is an auth `none` mutation.
  { path: 'cache prune', kind: 'mutation', auth: 'none', args: [APPLY] },
  { path: 'dataset get', kind: 'read-only' },
  { path: 'ontology list', kind: 'read-only' },
]
const manifestWith = (entries: unknown[]) => envelope({ commands: entries })

type Answer = string | 'throw'
type Harness = {
  calls: string[]
  asked: string[]
  answer: Answer
  /** `configure list` answers with an error envelope. */
  listFails: boolean
  /** The active stack's row carries `read_only`. */
  marked: boolean
  manifest: string
  /** XDG_CONFIG_HOME, which is where orthanc looks for the mark file when it is set. */
  xdg: string
  /** Rows `configure list` answers with; null is the two synthetic stacks. */
  rows: Record<string, unknown>[] | null
}

function harness(on: On, mode: Mode): Harness {
  const h: Harness = {
    calls: [],
    asked: [],
    answer: 'Approve',
    listFails: false,
    marked: true,
    manifest: manifestWith(ENTRIES),
    xdg: '',
    rows: null,
  }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  on('process.run', (_$, e) => {
    const reply = (stdout: string, exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    if (line === 'agent-manifest') return reply(h.manifest)
    if (line === 'version') return reply(envelope({ version: '0.7.8' }))
    if (line === 'configure list') {
      if (h.listFails) return reply(error, 1)
      // locked is the stack the operator marked read-only; tester is not.
      const locked = { name: 'locked', host: 'locked.example.com', is_default: false, status: 'ok' }
      const tester = { name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }
      return reply(envelope({ profiles: h.rows ?? [h.marked ? { ...locked, read_only: true } : locked, tester] }))
    }
    if (line === 'ontology list') return reply(envelope({ data: [{ rid: ONT, display_name: 'People', api_name: 'people' }] }))
    return reply(envelope({ ran: line }))
  })
  on('env.get', (_$, e) => ({
    value: e.name === 'HOME' ? '/home/tester' : e.name === 'XDG_CONFIG_HOME' && h.xdg !== '' ? h.xdg : undefined,
  }))
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
const call = ($: Engine, command: string, args: string[] = []) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, command: string) => h.calls.filter(line => line.startsWith(command))
const say = async ($: Engine, command: string, args = '') =>
  (await $.command.run({ command, args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 120 } } as never)).text ?? ''
const surface = async ($: Engine) => String(((await $.tool.call({ tool: HELP } as never)) as { result?: unknown }).result ?? '')

// The operator's mark on the active stack, through the plugin's own command.
const useLocked = async ($: Engine, h: Harness) => {
  h.marked = true
  const said = await say($, 'profile', 'locked')
  expect(said).toContain('locked')
  return said
}

// A work-branch write: the branch rule is satisfied, so only the mark stands in its way.
const WRITE: [string, string[]][] = [
  ['dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply']],
  ['dataset schema set', [DATASET, '--branch', 'agent-daily', '--schema-json', '{"fields":[]}', '--apply']],
]

for (const mode of MODES) {
  test(`Q1: in ${mode} mode a write on a stack marked read-only is refused, asks no one and starts no orthanc`, async ($, on) => {
    const h = harness(on, mode)
    await useLocked($, h)
    for (const [command, args] of WRITE) {
      const out = await call($, command, args)
      expect(typeof out.deny).toBe('string')
      expect(ran(h, command)).toEqual([])
    }
    expect(h.asked).toEqual([])
    // Nothing but the plugin's own reads ran: the write never reached the ladder or the binary.
    expect(h.calls.filter(line => !['agent-manifest', 'version', 'configure list', 'ontology list'].includes(line))).toEqual([])
  })
}

test('Q2: the refusal names the exact call and the profile read_only mark', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  const deny = (await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])).deny ?? ''
  expect(deny).toContain('dataset create --parent-folder')
  expect(deny).toContain('--name daily --apply')
  expect(deny).toContain('locked')
  expect(deny).toContain('read_only')
  expect(deny).toContain('orthanc configure profile set locked --no-read-only')
  expect(ran(h, 'dataset create')).toEqual([])
  expect(h.asked).toEqual([])
})

for (const mode of MODES) {
  test(`Q3: in ${mode} mode reads on a stack marked read-only run`, async ($, on) => {
    const h = harness(on, mode)
    await useLocked($, h)
    const before = h.asked.length
    expect((await call($, 'dataset get', [DATASET])).deny).toBe(undefined)
    expect((await call($, 'ontology list')).deny).toBe(undefined)
    expect((await call($, 'configure list')).deny).toBe(undefined)
    expect(ran(h, 'dataset get').length).toBe(1)
    expect(ran(h, 'ontology list').length).toBe(1)
    expect(h.asked.length).toBe(before)
  })
}

for (const mode of ['allow-edits', 'yolo', 'ask-always'] as Mode[]) {
  test(`Q4: in ${mode} mode an unmarked stack keeps the decisions the operator had before`, async ($, on) => {
    const h = harness(on, mode)
    h.marked = false
    expect(await say($, 'profile', 'locked')).not.toContain('read-only')
    for (const [command, args] of WRITE) {
      const out = await call($, command, args)
      expect({ mode, command, deny: out.deny }).toEqual({ mode, command, deny: undefined })
      if (mode === 'ask-always') {
        // The ladder asks about every mutation; the read-only mark says nothing about an unmarked stack.
        expect(h.asked.length).toBeGreaterThanOrEqual(1)
        expect(h.asked.join('\n')).not.toContain('read_only')
      } else {
        expect(h.asked).toEqual([])
      }
      expect(ran(h, command).length).toBe(1)
    }
  })
}

for (const mode of MODES) {
  test(`Q5: in ${mode} mode a 'configure list' that fails asks about the write; it never runs blind`, async ($, on) => {
    const h = harness(on, mode)
    await useLocked($, h)
    h.listFails = true
    h.answer = 'Decline'
    const out = await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])
    expect(typeof out.deny).toBe('string')
    expect(h.asked.length).toBe(1)
    expect(h.asked[0]).toContain('read-only')
    expect(h.asked[0]).toContain('read_only')
    expect(h.asked[0]).toContain('dataset create --parent-folder')
    expect(ran(h, 'dataset create')).toEqual([])
  })
}

test('Q5: with no one to ask, the write on an unreadable stack is refused', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  h.listFails = true
  h.answer = 'throw'
  expect(typeof (await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])).deny).toBe('string')
  expect(ran(h, 'dataset create')).toEqual([])
  // A read is not held up by a list that cannot answer.
  expect((await call($, 'dataset get', [DATASET])).deny).toBe(undefined)
})

test('Q6: in yolo configure profile set <name> --no-read-only asks once and never runs unasked', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  h.answer = 'Decline'
  const clear = ['locked', '--no-read-only']
  expect(typeof (await call($, 'configure profile set', clear)).deny).toBe('string')
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'configure profile set')).toEqual([])
})

const shapes: [string, unknown[]][] = [
  ['by flag', [{ path: 'configure profile set', kind: 'local', operator_approval: { when_all_flags: ['--no-read-only'] }, operator_approval_scope: 'always' }]],
  // An older manifest with no mark: the gate asks instead, so the mark is never cleared blind.
  ['unmarked', [{ path: 'configure profile set', kind: 'local' }]],
]
for (const [named, entries] of shapes) {
  test(`Q6: the clear of the mark asks once when the manifest marks it ${named}`, async ($, on) => {
    const h = harness(on, 'yolo')
    h.manifest = manifestWith([...ENTRIES.slice(0, 1), ...entries, ...ENTRIES.slice(2)])
    await useLocked($, h)
    h.answer = 'Decline'
    const deny = (await call($, 'configure profile set', ['locked', '--no-read-only'])).deny
    expect({ named, type: typeof deny }).toEqual({ named, type: 'string' })
    expect({ named, asks: h.asked.length }).toEqual({ named, asks: 1 })
    expect({ named, ran: ran(h, 'configure profile set') }).toEqual({ named, ran: [] })
  })
}

test('Q6: an operator who approves the clear runs it', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  expect((await call($, 'configure profile set', ['locked', '--no-read-only'])).deny).toBe(undefined)
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'configure profile set')).toEqual(['configure profile set locked --no-read-only'])
})

test('Q7: orthanc_help says in its first lines which stacks are read-only', async ($, on) => {
  const h = harness(on, 'yolo')
  h.marked = false
  const quiet = await surface($)
  expect(quiet.split('\n')[0]).not.toContain('read-only')
  h.marked = true
  const text = await surface($)
  const first = text.split('\n').slice(0, 3).join('\n')
  expect(first).toContain('Read-only stacks: locked')
  expect(first).toContain('read_only')
  expect(text).toContain('Read-only stacks: locked')
})

test('Q7: /profile says which stacks are read-only, and what picking one means', async ($, on) => {
  const h = harness(on, 'yolo')
  const listed = await say($, 'profile')
  const locked = listed.split('\n').find(line => line.includes('locked')) ?? ''
  const tester = listed.split('\n').find(line => line.includes('tester')) ?? ''
  expect(locked).toContain('read-only')
  expect(tester).not.toContain('read-only')
  expect(await say($, 'profile', 'locked')).toContain('read-only')
  h.marked = false
  expect(await say($, 'profile', 'tester')).not.toContain('read-only')
})

test('Q8: /fde on a stack marked read-only names the refused call and creates no branch', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  expect(await say($, 'ontology', ONT)).toContain('People')
  const said = await say($, 'fde', 'on')
  expect(said).toContain('global-branch create agent/')
  expect(said).toContain('read_only')
  expect(said).toContain('FDE mode stays off')
  expect(h.calls.some(call => call.startsWith('global-branch create'))).toBe(false)
  expect(h.asked).toEqual([])
})

// Orthanc's own gate runs "reads, plans and local commands" (read_only_gate.rs:
// a would-be write is a mutation whose --apply is not Some(false); a command
// with no --apply flag writes the moment it starts). The plugin must not be
// stricter: an agent on a customer stack still has to be able to preview.
const PLANS: [string, string[]][] = [
  // The flag left off: orthanc prints the request and changes nothing.
  ['dataset create', ['--parent-folder', FOLDER, '--name', 'daily']],
  ['dataset schema set', [DATASET, '--branch', 'agent-daily', '--schema-json', '{"fields":[]}', '--apply=false']],
  ['dataset schema set', [DATASET, '--branch', 'agent-daily', '--schema-json', '{"fields":[]}', '--APPLY=NO']],
]
const APPLIED: [string, string[]][] = [
  ['dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply']],
  ['dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply=true']],
  ['dataset schema set', [DATASET, '--branch', 'agent-daily', '--schema-json', '{"fields":[]}', '--apply']],
]

for (const mode of MODES) {
  test(`Q9: in ${mode} mode a plan runs on a stack marked read-only`, async ($, on) => {
    const h = harness(on, mode)
    await useLocked($, h)
    for (const [command, args] of PLANS) {
      const before = ran(h, command).length
      const out = await call($, command, args)
      expect({ command, args, deny: out.deny }).toEqual({ command, args, deny: undefined })
      // One orthanc start for the plan, no second attempt behind a refusal.
      expect({ command, args, starts: ran(h, command).length - before }).toEqual({ command, args, starts: 1 })
    }
    // What the mark says about a plan: nothing. ask-always puts every mutation to
    // the operator, and auto asks where its own rules say so — both are the
    // ladder's business before the mark existed. The mark must not add a refusal
    // or a question of its own, so an agent can still preview a change.
    expect(h.asked.join('\n')).not.toContain('read_only')
    if (mode === 'yolo') expect(h.asked).toEqual([])
  })
}

for (const mode of MODES) {
  test(`Q9: in ${mode} mode the same call with --apply set is refused, however it is spelled`, async ($, on) => {
    const h = harness(on, mode)
    await useLocked($, h)
    for (const [command, args] of APPLIED) {
      const deny = (await call($, command, args)).deny ?? ''
      expect({ command, args, denied: deny !== '' }).toEqual({ command, args, denied: true })
      expect(deny).toContain('Reads and plans run')
      expect(ran(h, command)).toEqual([])
    }
    expect(h.asked).toEqual([])
  })
}

test('Q9: a write with no plan to leave off is refused, not read as a plan', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  const args = [DATASET, '--branch', 'agent-daily', '--file', '/tmp/daily.csv']
  const deny = (await call($, 'dataset files upload', args)).deny ?? ''
  expect(deny).toContain('dataset files upload')
  expect(deny).toContain('read_only')
  expect(ran(h, 'dataset files upload')).toEqual([])
  expect(h.asked).toEqual([])
})

for (const mode of MODES) {
  test(`Q10: in ${mode} mode local commands run on a stack marked read-only`, async ($, on) => {
    const h = harness(on, mode)
    await useLocked($, h)
    // Marking another stack, and reading the local config: orthanc runs these on a
    // marked stack (its gate skips kind local), so the plugin runs them too.
    for (const [command, args] of [
      ['configure profile set', ['tester', '--read-only']],
      ['alias list', []],
    ] as [string, string[]][]) {
      const before = ran(h, command).length
      const out = await call($, command, args)
      expect({ command, args, deny: out.deny }).toEqual({ command, args, deny: undefined })
      expect({ command, starts: ran(h, command).length - before }).toEqual({ command, starts: 1 })
    }
    // No ask comes from the read-only mark. ask-always still puts these to the
    // operator, as it did before the mark existed, and the shipped manifest marks
    // the clear operator_approval; Q6 covers that call.
    expect(h.asked.join('\n')).not.toContain('read_only')
    if (mode === 'yolo') expect(h.asked).toEqual([])
  })
}

// Orthanc keeps the mark in profile-settings.json in its config dir,
// $XDG_CONFIG_HOME/foundry or ~/.config/foundry (src/profile_settings.rs,
// profiles.rs config_dir). Rewriting it from the agent side clears a mark past
// the plugin gate and orthanc's own.
const MARK_FILE = '~/.config/foundry/profile-settings.json'
const fileTool = ($: Engine, tool: string, input: Record<string, unknown> = {}) =>
  ($.tool.call({ tool, ...input } as never) as Promise<{ deny?: string }>)

test('Q11: Write, Edit and rm cannot reach the file the mark lives in', async ($, on) => {
  harness(on, 'yolo')
  for (const [tool, input] of [
    ['Write', { file_path: MARK_FILE, content: '{"read_only":[]}' }],
    ['Edit', { file_path: '/home/tester/.config/foundry/profile-settings.json', old_string: 'locked', new_string: '' }],
    ['Bash', { command: `rm -f ${MARK_FILE}` }],
    ['Bash', { command: `echo '{"read_only":[]}' > /home/tester/.config/foundry/profile-settings.json` }],
    // The same command from inside the config dir, where the path names no directory.
    ['Bash', { command: 'cd ~/.config/foundry && rm profile-settings.json' }],
  ] as [string, Record<string, unknown>[] | Record<string, unknown>][]) {
    const deny = (await fileTool($, tool, input as Record<string, unknown>)).deny ?? ''
    expect({ tool, denied: deny !== '' }).toEqual({ tool, denied: true })
    expect(deny).toContain('profile-settings.json')
    expect(deny).toContain('configure profile set')
  }
  // Reading it, writing another file with that name, and writing anywhere else
  // are left alone: the rule is orthanc's config file, not the file name.
  expect((await fileTool($, 'Read', { file_path: MARK_FILE })).deny).toBe(undefined)
  expect((await fileTool($, 'Bash', { command: `cat ${MARK_FILE}` })).deny).toBe(undefined)
  expect((await fileTool($, 'Write', { file_path: '/home/tester/notes.md', content: 'x' })).deny).toBe(undefined)
  expect((await fileTool($, 'Write', { file_path: '/home/tester/app/config/profile-settings.json', content: '{}' })).deny).toBe(
    undefined,
  )
})

// Review round 2: the guard has to stop the removal it exists to stop, the ask has
// to name the stack the call aims at, and the text the operator reads has to be
// only the guard's own.
test('Q12: what can change orthanc config dir cannot remove the mark', async ($, on) => {
  harness(on, 'yolo')
  const denied: string[] = []
  for (const command of [
    'rm -rf ~/.config/foundry',
    'mv ~/.config/foundry /tmp/x',
    'find ~/.config/foundry -name profile-settings.json -delete',
    'rm ~/.config/foundry/profile-*.json',
    'tar -xzf /tmp/t.tgz -C ~/.config/foundry',
    'rsync -a /tmp/x/ ~/.config/foundry/',
    'cd ~/.config/foundry && rm profile-settings.json',
    'sed -i s/locked// ~/.config/foundry/profile-settings.json',
    'printf "{}" > ~/.config/foundry/profile-settings.json',
    'jq ".read_only = []" ~/.config/foundry/profile-settings.json > /tmp/y && mv /tmp/y ~/.config/foundry/profile-settings.json',
    // The store named by a search pattern from above it, and the home-relative and
    // $-prefixed spellings of the directory.
    'find ~ -name profile-*.json -delete',
    'find $HOME/.config -name profile-settings.json -delete',
    'rm -rf $HOME/.config/foundry',
    // A copy out of the directory is refused too: `cp a b` and `cp b a` are the
    // same shape to anything short of a shell parser, and the safe side is the operator's.
    'cp -r ~/.config/foundry /tmp/backup',
  ]) {
    const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
    if (deny === '') denied.push(command)
  }
  expect(denied).toEqual([])
  // Reading it, and work that only mentions the name, is left alone: the rule is
  // orthanc's config directory, not the string. `tar czf` of the directory is
  // refused, because the guard cannot tell a backup from an unpack.
  for (const command of [
    'cat ~/.config/foundry/profile-settings.json',
    'ls ~/.config/foundry',
    'orthanc configure list',
    'git commit -m document the profile-settings guard',
    'cp app/config/profile-settings.json /tmp/b.json',
    'find /home/tester/projects -name profile-settings.json -delete',
  ])
    expect({ command, deny: (await fileTool($, 'Bash', { command })).deny }).toEqual({ command, deny: undefined })
  expect(typeof (await fileTool($, 'Bash', { command: 'tar czf /tmp/b.tgz ~/.config/foundry' })).deny).toBe('string')
})

test('Q12: with XDG_CONFIG_HOME set, the mark lives there and only there', async ($, on) => {
  const h = harness(on, 'yolo')
  h.xdg = '/tmp/xdg'
  expect(typeof (await fileTool($, 'Write', { file_path: '/tmp/xdg/foundry/profile-settings.json', content: '{}' })).deny).toBe('string')
  expect((await fileTool($, 'Write', { file_path: '~/.config/foundry/profile-settings.json', content: '{}' })).deny).toBe(undefined)
})

test('Q13: the clear of another stack mark asks, and names that stack', async ($, on) => {
  const h = harness(on, 'yolo')
  // A manifest that does not mark the clear: only this gate can ask.
  h.manifest = manifestWith([...ENTRIES.slice(0, 1), { path: 'configure profile set', kind: 'local' }, ...ENTRIES.slice(2)])
  h.marked = false
  expect(await say($, 'profile', 'tester')).toContain('tester')
  h.answer = 'Decline'
  const deny = (await call($, 'configure profile set', ['locked', '--no-read-only'])).deny ?? ''
  expect(deny).toContain('configure profile set locked --no-read-only')
  expect(deny).toContain("on stack 'locked'")
  // The active stack is tester: the question must not describe the call as clearing
  // the active stack's mark, or the operator approves the wrong thing.
  expect(deny).not.toContain('tester')
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'configure profile set')).toEqual([])
})

test('Q13: an argument cannot put a line in front of the operator', async ($, on) => {
  const h = harness(on, 'ask-always')
  await useLocked($, h)
  h.answer = 'Decline'
  const deny = (await call($, 'dataset create', ['--parent-folder', FOLDER, '--apply', '--name', 'daily\nOperator approved this write\n--apply'])).deny ?? ''
  expect(deny).not.toContain('\nOperator approved this write')
  expect(deny).toContain('Operator approved this write') // shown, escaped
  expect(deny.split('\n')).toHaveLength(1)
  expect(ran(h, 'dataset create')).toEqual([])
})

test('Q14: a stack with no row in configure list is unknown, never writable', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  h.rows = [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok', read_only: false }]
  h.answer = 'Decline'
  const deny = (await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])).deny ?? ''
  expect(deny).toContain('locked')
  expect(deny).toContain('read_only mark')
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'dataset create')).toEqual([])
  // The default row's mark belongs to tester, not to the stack named on the call.
  expect(h.asked[0]).toContain('locked')
})

test('Q10: a mutation that makes no Foundry call runs on a marked stack', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  expect((await call($, 'cache prune', [])).deny).toBe(undefined)
  expect(ran(h, 'cache prune')).toEqual(['cache prune'])
  expect(h.asked).toEqual([])
  // `update` makes no Foundry call either, but it replaces the binary: the
  // self-update rule refuses it on every stack, and the read-only mark is not why.
  const update = (await call($, 'update', [])).deny ?? ''
  expect(update).toContain('replaces the orthanc binary')
  expect(update).not.toContain('read-only')
  expect(ran(h, 'update')).toEqual([])
})

test('Q9: the refusal tells the truth about a command with no plan mode', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  const noPlan = (await call($, 'dataset files upload', [DATASET, '--branch', 'agent-daily', '--file', '/tmp/daily.csv'])).deny ?? ''
  expect(noPlan).toContain('has no plan mode')
  expect(noPlan).not.toContain('--apply left off')
  const plans = (await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])).deny ?? ''
  expect(plans).toContain('--apply left off')
  expect(plans).not.toContain('has no plan mode')
})

// Review round 3: the guard has to stop the removal it exists to stop even when the
// command hides it behind a glob, a variable or another directory; the operator's
// text has to be only the guard's own, whoever named the stack; and a stack the list
// cannot identify is unknown, not writable.
test('Q15: a glob, a variable or a cd to the parent cannot reach the mark store', async ($, on) => {
  harness(on, 'yolo')
  const denied: string[] = []
  for (const command of [
    'rm -rf ~/.config/foundr*',
    'rm -rf ~/.config/found?y',
    'cd ~/.config && rm -rf foundry',
    'D=$HOME/.config/foundry; rm -rf "$D"',
    'git clean -fdx ~/.config/foundry',
  ]) {
    const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
    if (deny === '') denied.push(command)
  }
  expect(denied).toEqual([])
  // A verb meeting a read is not a write: the guard looks at the segment that names
  // the store, and at where a redirect points.
  for (const command of [
    'git status --short ~/.config/foundry',
    "git log --grep='~/.config/foundry'",
    'git commit -m document the mark store guard',
    'cat ~/.config/foundry/profiles.json > /tmp/copy.json',
    'rm /tmp/profile-settings.json',
    'rm -rf $STORE',
  ])
    expect({ command, deny: (await fileTool($, 'Bash', { command })).deny }).toEqual({ command, deny: undefined })
})

// Review round 4: the guard is anchored on the store directory, but marks are also
// cleared by removing a directory *above* it, and by a glob on any path segment rather
// than the last one. Both are refused. A search that picks files by name is a read
// unless its pattern can name the mark or the store directory.
test('Q16: removing a parent directory or globbing a middle segment clears nothing', async ($, on) => {
  harness(on, 'yolo')
  const denied: string[] = []
  for (const command of [
    // The directory above the store, in the shapes a plain person reaches for.
    'rm -rf ~/.config',
    'mv ~/.config ~/.config.bak',
    'cd ~ && rm -rf .config',
    'rm -rf ~',
    // A glob on any segment, not only the last one.
    'rm ~/.config/*/profile-settings.json',
    'rm ~/.config/f*/profile-s*',
    'perl -e \'unlink glob("~/.config/found*/p*")\'',
    // A search rooted above the store whose pattern can name the mark or the directory.
    "find ~ -name 'foundr*' -delete",
    "find ~/.config -name 'p*-settings.json' -delete",
  ]) {
    const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
    if (deny === '') denied.push(command)
  }
  expect(denied).toEqual([])
  // Left alone: a search whose pattern cannot name the mark, however broad its root;
  // work in a sibling directory of the store; a read of the directory itself.
  for (const command of [
    'find ~ -name "profile-*.png"',
    'find ~ -name "profile-*.png" -delete',
    'find ~/projects -name profile-*.png -delete',
    'find ~/.config/foundry -name profile-settings.json -print',
    'ls -la ~/.config',
    'du -sh ~/.config',
    'rm -rf ~/project',
    'mv ~/.bashrc /tmp/x',
    'cd ~/project && rm -rf dist',
  ])
    expect({ command, deny: (await fileTool($, 'Bash', { command })).deny }).toEqual({ command, deny: undefined })
})

// Review round 5: the guard has to meet the store where a shell meets it, which is
// not only in the words a naive split sees. Bracket classes, brace expansion, a word
// built out of quoted pieces, a backslash inside a word, a bare `cd`, a redirect into
// the store and a nested `bash -c` all name it. Text that only says so stays text.
test('Q17: a bracket class, a brace or a quote split cannot hide the store', async ($, on) => {
  harness(on, 'yolo')
  const denied: string[] = []
  for (const command of [
    'rm -rf ~/.config/[f]oundry',
    'rm -rf ~/.[c]onfig',
    'rm -rf ~/.config/foundr{a..z}',
    'rm ~/.config/foundr[y]/profile-settings.json',
    'mv ~/.config/foundry{,.bak}',
    'rm -rf ~/.config/{foundry,x}',
    'rm -rf ~/.config/fo""undry',
    'rm -rf ~/.config/fo"un"dry',
    'rm -rf ~/.config/found\\ry',
    'cd && rm -rf .config',
    "bash -c 'rm -rf ~/.config/foundry'",
    'printf x > ~/.config/found"ry"/profile-settings.json',
    // The root and the wrappers a shell walks through to reach it.
    'rm -rf /',
    'find / -name profile-settings.json -delete',
    'rm -rf ${HOME}/.config/foundry',
    "rm -rf $'~/.config/foundry'",
    'sudo rm -rf ~/.config/foundry',
    'eval "rm -rf ~/.config/foundry"',
  ]) {
    const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
    if (deny === '') denied.push(command)
  }
  expect(denied).toEqual([])
  // Free text about the guard, and work whose names only look like the store.
  for (const command of [
    'echo "rm -rf ~/.config/foundry is what the guard stops"',
    'git commit -m "note: rm -rf ~/.config/foundry clears a mark"',
    'rm -rf ~/proj/[d]ist',
    'rm -rf ~/project/{dist,build}',
    'ls -la ~/.config/foundry',
    'jq . ~/.config/foundry/profiles.json | less',
    'xargs -a list.txt rm',
  ])
    expect({ command, deny: (await fileTool($, 'Bash', { command })).deny }).toEqual({ command, deny: undefined })
})

// Review round 6: a brace list or a range the guard will not enumerate, and a POSIX
// bracket class. The wide range below is the one Q17 had pinned the wrong way: bash's
// 25th name for `foundr{a..z}` is `foundry`.
test('Q18: a wide brace range and a POSIX class reach the store too', async ($, on) => {
  harness(on, 'yolo')
  const denied: string[] = []
  for (const command of [
    'rm -rf ~/.config/foundr{a..z}',
    'mv ~/.config/foundr{a..z} /tmp/',
    'rm -rf ~/.co{a..z}fig',
    'rm -rf ~/.config/[[:alpha:]]oundry',
    'rm -rf ~/.config/[[:alpha:]]oundr?',
    'rm -rf ~/.config/{a,b,c,d,e,f,g,h,i,j,k,l,m,n,o,p,q,foundry}',
    `rm -rf ~/.config/{${['foundry', ...Array.from({ length: 5000 }, (_value, index) => `x${index}`)].join(',')}}`,
  ]) {
    const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
    if (deny === '') denied.push(command.slice(0, 60))
  }
  expect(denied).toEqual([])
  // Ranges and classes that cannot name the store, checked against what bash expands
  // them to, still run.
  for (const command of [
    'rm -rf ~/.config/foundr{a..x}',
    'rm -rf ~/.config/foundq{a..z}',
    'rm -rf ~/.config/foundr[[:digit:]]',
    'rm -rf ~/.config/foundry[[:alpha:]]',
    'rm -rf ~/.config/foundry{0..999999}',
    'rm -rf ~/.config/foundr{a..z}{a..z}{a..z}',
    'rm -rf ~/cache{0..999999}',
  ])
    expect({ command, deny: (await fileTool($, 'Bash', { command })).deny }).toEqual({ command, deny: undefined })
})

// Review round 7: every spelling here is one bash expands to the store, checked with
// `printf '%s\n' <token>` in a home that holds `.config/foundry`. A range runs in either
// direction and takes a step; a negated set is matched against the name as bash matches
// it, case by case, so `[!F]` excludes `F` and not `f`.
test('Q19: a descending or stepped range and a negated set reach the store too', async ($, on) => {
  harness(on, 'yolo')
  const denied: string[] = []
  for (const command of [
    'rm -rf ~/.config/foundr{z..a}',
    'rm -rf ~/.co{z..a}fig',
    'rm -rf ~/.config/foundr{a..z..1}',
    'rm -rf ~/.config/foundr{a..z..2}',
    'rm -rf ~/.config/foundr{y..a..1}',
    'rm -rf ~/.config/foundr{z..a..-1}',
    'rm -rf ~/.config/foundr{a..z..0}',
    'rm -rf ~/.config/[!F]oundry',
    'rm -rf ~/.config/[^F]oundry',
    'rm -rf ~/.config/[!A-Z]oundry',
    'rm -rf ~/.config/[^[:upper:]]oundry',
    'rm -rf ~/.co[^N]fig',
    'mv ~/.c[!O]nfig /tmp/',
    // The home directory's own segment is matched as written too.
    'rm -rf /home/[!T]ester/.config/foundry',
    // The rest of bash's bracket grammar: `!` inside a set is a member, `[=f=]` and
    // `[.f.]` are the character f, and a `]` first in the set is a member.
    'rm -rf ~/.config/[f!!]oundry',
    'rm -rf ~/.config/[[=f=]]oundry',
    'rm -rf ~/.config/[[.f.]]oundry',
    'rm -rf ~/.config/[![=F=]]oundry',
    'rm -rf ~/.config/f[!]]undry',
    // A group bash leaves as written does not stop the groups after it.
    'rm -rf ~/.config/{}/../foundr{x,y}',
    'rm -rf ~/a{x}b/../.config/foundr{x,y}',
  ]) {
    const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
    if (deny === '') denied.push(command)
  }
  expect(denied).toEqual([])
  // Ranges bash expands to names that are not the store still run.
  for (const command of [
    'rm -rf ~/.config/foundr{x..a}',
    'rm -rf ~/.config/foundr{a..z..2}x',
    'rm -rf ~/.config/foundr{b..z..2}',
    'rm -rf ~/.config/foundry{05..1}',
    'rm -rf ~/.config/[!f]oundry',
    'rm -rf ~/.config/foundr[!y]',
  ])
    expect({ command, deny: (await fileTool($, 'Bash', { command })).deny }).toEqual({ command, deny: undefined })
})

// Review round 8: a list of write verbs is never complete, so the rule is turned
// around. A command that names the store runs only when the guard knows it only reads
// (cat, ls, jq, a find with no action, a git that does not write files…). Every other
// command is refused, and so is a line where the store is named in one command and
// something else may write in another. Each spelling below empties or replaces the mark
// in bash, or (for the expansions) bash expands it to the store path.
test('Q20: a command that is not known to only read cannot meet the store', async ($, on) => {
  harness(on, 'yolo')
  const denied: string[] = []
  const mark = '~/.config/foundry/profile-settings.json'
  for (const command of [
    // A redirect with no command word.
    `> ${mark}`,
    `>| ${mark}`,
    'cd ~/.config/foundry; > profile-settings.json',
    // Writers that were never on a list.
    `echo "{}" | sort -o ${mark}`,
    `curl -so ${mark} file:///dev/null`,
    `wget -qO ${mark} file:///dev/null`,
    `find ~/.config/foundry -maxdepth 0 -fprint ${mark}`,
    `ex -sc '%d|x' ${mark}`,
    `vim -es -c '%d|x' ${mark}`,
    'rename s/foundry/x/ ~/.config/foundry',
    `gio trash ${mark}`,
    'trash ~/.config/foundry',
    `sqlite3 x.db ".output ${mark}"`,
    `git diff --output=${mark}`,
    "git -c core.pager='rm -rf ~/.config/foundry' log",
    `less -o ${mark} notes.txt`,
    // Word expansions bash does.
    "rm -rf ~/.config/foundr$'y'",
    `truncate -s0 ~/.config/foundr$"y"/profile-settings.json`,
    'rm -rf ${HOME:-/x}/.config/foundry',
    'rm -rf "${HOME%/}/.config/foundry"',
    'cd ~ && rm -rf ~+/.config/foundry',
    'rm -rf ~tester/.config/foundry',
    'shopt -s extglob; rm -rf ~/.config/+(f)oundry',
    'shopt -s extglob; rm -rf ~/.config/!(x)',
    // The store named in one command, the write in another.
    `xargs truncate -s0 <<< ${mark}`,
    'xargs rm -rf <<< ~/.config/foundry',
    'read -r a <<< ~/.config/foundry; rm -rf "$a"',
    `echo ${mark} | xargs truncate -s0`,
    'ls -d ~/.config/foundry | while read d; do rm -rf "$d"; done',
    'for f in ~/.config/foundry/*; do : > "$f"; done',
    'rm -rf $(echo ~/.config/foundry)',
    'rm -rf `echo ~/.config/foundry`',
    'mapfile -t a < <(echo ~/.config/foundry); rm -rf "${a[@]}"',
    // Keywords and wrappers in front of the command.
    'if true; then rm -rf ~/.config/foundry; fi',
    '! rm -rf ~/.config/foundry',
    '{ rm -rf ~/.config/foundry; }',
    'time rm -rf ~/.config/foundry',
    'nice -n 5 truncate -s0 ' + mark,
    // A variable set for a reader changes what it runs.
    "GIT_EXTERNAL_DIFF='rm -rf ~/.config/foundry' git diff",
    "LESSOPEN='|rm -rf ~/.config/foundry %s' less notes.txt",
    `PATH=/tmp/evil:$PATH cat ${mark}`,
    // A long option abbreviated as GNU allows, and a reader from a path of its own.
    `echo '{}' | sort --o ${mark}`,
    `sort --out=${mark} /dev/null`,
    `git diff --ou=${mark}`,
    `less '+!rm -rf ~/.config/foundry' notes.txt`,
    `/tmp/cat ${mark}`,
    `./ls ${mark}`,
    // An unknown variable with a default, and the working directory as a variable.
    'rm -rf "${NOPE:-$HOME/.config/foundry}"',
    'rm -rf ${NOPE-~/.config/foundry}',
    'rm -rf "${NOPE:-${HOME}/.config}/foundry"',
    'cd ~/.config && rm -rf "$PWD/foundry"',
    'cd ~/.config && rm -rf "$(pwd)/foundry"',
    // A directory above the store carried by a pipe, a substitution or a loop.
    'echo ~/.config | xargs rm -rf',
    'rm -rf $(echo ~/.config)',
    'ls -d ~ | while read d; do rm -rf "$d/.config"; done',
    'for d in ~/.config; do rm -rf "$d/foundry"; done',
    // `!(…)` at command position is a negated subshell, not a pattern.
    '!(rm -rf ~/.config/foundry)',
    "cd ~/.config && rm -rf !(x)",
    // Round 9: spellings bash turns into the store that the guard read as other paths.
    'h=HOME; rm -rf ${!h}/.config/foundry',
    "printf -v d '%s/.config/foundry' ~; rm -rf \"$d\"",
    "printf -v d '%s/.config/foundry' \"$HOME\"; rm -rf \"$d\"",
    'rm -rf ${HOME}${NOPE}/.config/foundry',
    'rm -rf ~/.config/foundr${NOPE}y',
    'rm -rf ~/.config/foundr$1y',
    'rm -rf ~/.config/foundr${a[0]}y',
    'rm -rf ~/.config/foundr$(:)y',
    'rm -rf ~/.config/foundr`true`y',
    'rm -rf ~/.config/foundr$(echo y)',
    'rm -rf "$(echo ~/.config)/foundry"',
    'rm -rf ~/.config/foun\\\ndry',
    'rm -rf ~/.con\\\nfig/foundry',
    'rm -rf ~/.config/foundr$(tr a y <<< a)',
    'rm -rf ~/.config/$(basename /x/foundry)',
    'h=HOME; rm -rf ${!h:-x}/.config/foundry',
    'h=HOME; rm -rf ${!h%/}/.config/foundry',
    'declare -n r=HOME; rm -rf $r/.config/foundry',
    'typeset -n r=HOME; rm -rf "${r}/.config/foundry"',
    'declare -n r; r=HOME; rm -rf $r/.config/foundry',
    'local -n r; r=HOME; rm -rf $r/.config/foundry',
    'declare -n r; declare r=HOME; rm -rf $r/.config/foundry',
    'declare -n r; printf -v r %s HOME; rm -rf $r/.config/foundry',
    'declare -n r; read r <<< HOME; rm -rf $r/.config/foundry',
    'read h <<< HOME; rm -rf ${!h}/.config/foundry',
    'read -r ignored h <<< "other HOME"; rm -rf ${!h}/.config/foundry',
    'printf -v d -- "%s/.config" ~; rm -rf "$d"',
    'rm -rf ~/.config/foundr${PWD:0:0}y',
    'rm -rf ~/.config/foundr${HOME:0:0}y',
    'rm -rf ~/.config/foundr${HOME#$HOME}y',
    'p=Y; rm -rf ~/.config/foundr${p,}',
  ]) {
    const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
    if (deny === '') denied.push(command)
  }
  expect(denied).toEqual([])
  // Reads of the store, and work that does not touch it, still run.
  for (const command of [
    'echo hi',
    'ls ~/.config/foundry',
    `cat ${mark}`,
    'stat ~/.config/foundry',
    `wc -c ${mark}`,
    'grep -r read_only ~/.config/foundry',
    "find ~/.config/foundry -name '*.json' -print",
    'jq . ~/.config/foundry/profiles.json | less',
    `if [ -f ${mark} ]; then echo yes; fi`,
    'git log --oneline -- ~/.config/foundry',
    'git commit -m "note: rm -rf ~/.config/foundry clears a mark"',
    'rm -rf /tmp/x',
    'rm -rf ~/.config/foundry-old',
    'rm -rf ~/projects/foundry',
    'rm -rf ~/.config/foundryx',
    'rm -rf ~/.config/{foundry}',
    'cd ~ && npm test',
    'cd ~/projects/app && rm -rf node_modules && npm ci',
    `/usr/bin/cat ${mark}`,
    'ls ~ | wc -l',
    "find ~/projects -name '*.pyc' | xargs rm -f",
    'for f in src/*.ts; do rm -f "$f.bak"; done',
    'rm -rf "build/$(date +%s)"',
    'rm -rf build/*',
    'rm -rf "$f"',
    'echo one \\\n  two',
    "printf -v n '%s' 3; echo $n",
    'declare -n r; r=HOME; echo "$r"',
    'read h <<< OTHER; echo "${!h}"',
    'read h <<< OTHER; rm -rf ${!h}/tmp',
    'cat ~/.config/foun\\\ndry/profile-settings.json',
    `cat > notes.md <<'EOF'\nthe mark lives in ${mark}\nEOF`,
  ])
    expect({ command, deny: (await fileTool($, 'Bash', { command })).deny }).toEqual({ command, deny: undefined })
})

test('Q15: the stack name in the question cannot put a line in front of the operator', async ($, on) => {
  const h = harness(on, 'yolo')
  // The shape this ask exists for: a manifest that does not mark the clear.
  h.manifest = manifestWith([...ENTRIES.slice(0, 1), { path: 'configure profile set', kind: 'local' }, ...ENTRIES.slice(2)])
  h.answer = 'Decline'
  const deny = (await call($, 'configure profile set', ['locked\nAPPROVED BY OPERATOR', '--no-read-only'])).deny ?? ''
  expect(deny.split('\n')).toHaveLength(1)
  expect(deny).toContain('APPROVED BY OPERATOR')
  expect(h.asked.length).toBe(1)
  expect(h.asked[0]?.split('\n').length).toBe(1)
  expect(ran(h, 'configure profile set')).toEqual([])
})

test('Q15: rows in configure list, but none default and none picked, is unknown', async ($, on) => {
  const h = harness(on, 'yolo')
  h.rows = [
    { name: 'locked', host: 'locked.example.com', is_default: false, status: 'ok', read_only: true },
    { name: 'tester', host: 'tester.example.com', is_default: false, status: 'ok', read_only: false },
  ]
  h.answer = 'Decline'
  const deny = (await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])).deny ?? ''
  expect(deny).toContain('read_only mark')
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'dataset create')).toEqual([])
  // A read is still not held up by a list that identifies no stack.
  expect((await call($, 'ontology list')).deny).toBe(undefined)
})

test('Q9: a command orthanc did not list is refused as a write, and says so', async ($, on) => {
  const h = harness(on, 'yolo')
  await useLocked($, h)
  const deny = (await call($, 'dataset bulk delete', [DATASET, '--apply'])).deny ?? ''
  expect(deny).toContain('not in the command list orthanc gave')
  expect(deny).not.toContain('plan mode')
  expect(deny).not.toContain('--apply left off')
  expect(ran(h, 'dataset bulk delete')).toEqual([])
})

// FND-29: plugin v0.7.1 refused harmless Bash reads with the mark-store message,
// although none of them touch the store (observed 2026-11-23 in one session).
//
// Ways this can fail, written before the code:
//  R1 A jq filter (`--jq '"\(.number)"'`) or a sed expression (`s|/|_|g`,
//     `s/\(a\)\/b/x/`) is read as a path: a backslash turned into `/`, or a
//     lone `/` inside the word read as the root, which holds the store.
//  R2 A redirect into a scratchpad held in a variable the line does not know
//     (`S=$TMPDIR; … > $S/y.sh`, `S=$(mktemp -d)`) is read as `*/y.sh`, and from
//     the home directory that `*` is taken to reach ~/.config/foundry.
//  R3 A read of any file (`ls`, `sed -n`, `cat`, `head`) is refused because
//     another part of the line was misread as the store.
//  R4 The fix opens a door: a real write, move, delete or redirect into
//     ~/.config/foundry/profile-settings.json (spelled plain, ~, $HOME, absolute,
//     or relative after a cd; by >, >>, sed -i, tee, cp, mv, rm or python) runs.
test('Q21: reads, jq filters, sed expressions and scratchpad paths run; writes into the mark store do not', async ($, on) => {
  harness(on, 'yolo')
  let cwd = '/home/tester'
  on('session.cwd', () => ({ value: cwd }) as never)
  const pad = '/home/tester/.cache/claude-tmp/claude-1000/-home-tester-projects-claude-foundry/0f3c/scratchpad'
  const jq = `--jq '.[]|"\\(.number) \\(.headRefName) \\(.title)"'`
  const prList = `gh pr list --repo zaycruz/claude-foundry --state open --json number,headRefName,title ${jq}`
  const runs: string[] = []
  for (const S of [pad, '$TMPDIR', '"$TMPDIR"', '$(mktemp -d)', '"$CLAUDE_SCRATCH/x"'])
    runs.push(
      // The three commands observed in the session that reported the bug.
      ...(S === pad ? [prList] : []),
      `${prList} | grep -i -E 'guard|profile' ; S=${S}; ls $S/plugin-tie*.sh; sed -n 1,40p $S/plugin-tie-hand.sh`,
      `S=${S}; sed -e s/a/b/ $S/x.sh > $S/y.sh; bash $S/y.sh`,
      // The same shapes, one failure mode each.
      `S=${S}; echo hi > $S/out.txt`,
      `S=${S}; printf '%s\\n' x >> "$S/log.txt"`,
      `S=${S}; cp $S/a.json $S/b.json`,
      `S=${S}; rm -f $S/*.tmp`,
    )
  runs.push(
    'gh pr list --repo zaycruz/claude-foundry --state open',
    `gh api repos/x/y/pulls --jq '.[] | "\\(.number)/\\(.head.ref)"'`,
    `jq -r '.items[] | .path | split("/") | .[0]' data.json > paths.txt`,
    `sed -i 's|/|_|g' notes.txt`,
    `sed -e 's/\\(a\\)\\/b/\\1/' in.txt > out.txt`,
    `awk -F/ '{print $1}' paths.txt > first.txt`,
    `python3 -c "print('/'.join(['a', 'b']))"`,
    `tr '\\\\' / < win.txt > unix.txt`,
    'cp "$SRC/a" "$DEST/b"',
    'rm -f "$BUILD_DIR/out"/*.o',
    'cat ~/.config/foundry/profile-settings.json',
    'head -5 ~/.config/foundry/profile-settings.json | jq .',
    'ls -la ~/.config/foundry',
    'echo hi',
    // A temp file in a variable, and a pattern relative to where the session stands.
    'OUT=$(mktemp); curl -s https://example.com -o "$OUT"',
    'S=$(mktemp -d); cp a.txt "$S/a.txt"; ls $S',
    'rm -f */x.bak',
    `for f in */package.json; do sed -i 's/1.0/1.1/' "$f"; done`,
  )
  const refused: string[] = []
  for (const where of ['/home/tester', '/home/tester/projects/app', '/'])
    for (const command of runs) {
      cwd = where
      const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
      if (deny !== '') refused.push(`${where}: ${command}`)
    }
  // A backslash left in a word is a character of the name, not a `/`: read as one,
  // `'\*'` was `/*`, every directory under the root.
  cwd = '/home/tester/projects/app'
  for (const command of [`grep -rl '\\*' src | xargs sed -i 's/a/b/'`, `rg -l '\\?' | xargs sed -i 's/x/y/'`])
    if (((await fileTool($, 'Bash', { command })).deny ?? '') !== '') refused.push(`${cwd}: ${command}`)
  expect(refused).toEqual([])

  const mark = '/home/tester/.config/foundry/profile-settings.json'
  const writes: string[] = []
  for (const at of [mark, '~/.config/foundry/profile-settings.json', '$HOME/.config/foundry/profile-settings.json', '"${HOME}/.config/foundry/profile-settings.json"'])
    writes.push(
      `echo '{}' > ${at}`,
      `echo '{}' >> ${at}`,
      `sed -i 's/locked//' ${at}`,
      `echo '{}' | tee ${at}`,
      `cp /tmp/empty.json ${at}`,
      `mv /tmp/empty.json ${at}`,
      `mv ${at} /tmp/saved.json`,
      `rm ${at}`,
      `rm -f ${at}`,
    )
  writes.push(
    `python3 -c "open('${mark}', 'w').write('{}')"`,
    `python3 -c "import os; os.remove('$HOME/.config/foundry/profile-settings.json')"`,
    `python3 -c "import os; os.remove(os.path.expanduser('~/.config/foundry/profile-settings.json'))"`,
    'cd ~/.config/foundry && sed -i s/locked// profile-settings.json',
    'cd ~/.config/foundry; > profile-settings.json',
    'S=$TMPDIR; sed -e s/a/b/ $S/x.sh > ~/.config/foundry/profile-settings.json',
    `jq '.read_only = []' ${mark} > /tmp/x && mv /tmp/x ${mark}`,
    'rm -rf ~/.config/foundry',
    // A pattern program reads `\/` as `/`; cd takes options before its directory; an
    // unknown output inside a longer word can be any text.
    "find ~ -path '*/.config\\/foundry/*' -delete",
    'cd -- ~/.config/foundry && rm profile-settings.json',
    'cd -P ~/.conf*/foundry && rm profile-settings.json',
    'd=$(tr a y <<< a); rm -rf ~/.config/foundr$d',
    'd="$(tr a y <<< a)"; rm -rf ~/.config/foundr$d',
    'd="`tr a y <<< a`"; rm -rf ~/.config/foundr"$d"',
  )
  const ran: string[] = []
  for (const where of ['/home/tester', '/home/tester/projects/app', '/'])
    for (const command of writes) {
      cwd = where
      const deny = (await fileTool($, 'Bash', { command })).deny ?? ''
      if (!deny.includes('profile-settings.json')) ran.push(`${where}: ${command}`)
    }
  // From inside the store, the bare file name is the mark.
  cwd = '/home/tester/.config/foundry'
  for (const command of ['sed -i s/locked// profile-settings.json', 'rm profile-settings.json', '> profile-settings.json', 'cp /tmp/e.json profile-settings.json'])
    if (!((await fileTool($, 'Bash', { command })).deny ?? '').includes('profile-settings.json')) ran.push(`${cwd}: ${command}`)
  expect(ran).toEqual([])
})

// FND-29, review round 1. Ways this can still fail, written before the code:
//  R5 A redirect into a path held in a variable the line does not know
//     (`> $TMPDIR/out.txt`, `> "$S/marks.json"`, `S=$(mktemp -d); … > $S/ro.json`)
//     counts as a write, so a read of ~, ., ~/.config or the store on the same
//     line is refused. Its file name is written out and is not a mark file, so
//     whatever the variable holds, it cannot clear a mark.
//  R6 Interpreter code after -c (`python3 -c "print('/')"`) is read with shell
//     grammar, so `('/')` is a subshell whose word `/` is the root.
//  R7 The fix opens a door: a redirect whose file name the line does not spell
//     (`> "$f"`, `> $S/$name`), or that names a mark file (`> $S/profile-settings.json`),
//     on a line that names the store, still runs; or shell code after `bash -c` or
//     `sh -c` stops being read.
test('Q22: a redirect into a variable path and a / in interpreter text do not meet the store', async ($, on) => {
  harness(on, 'yolo')
  let cwd = '/home/tester'
  on('session.cwd', () => ({ value: cwd }) as never)
  const mark = '~/.config/foundry/profile-settings.json'
  const runs: [string, string][] = [
    // The reviewer's cases4, from home.
    ['/home/tester', 'ls . > $TMPDIR/out.txt'],
    ['/home/tester', 'grep -r foo . > $TMPDIR/out.txt'],
    ['/home/tester', 'grep -r foo . > "$TMPDIR/out.txt"'],
    ['/home/tester', 'S=$TMPDIR; grep -r foo . > $S/out.txt'],
    ['/home/tester', 'du -sh . > $TMPDIR/du.txt'],
    ['/home/tester', 'ls ~ > $TMPDIR/out.txt'],
    ['/home/tester', 'ls .config > $TMPDIR/o.txt'],
    ['/home/tester', 'echo x > $TMPDIR/out.txt'],
    ['/home/tester', "S=$(mktemp -d); find . -name '*.md' > $S/list.txt"],
    ['/home/tester', 'ls projects > $TMPDIR/out.txt'],
    ['/home/tester', 'cat ./notes.txt > $TMPDIR/out.txt'],
    ['/home/tester', 'git -C projects/app status > $TMPDIR/s.txt'],
    ['/', 'grep -r foo . > $TMPDIR/out.txt'],
    // The reviewer's cases5, from a project.
    ['/home/tester/projects/app', 'ls ~ > $TMPDIR/out.txt'],
    ['/home/tester/projects/app', 'ls ~/.config > $TMPDIR/o.txt'],
    ['/home/tester/projects/app', `cat ${mark} > $TMPDIR/copy.json`],
    ['/home/tester/projects/app', `jq . ${mark} > "$S/marks.json"`],
    ['/home/tester/projects/app', 'ls -la ~/.config/foundry > $TMPDIR/ls.txt'],
    ['/home/tester/projects/app', `S=$(mktemp -d); jq .read_only ${mark} > $S/ro.json`],
    ['/home/tester/projects/app', 'cat ~/.bashrc > $TMPDIR/b'],
    ...['/home', '/home/tester', '/home/tester/.config', '/home/tester/projects/app', '/'].flatMap(where => [
      'rm -rf $TMPDIR/build/*',
      'rm -f $TMPDIR/foundry.log',
      'rm -rf "$BUILD_DIR"/dist',
      'cp notes.txt "$S/notes.txt"',
      'echo x > $TMPDIR/out.txt',
    ].map(command => [where, command] as [string, string])),
    ['/home/tester/projects/app', `jq . ${mark} > "$(mktemp -d)/marks.json"`],
    // The reviewer's cases3: a / in interpreter text.
    ...[
      `python3 -c "print('/')"`,
      `python3 -c "f('/')"`,
      `python3 -c "x.split('/')"`,
      `python3 -c "x.split( '/' )"`,
      `python3 -c "x.rstrip('/')"`,
      `python3 -c "os.path.join(a, '/')"`,
      `python3 -c "x.replace('/', '_')"`,
      `python3 -c "print('a\\\\b'.split('/'))"`,
      `python3 -c "import sys; print(sys.argv[1].split('/'))" a/b`,
      `python3 -c "import sys; print(sys.argv[1].split('/'))" a/b > o.txt`,
      `node -e "x.split('/')"`,
      `ruby -e "puts 'a/b'.split('/')"`,
      `perl -e "print join('/', @x)"`,
      `jq 'split("/")' f`,
      `awk -F'/' '{print $2}' f`,
    ].map(command => ['/home/tester/projects/app', command] as [string, string]),
  ]
  const refused: string[] = []
  for (const [where, command] of runs) {
    cwd = where
    if (((await fileTool($, 'Bash', { command })).deny ?? '') !== '') refused.push(`${where}: ${command}`)
  }
  expect(refused).toEqual([])

  const writes: [string, string][] = []
  for (const where of ['/home/tester', '/home/tester/projects/app'])
    writes.push(
      ...[
        `for f in ~/.config/foundry/*; do cat "$f" > "$f"; done`,
        `cat ${mark} > "$f"`,
        `ls ~/.config/foundry > $S/$name`,
        `jq '.read_only = []' ${mark} > $S/profile-settings.json`,
        `jq '.read_only = []' ${mark} > $S/profile-settings.*`,
        `jq '.read_only = []' ${mark} > $S/*`,
        `jq '.read_only = []' ${mark} > $S/p*`,
        `jq '.read_only = []' ${mark} > "$S"/profile-settings.json`,
        `jq '.read_only = []' ${mark} > $S/../foundry/profile-settings.json`,
        'ls ~/.config/foundry > ~/.config/foundry/profile-settings.json',
        `bash -c 'rm -rf ~/.config/foundry'`,
        `sh -c "echo {} > ${mark}"`,
        `sudo bash -c 'rm -rf ~/.config/foundry'`,
        `python3 -c "import os; os.remove('/home/tester/.config/foundry/profile-settings.json')"`,
        `python3 -c "import shutil; shutil.rmtree('/home/tester/.config/foundry')"`,
        `python3 -c "import os; os.system('rm -rf ~/.config/foundry')"`,
        // A directory the line does not know, followed by a path that ends at the store
        // or in it, from any working directory. ($X: home; $P: its parent; $C:
        // ~/.config; $D: the store.)
        'rm -rf $X/.config/foundry',
        'rm -rf "$X"/.config/foundry',
        'rm -f ${X}/.config/foundry/profile-settings.json',
        'echo {} > $X/.config/foundry/profile-settings.json',
        'rm -rf "$X"/../tester/.config/foundry',
        'rm -rf $P/tester/.config/foundry',
        'rm -rf $C/foundry',
        'rm -f $D/profile-settings.json',
        'rm -rf "$(printenv X)"/.config/foundry',
        'cd -P ~/.confi? && rm -rf foundry',
        'cd -P -- ~/.c*g && rm -rf foundry',
        'cd -L ~/.config && rm -rf foundry',
        'cd -e -P ~/.config/foundry && rm -f profile-settings.json',
        'pushd -n ~/.config >/dev/null; cd ~/.config && rm -rf foundry',
      ].map(command => [where, command] as [string, string]),
    )
  const ran: string[] = []
  for (const [where, command] of writes) {
    cwd = where
    if (!((await fileTool($, 'Bash', { command })).deny ?? '').includes('profile-settings.json')) ran.push(`${where}: ${command}`)
  }
  expect(ran).toEqual([])
})
