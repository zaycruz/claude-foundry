// The agent cannot replace the tool it is being guarded by.
//
// `orthanc update` is Orthanc's self-update. Read off the released binary
// (0.7.11, orthanc-x86_64-unknown-linux-gnu.tar.gz, sha256
// d746a6bfa6837b93333bafc7439c790386971c6f9068c6d7b4b97ae3c99bbb31), and the
// same entry in the plugin's pinned surface (hooks/orthanc-snapshot.json, tag
// v0.7.11) — the two agree:
//
//   {"path":"update","kind":"mutation","auth":"none","mutation_risk":"replaces-binary"}
//                                                          — no operator_approval
//     "Update this binary to the latest stable or nightly release; prints a plan unless --apply"
//     --apply    "Replace the binary; without it, print the plan"
//     --check    "Print the plan only, with data.update_available"
//     --channel  stable | nightly ("built from main")
//     --version  "Install this stable release …; a lower version than this one needs --yes"
//     --yes      "Confirm a downgrade, or a nightly whose notes name no commit"
//     --plugin   "After the binary, also update the foundry plugin for Claude Code
//                 (foundry@claude-foundry)"
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
// from walking the installed binary under its own floor — orthanc 0.7.7 ships
// 482 commands against 0.7.11's 541, and none of its entries carry the
// `operator_approval_scope` the yolo rule reads.
//
// Orthanc already says what the command does, in data the guard can read:
// `mutation_risk: "replaces-binary"`, one of the two risks 0.7.11 names (the
// other is `solution-design delete`: "moves-a-resource-to-the-trash"). So the
// rule is the field plus the name, the way the credential refusals are
// `input`/`credential_store` plus the names: the field catches the next
// binary-replacing command, the name covers a binary that ships `update` with
// its risk line missing.
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
// What this file cannot pin, and what pins it instead: the surface below is
// every `kind: local` entry of the released 0.7.11, captured from the binary and
// checked line by line against hooks/orthanc-snapshot.json (the plugin's pin),
// which is where `update` is `kind: mutation`. A test cannot open that file —
// the kit refuses any import but the module under test and "claude-code" — so
// the capture, not the JSON, is what these assertions read, and a future
// orthanc moves it by hand. hooks/orthanc-tie.ts in pull request #18 is the
// durable form of the same pin.
//
// Synthetic stack only.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { LOCAL_COMMANDS, UPDATE_ENTRY } from './orthanc-local-surface'
import { classifyOrthancCommand, LOCAL_READS, type ManifestCommand, requiresBranch, resolveOrthancCommand } from './policy'
import { failure, manifestFrom, notRunFailure, renderCommand } from './orthanc'

const CLI = 'mcp__foundry__orthanc_cli'
const FOLDER = 'ri.compass.main.folder.00000000-0000-0000-0000-0000000000aa'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
type Mode = (typeof MODES)[number]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

// Every `kind: local` command of the orthanc this plugin is tied to, read off
// hooks/orthanc-snapshot.json through hooks/orthanc-local-surface.ts (a test
// cannot open the JSON). Pinning the two artifacts against each other is what
// makes the drift cases below bite: a tie that moves without this list moving,
// or a read name the shipped orthanc no longer has, fails here.
const LOCAL_SURFACE: ManifestCommand[] = LOCAL_COMMANDS.map(path => ({ path, kind: 'local' }))

// The rest of the surface these tests touch, as 0.7.11 and the pin write them,
// plus one binary-replacing command under a name the guard has never seen.
const OTHER_SURFACE: ManifestCommand[] = [
  { path: UPDATE_ENTRY.path, kind: UPDATE_ENTRY.kind, auth: UPDATE_ENTRY.auth, mutationRisk: 'replaces-binary' },
  { path: 'workshop module update', kind: 'mutation' },
  { path: 'automate update', kind: 'mutation' },
  { path: 'dataset create', kind: 'mutation' },
  { path: 'ontology list', kind: 'read-only' },
  { path: 'install-the-toolchain', kind: 'mutation', mutationRisk: 'replaces-binary' },
  // Marked a read by a manifest that still says what it does: the risk wins.
  { path: 'toolchain install', kind: 'read-only', mutationRisk: 'replaces-binary' },
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
      // A command with its risk line missing: the name alone must hold (U6).
      ...(surface.some(entry => entry.path === 'update') ? [{ path: 'renamed-self-update', kind: 'mutation', args: [] }] : []),
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
    // A `kind: read-only` entry that names the risk is not let through as a read.
    expect((await call($, 'toolchain install')).deny).toContain('replaces')
    // A call the rule does not reach is left to the ladder as it was: it runs in
    // the modes that run mutations, and asks in the modes that ask.
    const other = await call($, 'renamed-self-update', ['--apply'])
    if (mode === 'ask-always' || mode === 'auto') {
      expect(h.asked.length).toBe(1)
    } else {
      expect(other.deny).toBe(undefined)
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

test('U7: orthanc_help marks the command where the agent reads it, as it marks the credential commands', async () => {
  const commands = manifestFrom(manifestEnvelope(SURFACE) as never)
  const update = commands.find(entry => entry.path === 'update')
  expect(update?.mutationRisk).toBe('replaces-binary')
  const shown = renderCommand(update!, null)
  expect(shown).toContain('never runs it')
  expect(shown).toContain('terminal')
  // An ordinary command, and one that merely shares the last word, say nothing of the kind.
  expect(renderCommand(commands.find(entry => entry.path === 'version')!, null)).not.toContain('never runs it')
  expect(renderCommand(commands.find(entry => entry.path === 'automate update')!, null)).not.toContain('never runs it')
})

// The 11 local commands that only read, as orthanc's own help describes them
// (`version`/`hello`/`agent-manifest`/`capabilities` print, `completion show`
// prints, `configure list`/`alias list|show|resolve|export` read stored
// configuration, `smoke schedule` reports a job's state). The other 18 local
// commands the pinned surface ships write: profiles, credentials, aliases,
// shell completions, the interactive shell, onboarding — and `update`.
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

test('U10: the executor refuses it too, and its refusal counts as a call that never ran', () => {
  // The guard blocks the call above the executor; executeCli refuses it again, as
  // it refuses a credential command, so no future caller reaches the binary.
  // This pins the second refusal's envelope type: a call that never started must
  // not be reported as a mutation that may have landed.
  expect(notRunFailure(failure('self-update-denied', 'not run', 'update'))).toBe(true)
})
