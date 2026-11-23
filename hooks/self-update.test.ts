// The agent cannot replace the tool it is being guarded by.
//
// `orthanc update` is Orthanc's self-update, as the released 0.7.11 binary
// (orthanc-x86_64-unknown-linux-gnu.tar.gz, sha256
// d746a6bfa6837b93333bafc7439c790386971c6f9068c6d7b4b97ae3c99bbb31) describes it:
//
//   { "path":"update", "kind":"mutation", "auth":"none",
//     "mutation_risk":"replaces-binary" }                   — no operator_approval
//     "Update this binary to the latest stable or nightly release; prints a plan unless --apply"
//     --apply    "Replace the binary; without it, print the plan"
//     --check    "Print the plan only, with data.update_available"
//     --channel  stable | nightly ("built from main")
//     --version  "Install this stable release …; a lower version than this one needs --yes"
//     --yes      "Confirm a downgrade, or a nightly whose notes name no commit"
//     --plugin   "After the binary, also update the foundry plugin for Claude Code
//                 (foundry@claude-foundry)"
//
// The plugin's own pin (hooks/orthanc-snapshot.json) keeps five fields per
// command — path, kind, auth, operator_approval, operator_approval_scope — so it
// agrees on `kind: mutation`, `auth: none` and the missing `operator_approval`,
// and says nothing of the risk: `mutation_risk` appears in its 3055 lines zero
// times. Only the live binary's `agent-manifest` carries it, which is the second
// reason the rule reads the command name as well as the field.
//
// Both files it writes are the ones the guard reads its rules from. The `kind`
// and `operator_approval` marks the ladder judges every call by come from that
// binary (hooks/manifest.ts re-reads the manifest exactly because the binary can
// change under a session), and the ladder itself is this plugin. One call moves
// the session onto a build of orthanc main, an older release, or a newer plugin,
// with no say from the operator — and no Foundry branch in it anywhere, so
// yolo's "nothing on the branch asks" carve-out was never about it. Bash already
// refused it (the manifest marks it a mutation): the leak was orthanc_cli, where
// allow-edits ran it and yolo ran it with no question. The plugin pins
// min_orthanc (hooks/orthanc-snapshot.json: 0.7.11) and nothing stopped an agent
// from walking the installed binary under that floor — orthanc 0.7.7 ships 482
// commands against 0.7.11's 541, and 0 of its 482 entries carry the
// `operator_approval_scope` the yolo rule reads (0.7.11 has 56).
//
// Orthanc already says what the command does, in data the guard can read:
// `mutation_risk: "replaces-binary"`, one of the two risks 0.7.11 names (the
// other is `solution-design delete`: "moves-a-resource-to-the-trash"). So the
// rule is the field plus the name, the way the credential refusals are
// `input`/`credential_store` plus the names: the field catches the next
// binary-replacing command, and the name covers what the field cannot — the
// pinned record of 0.7.11 in hooks/orthanc-snapshot.json keeps five fields per
// command and `mutation_risk` is not one of them, and an older binary left
// installed under the plugin's own floor (min_orthanc is a note, not a check:
// hooks/manifest.ts only re-reads what the binary says) has no risk line at all.
//
// Ways this can fail, written before the code:
//  U1 orthanc_cli runs an update in some mode: a bare `update`, `--apply`,
//     `--apply --plugin`, `--apply --channel nightly`, or a downgrade with
//     `--version <older> --yes`. It is refused before Orthanc starts, in every
//     mode, with no one asked.
//  U2 The rule keys on a flag, so another spelling of `--apply`, or the words
//     split between `command` and `args`, gets through to the binary.
//  U3 The rule catches a call that is not an update: a Foundry read, a local
//     read (`version`, `configure list`), or a command *path* ending in the
//     word (`workshop module update`, `automate update`) is refused with it —
//     and the branch rule still judges those on their own terms.
//  U4 Bash runs it, or sends the agent to orthanc_cli with "run it with
//     orthanc_cli" — the one place the guard must not point.
//  U5 The refusal says only "no", so the agent retries the call, asks the
//     operator to approve it, or reaches for the installer itself. It names the
//     command and who runs it.
//  U6 The rule is luck, not a rule: a command that carries
//     `mutation_risk: "replaces-binary"` under a name the guard has never seen
//     runs, or an entry named `update` whose risk line is missing runs.
//  U7 orthanc_help still advertises the command as runnable, so the agent
//     discovers the refusal by spending a call (the credential commands mark
//     themselves in the same listing).
//  U8 A write the guard knows as a read: the read list names
//     `ai-fde tools list`, which orthanc-source 7f81c11 removed (the AI FDE web
//     client became the only backend). A stale name reads as a current one, and
//     a write that comes back under it is allowed as a read.
//  U9 The read list drifts from the shipped surface: a local command orthanc
//     reads is refused as a write, or one it writes is read.
//
// Where the surface comes from: every `kind: local` entry of the orthanc this
// plugin is tied to, read out of hooks/orthanc-manifest.snapshot.ts — the pin
// `node scripts/orthanc-tie.mjs refresh` writes and `check` watches. `update` is
// `kind: mutation` there. This used to be a list typed beside the test, because
// a test cannot open hooks/orthanc-snapshot.json (the kit refuses any import but
// the module under test and "claude-code"). The `.ts` pin holds the same `kind`
// for every command, so the surface is derived now: a tie that adds, renames or
// re-kinds a local command moves these cases with it. v0.7.13 is the case the
// typed list missed — it added `auth mint`, and the list stayed at 29 while the
// pin moved to 30.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { SNAPSHOT } from './orthanc-manifest.snapshot'
import { UPDATE_ENTRY, UPDATE_MUTATION_RISK } from './orthanc-local-surface'
import { classifyOrthancCommand, LOCAL_READS, type ManifestCommand, requiresBranch, resolveOrthancCommand } from './policy'
import { failure, manifestFrom, notRunFailure, renderCommand, renderListing } from './orthanc'

const CLI = 'mcp__foundry__orthanc_cli'
const FOLDER = 'ri.compass.main.folder.00000000-0000-0000-0000-0000000000aa'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

const LOCAL_COMMANDS: readonly string[] = SNAPSHOT.commands.filter(entry => entry.kind === 'local').map(entry => entry.path)

// The local surface as the pin ships it. Pinning the pin against the guard's read
// list is what makes the drift cases below bite: a tie that moves without the
// guard moving, or a read name the tied orthanc no longer has, fails here.
const LOCAL_SURFACE: ManifestCommand[] = LOCAL_COMMANDS.map(path => ({ path, kind: 'local' }))

// The rest of the surface these tests touch, as 0.7.11 and the pin write them,
// plus one binary-replacing command under a name the guard has never seen.
const OTHER_SURFACE: ManifestCommand[] = [
  { path: UPDATE_ENTRY.path, kind: UPDATE_ENTRY.kind, auth: UPDATE_ENTRY.auth, mutationRisk: UPDATE_MUTATION_RISK },
  { path: 'workshop module update', kind: 'mutation' },
  { path: 'automate update', kind: 'mutation' },
  { path: 'dataset create', kind: 'mutation' },
  { path: 'ontology list', kind: 'read-only' },
  { path: 'install-the-toolchain', kind: 'mutation', mutationRisk: UPDATE_MUTATION_RISK },
  // A plain mutation the rule must not reach: the ladder judges it as before.
  { path: 'renamed-self-update', kind: 'mutation' },
  // Marked a read by a manifest that still says what it does: the risk wins.
  { path: 'toolchain install', kind: 'read-only', mutationRisk: UPDATE_MUTATION_RISK },
  // A risk line in a shape this plugin cannot read, as a future orthanc might write
  // it: read as no risk line at all, so the name rule is what holds `update`.
  { path: 'toolchain repair', kind: 'mutation', mutationRisk: { level: 'high' } },
]

/** A surface as `orthanc agent-manifest` writes it: `mutation_risk`, not mutationRisk. */
const manifestEnvelope = (surface: readonly ManifestCommand[]) => ({
  schema_version: 'foundry-agent-v1',
  data: {
    commands: [
      ...surface.map(entry => ({
        path: entry.path,
        kind: entry.kind,
        ...(entry.auth === undefined ? {} : { auth: entry.auth }),
        ...(entry.mutationRisk === undefined ? {} : { mutation_risk: entry.mutationRisk }),
        args: [],
      })),
    ],
  },
  errors: [],
  meta: {},
  warnings: [],
  artifacts: [],
  pagination: null,
})

const SURFACE: ManifestCommand[] = [...LOCAL_SURFACE, ...OTHER_SURFACE]
const MANIFEST = JSON.stringify(manifestEnvelope(SURFACE))

type Harness = { calls: string[]; asked: string[] }

/** `manifest` replaces the agent-manifest answer, for the "what if the manifest
 * says something else" cases (U6b). */
function harness(on: On, mode: Mode, manifest: string = MANIFEST): Harness {
  const h: Harness = { calls: [], asked: [] }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  on('process.run', (_$, e) => {
    const reply = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    const words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    const line = words.join(' ')
    h.calls.push(line)
    if (line === 'agent-manifest') return reply(manifest)
    if (line === 'configure list') return reply(envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] }))
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
    return { result: { questions: call.questions, answers: { [question]: 'Approve' } } } as never
  })
  return h
}

type Engine = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[0]
const call = ($: Engine, command: string, args: string[] = []) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const shell = ($: Engine, command: string) => $.tool.call({ tool: 'Bash', command } as never) as Promise<{ deny?: string }>
const ran = (h: Harness, command: string) => h.calls.filter(line => line.startsWith(command))

// Every spelling of the call that would replace the binary.
const UPDATE_CALLS: [string, string[]][] = [
  ['update', []],
  ['update', ['--apply']],
  ['update', ['--apply', '--plugin']],
  ['update', ['--apply', '--channel', 'nightly']],
  ['update', ['--apply', '--version', 'v0.7.1', '--yes']],
  ['update', ['--APPLY']],
  ['update', ['--apply=true']],
  ['update', ['--check']],
  ['update --apply', []],
]

for (const mode of MODES) {
  test(`U1 U2: in ${mode} mode no spelling of orthanc update reaches the binary, and no one is asked`, async ($, on) => {
    const h = harness(on, mode)
    for (const [command, args] of UPDATE_CALLS) {
      const out = await call($, command, args)
      expect(out.deny).toContain('operator')
    }
    expect(h.calls.filter(line => line.split(' ')[0] === 'update')).toEqual([])
    expect(h.asked).toEqual([])
  })
}

for (const mode of MODES) {
  test(`U4: in ${mode} mode Bash refuses it and does not send the agent to orthanc_cli`, async ($, on) => {
    harness(on, mode)
    for (const command of ['orthanc update --apply', 'orthanc update']) {
      const deny = (await shell($, command)).deny ?? ''
      expect(deny).toContain('terminal')
      expect(deny.includes('Run \'update\' with orthanc_cli')).toBe(false)
    }
  })
}

test('U3: only update is caught; reads, other local writes and a command path ending in the word keep their own rules', async ($, on) => {
  const h = harness(on, 'yolo')
  for (const read of ['version', 'configure list', 'agent-manifest', 'alias list', 'smoke schedule', 'capabilities']) {
    expect((await call($, read)).deny).toBe(undefined)
  }
  expect((await call($, 'ontology list')).deny).toBe(undefined)
  // The reads the guard could have mistaken for writes really reached orthanc
  // (configure list and version also run at session start, so count the calls
  // this test makes itself).
  for (const read of ['alias list', 'smoke schedule', 'capabilities']) {
    expect(ran(h, read).length).toBe(1)
  }
  // A value that only contains the word.
  expect((await call($, 'dataset create', ['--parent-folder', FOLDER, '--name', 'status-update', '--apply'])).deny).toBe(undefined)
  // A command path ending in the word: its own path, and its own branch rule.
  for (const path of ['workshop module update', 'automate update']) {
    expect(resolveOrthancCommand(path, [], SURFACE).path).toBe(path)
    expect((await call($, path, ['--branch', 'agent-foundry-fix-1'])).deny).toBe(undefined)
    const bare = await call($, path, [])
    expect(bare.deny).toContain('--branch')
    expect((bare.deny ?? '').includes('terminal')).toBe(false)
  }
  expect(ran(h, 'update').length).toBe(0)
})

test('U5: the refusal names the call and who runs it, so the agent does not retry it or reach for the installer', async ($, on) => {
  harness(on, 'yolo')
  const reason = (await call($, 'update', ['--apply', '--plugin'])).deny ?? ''
  expect(reason).toContain('update')
  expect(reason).toContain('orthanc update --apply')
  expect(reason).toContain('plugin')
  // The guard's own rule: a blocked call is reported, never worked around.
  expect(reason).toMatch('terminal')
})

for (const mode of MODES) {
  test(`U6: in ${mode} mode the rule is the manifest risk and the name, not a lucky name list`, async ($, on) => {
    const h = harness(on, mode)
    // The field, under a name the guard has never seen: refused, unasked.
    expect((await call($, 'install-the-toolchain', ['--apply'])).deny).toContain('replaces')
    expect(h.calls.filter(line => line.startsWith('install-the-toolchain'))).toEqual([])
    // A `kind: read-only` entry that names the risk is not let through as a read,
    // and the refusal speaks of that command, not of `orthanc update`.
    const other = (await call($, 'toolchain install')).deny ?? ''
    expect(other).toContain('replaces')
    expect(other).toContain('replaces-binary')
    expect(other).toContain('toolchain install')
    expect(other.includes('orthanc update --apply')).toBe(false)
    // A call the rule does not reach is left to the ladder as it was: it runs in
    // the modes that run mutations, and asks in the modes that ask.
    const plain = await call($, 'renamed-self-update', ['--apply'])
    if (mode === 'ask-always' || mode === 'auto') {
      expect(h.asked.length).toBe(1)
    } else {
      expect(plain.deny).toBe(undefined)
      expect(h.asked).toEqual([])
      expect(ran(h, 'renamed-self-update').length).toBe(1)
    }
  })
}

for (const mode of MODES) {
  test(`U6b: in ${mode} mode an entry named update with no mutation_risk is refused by its name`, async ($, on) => {
    const bare = envelope({ commands: [{ path: 'update', kind: 'mutation', args: [] }, { path: 'version', kind: 'local', args: [] }] })
    const h = harness(on, mode, bare)
    expect((await call($, 'update', ['--apply'])).deny).toContain('operator')
    expect(h.calls.filter(line => line.split(' ')[0] === 'update')).toEqual([])
    expect((await call($, 'version')).deny).toBe(undefined)
  })
}

// The 11 local commands that only read, as orthanc's own help describes them
// (`version`/`hello`/`agent-manifest`/`capabilities` print, `completion show`
// prints, `configure list`/`alias list|show|resolve|export` read stored
// configuration, `smoke schedule` reports a job's state). Every other local
// command writes: alias add/clear/edit/import/remove, auth store/auth delete/
// auth mint, completion install, configure configure/delete/use/set-default/
// profile create/profile set, shell/shell start/shell interactive, onboarding.
// (`update` is not a local command at all: the manifest marks it a `mutation`.)
// U8 checks this list against the pin, not against a count.
const LOCAL_READ_OF_THE_PIN = [
  'agent-manifest', 'alias export', 'alias list', 'alias resolve', 'alias show', 'capabilities',
  'completion show', 'configure list', 'hello', 'smoke schedule', 'version',
]

test('U8 U9: the guard reads exactly the local commands the tied orthanc reads, and no others', async () => {
  // The guard's list, as behaviour, over every local command the pin ships: read
  // where it should read, mutation everywhere else, so a name added to the guard
  // without being read here, or one orthanc drops while the guard still reads it,
  // both fail.
  for (const path of LOCAL_COMMANDS) {
    expect({ path, asRead: LOCAL_READ_OF_THE_PIN.includes(path), guard: classifyOrthancCommand(path, SURFACE) }).toEqual({
      path,
      asRead: LOCAL_READ_OF_THE_PIN.includes(path),
      guard: LOCAL_READ_OF_THE_PIN.includes(path) ? 'read' : 'mutation',
    })
  }
  // Every name the guard reads is a command the tied orthanc actually ships:
  // that is the drift `ai-fde tools list` was, and the pin is what says so.
  for (const path of LOCAL_READS) expect({ path, pinned: LOCAL_COMMANDS.includes(path) }).toEqual({ path, pinned: true })
  expect([...LOCAL_READS].sort()).toEqual([...LOCAL_READ_OF_THE_PIN].sort())
  // No local command is a branch-required write; the two writes that end in the
  // word `update` are, and the branch rule judges them, not this one.
  expect(LOCAL_COMMANDS.every(path => !requiresBranch(path))).toBe(true)
  expect(['workshop module update', 'automate update'].every(path => requiresBranch(path))).toBe(true)
})

test('U8b: what a stale read name costs, and what covers it today', async ($, on) => {
  // `ai-fde tools list` left the surface in orthanc-source 7f81c11. Today the
  // name is unknown to any manifest, and an unknown name that ends in a read
  // verb still classifies as a read: what stops it is not the classification but
  // the two lanes that refuse what no manifest lists.
  expect(classifyOrthancCommand('ai-fde tools list', SURFACE)).toBe('read')
  const h = harness(on, 'yolo')
  const refused = await call($, 'ai-fde tools list')
  expect(JSON.stringify(refused)).toContain('Unknown Orthanc command')
  // Session start reads the manifest and the version; the refused name never ran.
  expect(h.calls.filter(line => line.includes('ai-fde'))).toEqual([])
  expect((await shell($, 'orthanc ai-fde tools list')).deny).toContain('agent manifest')
  // The cost, one orthanc release away: the moment a command of that name comes
  // back as a `local` write, a guard still naming it would read it in Bash and
  // skip the ladder. With the name gone, it is a mutation, and both lanes refuse.
  const broughtBack: ManifestCommand[] = [...SURFACE, { path: 'ai-fde tools list', kind: 'local' }]
  expect(classifyOrthancCommand('ai-fde tools list', broughtBack)).toBe('mutation')
})

test('U10: the executor refusal\'s envelope type counts as a call that never ran (the refusal itself is above the test lane)', () => {
  // The guard blocks the call above the executor; executeCli refuses it again, as
  // it refuses a credential command, so no future caller reaches the binary.
  // This pins the second refusal's envelope type: a call that never started must
  // not be reported as a mutation that may have landed.
  expect(notRunFailure(failure('self-update-denied', 'not run', 'update'))).toBe(true)
})

for (const mode of MODES) {
  test(`U11: in ${mode} mode a risk line the guard cannot read changes nothing, and the name still holds`, async ($, on) => {
    // A `mutation_risk` this file cannot read is read as no risk line, not as a
    // risk: refusing on shape would refuse every command orthanc later annotates
    // with a field it writes differently. What the name rule holds, it holds.
    const unreadable = envelope({
      commands: [
        { path: 'update', kind: 'mutation', mutation_risk: { level: 'high' }, args: [] },
        { path: 'toolchain repair', kind: 'mutation', mutation_risk: null, args: [] },
        { path: 'version', kind: 'local', args: [] },
      ],
    })
    const h = harness(on, mode, unreadable)
    // The name rule does not need the field.
    expect((await call($, 'update', ['--apply'])).deny).toContain('operator')
    expect(h.calls.filter(line => line.split(' ')[0] === 'update')).toEqual([])
    // The unreadable field invents no rule of its own: the other command is left
    // to the ladder, which is what it met before the field existed.
    expect(((await call($, 'toolchain repair', ['--apply'])).deny ?? '').includes('replaces')).toBe(false)
  })
}

test('U5b: a foreign binary-replacing command is described by its mark, not as `orthanc update`', async ($, on) => {
  harness(on, 'yolo')
  const tool = (await call($, 'install-the-toolchain', ['--apply'])).deny ?? ''
  expect(tool).toContain('install-the-toolchain')
  expect(tool).toContain('replaces-binary')
  expect(tool.includes("with 'orthanc update --apply'")).toBe(false)
  const bash = (await shell($, 'orthanc install-the-toolchain --apply')).deny ?? ''
  expect(bash).toContain('install-the-toolchain')
  expect(bash.includes('orthanc update')).toBe(false)
})

test('U7: orthanc_help marks the command where the agent reads it, as it marks the credential commands', () => {
  const commands = manifestFrom(manifestEnvelope(SURFACE) as never)
  const update = commands.find(entry => entry.path === 'update')
  expect(update?.mutationRisk).toBe(UPDATE_MUTATION_RISK)
  const shown = renderCommand(update!, null)
  expect(shown.includes('never runs it')).toBe(true)
  expect(shown.includes('terminal')).toBe(true)
  // An ordinary command, and one that merely shares the last word, say nothing.
  for (const path of ['version', 'automate update']) {
    expect(renderCommand(commands.find(entry => entry.path === path)!, null).includes('never runs it')).toBe(false)
  }
})

test('U7b: a group listing or a search hit carries the marker, not only the command page', () => {
  const commands = manifestFrom(manifestEnvelope(SURFACE) as never)
  const update = commands.filter(entry => entry.path === 'update')
  expect(renderListing(update, { query: 'update' }).includes('orthanc_cli never runs this')).toBe(true)
  expect(renderListing(update, { group: 'update' }).includes('orthanc_cli never runs this')).toBe(true)
  expect(renderListing(commands.filter(entry => entry.path === 'version'), { query: 'version' }).includes('never runs this')).toBe(false)
})

test('U7c: the listing marks the credential commands too, where an agent picks them', () => {
  const commands = manifestFrom(manifestEnvelope([...SURFACE, { path: 'auth store', kind: 'local' }]) as never)
  const shown = renderListing(commands.filter(entry => entry.path === 'auth store'), { query: 'auth store' })
  expect(shown.includes('orthanc_cli never runs this')).toBe(true)
  expect(shown.includes('credential')).toBe(true)
})

// The other half of "replace the tool that guards me", checked rather than
// assumed: orthanc 0.7.11 has no `plugin` command at all. Against the released
// binary, `orthanc plugin update foundry@claude-foundry` answers
// `error: unrecognized subcommand 'plugin'` and exits 2, and 0 of its 541
// manifest entries begin with `plugin`. So an agent cannot reach Claude Code's
// plugin manager through Orthanc, and what covers that is manifest-first — the
// same rule that refuses an invented command, in both lanes. What this rule does
// not cover is `claude plugin update foundry@claude-foundry` typed straight into
// Bash: no Orthanc command, so no lane of this guard sees it (in the report).
for (const mode of MODES) {
  test(`U12: in ${mode} mode 'orthanc plugin update' is refused: no manifest lists it`, async ($, on) => {
    const h = harness(on, mode)
    const tool = await call($, 'plugin update', ['foundry@claude-foundry'])
    expect(JSON.stringify(tool).includes('Unknown Orthanc command')).toBe(true)
    expect(h.calls.filter(line => line.startsWith('plugin'))).toEqual([])
    const deny = (await shell($, 'orthanc plugin update foundry@claude-foundry')).deny ?? ''
    expect(deny.length).toBeGreaterThan(0)
    expect(deny.includes("not a command in Orthanc's agent manifest")).toBe(true)
    expect(deny.includes('claude plugin')).toBe(false)
  })
}

// `-V`/`--version` is a version print on most commands and the release to install
// on `update`, and the Bash lane has always let a help call through unread. Read
// in that order, the downgrade this file documents — `--version <older> --yes
// --apply` — looked like a question about versions.
for (const mode of MODES) {
  test(`U13: in ${mode} mode a Bash update spelled with --version is refused, and --help still prints usage`, async ($, on) => {
    harness(on, mode)
    for (const line of [
      'orthanc update --version v0.7.1 --yes --apply',
      'orthanc update -V v0.7.1 --apply',
      'orthanc update --apply --version v0.7.1',
    ]) {
      const deny = (await shell($, line)).deny ?? ''
      expect(deny.length).toBeGreaterThan(0)
      expect(deny.includes('orthanc update')).toBe(true)
    }
    for (const line of ['orthanc update --help', 'orthanc update -h', 'orthanc help update']) {
      expect((await shell($, line)).deny).toBe(undefined)
    }
    // A version print on another command is still a read.
    expect((await shell($, 'orthanc --version')).deny).toBe(undefined)
    expect((await shell($, 'orthanc dataset list --version')).deny).toBe(undefined)
  })
}

// The same self-modification, one binary over: `claude plugin update
// foundry@claude-foundry` replaces the code these rules are written in, and no
// Orthanc appears in the call, so no orthanc rule could ever see it. Reads, help,
// and any other plugin are left alone; an update that names no plugin updates
// every plugin, this one included, so it is refused too.
const PLUGIN_SELF_LINES = [
  'claude plugin update foundry@claude-foundry',
  'claude plugin uninstall foundry@claude-foundry',
  'claude plugin disable foundry',
  'claude plugin update',
  // `--version` names a release to install here, not a usage print: the same trap
  // the shell lane learned about `orthanc update --version` (U13).
  'claude plugin update foundry@claude-foundry --version 0.6.4',
  'cd /home/tester && claude plugin update foundry@claude-foundry',
]
const PLUGIN_OTHER_LINES = [
  'claude plugin list',
  'claude plugin details foundry@claude-foundry',
  'claude plugin update other@market',
  'claude plugin update --help',
  'echo "claude plugin update foundry@claude-foundry"',
  'git commit -m "claude plugin update is the operator\'s call"',
]

for (const mode of MODES) {
  test(`U14: in ${mode} mode Bash refuses a plugin update that names this plugin`, async ($, on) => {
    harness(on, mode)
    for (const line of PLUGIN_SELF_LINES) {
      const deny = (await shell($, line)).deny ?? ''
      expect(deny.length).toBeGreaterThan(0)
      expect(deny.includes('claude plugin')).toBe(true)
      expect(deny.includes('terminal')).toBe(true)
    }
    for (const line of PLUGIN_OTHER_LINES) {
      expect(((await shell($, line)).deny ?? '').includes('claude plugin')).toBe(false)
    }
  })
}

// `xargs orthanc` takes the command from stdin or a file, so the line carries
// Orthanc and nothing else: not a read, not a write, not a branch, and the ladder
// has nothing to judge. Reviewers reached `orthanc update --apply` this way
// (`printf 'update --apply\n' | xargs orthanc`) with the self-update rule in place,
// which is the same answer any other write gets from a form the parser cannot read.
//
// These tests were in the commit that added the rule and were cut out of it by a
// truncation three lines away; the rule shipped untested for two commits and the
// message claimed otherwise. They are back, and the second list is the polarity the
// first version of the rule got wrong: `ls | xargs grep orthanc README.md` mentions
// the binary and must not be refused (README: text that only mentions Orthanc is not
// a call). The head word, not the window around it, is what tells the two apart.
const UNREADABLE_FORMS = [
  'xargs orthanc',
  'printf x | xargs orthanc',
  "printf 'update --apply' | xargs orthanc",
  'echo update --apply | xargs orthanc',
  'ls | xargs orthanc update --apply',
  'xargs -a notes.txt orthanc update --apply',
  'xargs -n1 orthanc dataset list < ids',
  'cat jobs.txt | xargs -I{} orthanc {}',
]

const MENTIONS_ONLY = [
  'ls | xargs grep orthanc README.md',
  'cat notes.txt | xargs grep orthanc',
  'git log --oneline | xargs grep foundry',
  'orthanc --agent agent-manifest',
  'orthanc --version',
]

for (const mode of MODES) {
  test(`U15: in ${mode} mode Bash refuses an Orthanc call whose words never reach the line, and reads the ones that only mention it`, async ($, on) => {
    const h = harness(on, mode)
    for (const line of UNREADABLE_FORMS) {
      const deny = (await shell($, line)).deny ?? ''
      expect(deny.length).toBeGreaterThan(0)
      expect(deny.includes('cannot read')).toBe(true)
      expect(deny.includes('orthanc_cli')).toBe(true)
    }
    for (const line of MENTIONS_ONLY) {
      expect(((await shell($, line)).deny ?? '').includes('cannot read')).toBe(false)
    }
    expect(h.calls.filter(line => line.split(' ')[0] === 'update')).toEqual([])
  })
}
