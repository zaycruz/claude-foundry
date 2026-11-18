// A stack the operator marked read-only runs no write.
//
// Orthanc v0.7.8 stores and enforces a read-only mark per profile: `orthanc
// configure profile set <name> --read-only`, and `configure list` reports it as
// `read_only`. The plugin read that list but kept only name, host, is_default
// and status, so nothing consulted the mark: in yolo a work-branch write on such
// a stack went up the ladder as 'run', orthanc started, and the refusal came
// back as an api/orthanc error — after the operator was asked, or after nothing
// was asked at all. zay's standing rule: a rich-style stack is read-only, and a
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
  // (checked on the shipped 0.7.7 manifest: 205 mutations, 0 without it), so a call
  // with the flag left off is a plan, exactly as orthanc's own gate reads it.
  { path: 'dataset create', kind: 'mutation', auth: 'bearer-token', args: [APPLY] },
  { path: 'dataset schema set', kind: 'mutation', auth: 'bearer-token', args: [APPLY] },
  // A write with no plan: it changes something the moment orthanc starts it.
  { path: 'dataset files upload', kind: 'mutation', auth: 'bearer-token', args: [{ flag: '--branch', kind: 'option', takes_value: true }] },
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
}

function harness(on: On, mode: Mode): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve', listFails: false, marked: true, manifest: manifestWith(ENTRIES) }
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
      // rich is the stack the operator marked read-only; tester is not.
      const rich = { name: 'rich', host: 'rich.example.com', is_default: false, status: 'ok' }
      const tester = { name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }
      return reply(envelope({ profiles: [h.marked ? { ...rich, read_only: true } : rich, tester] }))
    }
    if (line === 'ontology list') return reply(envelope({ data: [{ rid: ONT, display_name: 'People', api_name: 'people' }] }))
    return reply(envelope({ ran: line }))
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
const useRich = async ($: Engine, h: Harness) => {
  h.marked = true
  const said = await say($, 'profile', 'rich')
  expect(said).toContain('rich')
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
    await useRich($, h)
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
  await useRich($, h)
  const deny = (await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])).deny ?? ''
  expect(deny).toContain('dataset create --parent-folder')
  expect(deny).toContain('--name daily --apply')
  expect(deny).toContain('rich')
  expect(deny).toContain('read_only')
  expect(deny).toContain('orthanc configure profile set rich --no-read-only')
  expect(ran(h, 'dataset create')).toEqual([])
  expect(h.asked).toEqual([])
})

for (const mode of MODES) {
  test(`Q3: in ${mode} mode reads on a stack marked read-only run`, async ($, on) => {
    const h = harness(on, mode)
    await useRich($, h)
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
    expect(await say($, 'profile', 'rich')).not.toContain('read-only')
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
    await useRich($, h)
    h.listFails = true
    h.answer = 'Decline'
    const out = await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])
    expect(typeof out.deny).toBe('string')
    expect(h.asked.length).toBe(1)
    expect(h.asked[0]).toContain('read-only')
    expect(h.asked[0]).toContain('dataset create --parent-folder')
    expect(ran(h, 'dataset create')).toEqual([])
  })
}

test('Q5: with no one to ask, the write on an unreadable stack is refused', async ($, on) => {
  const h = harness(on, 'yolo')
  await useRich($, h)
  h.listFails = true
  h.answer = 'throw'
  expect(typeof (await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'daily', '--apply'])).deny).toBe('string')
  expect(ran(h, 'dataset create')).toEqual([])
  // A read is not held up by a list that cannot answer.
  expect((await call($, 'dataset get', [DATASET])).deny).toBe(undefined)
})

test('Q6: in yolo configure profile set <name> --no-read-only asks once and never runs unasked', async ($, on) => {
  const h = harness(on, 'yolo')
  await useRich($, h)
  h.answer = 'Decline'
  const clear = ['rich', '--no-read-only']
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
    await useRich($, h)
    h.answer = 'Decline'
    const deny = (await call($, 'configure profile set', ['rich', '--no-read-only'])).deny
    expect({ named, type: typeof deny }).toEqual({ named, type: 'string' })
    expect({ named, asks: h.asked.length }).toEqual({ named, asks: 1 })
    expect({ named, ran: ran(h, 'configure profile set') }).toEqual({ named, ran: [] })
  })
}

test('Q6: an operator who approves the clear runs it', async ($, on) => {
  const h = harness(on, 'yolo')
  await useRich($, h)
  expect((await call($, 'configure profile set', ['rich', '--no-read-only'])).deny).toBe(undefined)
  expect(h.asked.length).toBe(1)
  expect(ran(h, 'configure profile set')).toEqual(['configure profile set rich --no-read-only'])
})

test('Q7: orthanc_help says in its first lines which stacks are read-only', async ($, on) => {
  const h = harness(on, 'yolo')
  h.marked = false
  const quiet = await surface($)
  expect(quiet.split('\n')[0]).not.toContain('read-only')
  h.marked = true
  const text = await surface($)
  const first = text.split('\n').slice(0, 3).join('\n')
  expect(first).toContain('Read-only stacks: rich')
  expect(first).toContain('read_only')
  expect(text).toContain('Read-only stacks: rich')
})

test('Q7: /profile says which stacks are read-only, and what picking one means', async ($, on) => {
  const h = harness(on, 'yolo')
  const listed = await say($, 'profile')
  const rich = listed.split('\n').find(line => line.includes('rich')) ?? ''
  const tester = listed.split('\n').find(line => line.includes('tester')) ?? ''
  expect(rich).toContain('read-only')
  expect(tester).not.toContain('read-only')
  expect(await say($, 'profile', 'rich')).toContain('read-only')
  h.marked = false
  expect(await say($, 'profile', 'tester')).not.toContain('read-only')
})

test('Q8: /fde on a stack marked read-only names the refused call and creates no branch', async ($, on) => {
  const h = harness(on, 'yolo')
  await useRich($, h)
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
    await useRich($, h)
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
    await useRich($, h)
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
  await useRich($, h)
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
    await useRich($, h)
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
    ['Edit', { file_path: '/home/tester/.config/foundry/profile-settings.json', old_string: 'rich', new_string: '' }],
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
