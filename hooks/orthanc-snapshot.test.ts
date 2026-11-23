// The plugin's tie to orthanc (board task FND-11), end to end through the
// plugin's hooks. hooks/orthanc-manifest.snapshot.ts is the trimmed agent
// manifest of the orthanc the guard was last checked against
// (ORTHANC_CHECKED); `node scripts/orthanc-tie.mjs refresh` writes it.
//
// Ways this can fail, written before the code:
//  S1  orthanc ships an operator_approval or operator_approval_scope shape the
//      guard cannot read, and nobody notices: the snapshot check must fail and
//      name the command.
//  S2  The guard meets such a shape at run time and lets the call through: it
//      must ask in every mode, yolo included, and a decline must never run.
//  S3  The snapshot drifts silently: it is refreshed but ORTHANC_CHECKED is
//      not (or the other way round), or the manifest grows a field the guard
//      was never checked against. The check must fail on both.
//  S4  A marker of the release snapshot is not enforced: driven through the
//      hooks with its flags, an `always` marker must ask in yolo, and a
//      work-branch marker must ask when it would land on main.
//  S5  orthanc is older than MIN_ORTHANC or newer than ORTHANC_CHECKED, and
//      nobody is told: the first manifest read (the one session start makes)
//      must warn once and name the command to run.
//  S6  The warning blocks work: a read must still run, with no question.
//  S7  orthanc reports no version, or one that does not parse: the warning
//      says it cannot compare, and nothing throws.
//
// Synthetic stack only: placeholder RIDs, no stack data.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { SNAPSHOT } from './orthanc-manifest.snapshot'
import { KNOWN_ARG_KEYS, KNOWN_ENTRY_KEYS, KNOWN_KINDS, MIN_ORTHANC, ORTHANC_CHECKED, ORTHANC_UPDATE, PLUGIN_UPDATE } from './orthanc-tie'
import { readApprovalCondition, readApprovalScope } from './policy'

type Entry = { path: string; kind: string; auth?: string; args?: { flag: string; takes_value: boolean }[]; operator_approval?: unknown; operator_approval_scope?: unknown }
type Snapshot = { orthanc_version: string; entry_keys: string[]; arg_keys: string[]; commands: Entry[] }
const snapshot = SNAPSHOT as unknown as Snapshot

/** What is wrong with a snapshot, as the guard's own readers see it. */
function snapshotProblems(snap: Snapshot, checked = ORTHANC_CHECKED): string[] {
  const problems: string[] = []
  if (snap.orthanc_version !== checked) problems.push(`snapshot is of orthanc ${snap.orthanc_version}, ORTHANC_CHECKED is ${checked}`)
  for (const key of snap.entry_keys) if (!KNOWN_ENTRY_KEYS.includes(key)) problems.push(`entry key '${key}'`)
  for (const key of snap.arg_keys) if (!KNOWN_ARG_KEYS.includes(key)) problems.push(`arg key '${key}'`)
  for (const entry of snap.commands) {
    if (!KNOWN_KINDS.includes(entry.kind)) problems.push(`'${entry.path}': kind ${entry.kind}`)
    const marked = 'operator_approval' in entry
    if (marked !== 'operator_approval_scope' in entry) problems.push(`'${entry.path}': marker and scope not paired`)
    if (marked && readApprovalCondition(entry.operator_approval) === null) problems.push(`'${entry.path}': operator_approval ${JSON.stringify(entry.operator_approval)}`)
    if ('operator_approval_scope' in entry && readApprovalScope(entry.operator_approval_scope) === null) {
      problems.push(`'${entry.path}': operator_approval_scope ${JSON.stringify(entry.operator_approval_scope)}`)
    }
  }
  return problems
}

const markers = () => snapshot.commands.filter(entry => 'operator_approval' in entry)
const withEntry = (path: string, change: Partial<Entry> & Record<string, unknown>): Snapshot => ({
  ...snapshot,
  commands: snapshot.commands.map(entry => (entry.path === path ? { ...entry, ...change } : entry)),
})

test('S1 S3: every approval shape in the release snapshot is one the guard reads, and the snapshot is of ORTHANC_CHECKED', () => {
  expect(snapshotProblems(snapshot)).toEqual([])
  // The release snapshot has markers (58 in 0.7.12); a refresh that loses them is drift.
  expect(markers().length > 0).toBe(true)
  expect(snapshot.commands.length > 100).toBe(true)
})

test('S1: an unknown operator_approval or scope shape in the snapshot fails the check and names the command', () => {
  const target = markers()[0]!.path
  const unknowns: [string, Snapshot][] = [
    ['when_any_flags', withEntry(target, { operator_approval: { when_any_flags: ['--apply'] } })],
    ['empty flags', withEntry(target, { operator_approval: { when_all_flags: [] } })],
    ['scope main-only', withEntry(target, { operator_approval_scope: 'main-only' })],
    ['scope extra key', withEntry(target, { operator_approval_scope: { work_branch_flag: '--branch', unless: '--force' } })],
    ['scope short flag', withEntry(target, { operator_approval_scope: { work_branch_flag: '-b' } })],
  ]
  for (const [name, snap] of unknowns) {
    const problems = snapshotProblems(snap)
    expect({ name, named: problems.some(problem => problem.includes(`'${target}'`)) }).toEqual({ name, named: true })
  }
  const unpaired = snapshot.commands.map(entry => (entry.path === target ? { path: entry.path, kind: entry.kind, operator_approval: entry.operator_approval } : entry))
  expect(snapshotProblems({ ...snapshot, commands: unpaired })).toEqual([`'${target}': marker and scope not paired`])
})

test('S3: a snapshot of another orthanc, or one with a field the guard never saw, fails the check', () => {
  expect(snapshotProblems(snapshot, '9.9.9')).toEqual([`snapshot is of orthanc ${snapshot.orthanc_version}, ORTHANC_CHECKED is 9.9.9`])
  expect(snapshotProblems({ ...snapshot, entry_keys: [...snapshot.entry_keys, 'operator_approval_v2'] })).toEqual([`entry key 'operator_approval_v2'`])
  expect(snapshotProblems({ ...snapshot, arg_keys: [...snapshot.arg_keys, 'approval'] })).toEqual([`arg key 'approval'`])
})

// ---------- through the hooks ----------

const CLI = 'mcp__foundry__orthanc_cli'
const HELP = 'mcp__foundry__orthanc_help'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const WORK = 'ri.branch..branch.00000000-0000-4000-8000-000000000001'
const RID = 'ri.compass.main.folder.00000000-0000-4000-8000-000000000002'
const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

type Answer = string | 'throw'
type Harness = { calls: string[]; asked: string[]; answer: Answer; shown: string[]; version: string | null | 'missing' }

function harness(on: On, mode: (typeof MODES)[number] = 'yolo', commands: readonly Entry[] = snapshot.commands): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'Approve', shown: [], version: ORTHANC_CHECKED }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  const manifest = envelope({ commands })
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const stdout =
      line === 'agent-manifest'
        ? manifest
        : line === 'version'
          ? h.version === 'missing'
            ? 'orthanc: unknown command'
            : envelope(h.version === null ? {} : { version: h.version })
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
  on('ui.log', (_$, e) => {
    h.shown.push(`log ${e.text}`)
    return { value: undefined }
  })
  on('ui.toast', (_$, e) => {
    h.shown.push(`toast ${e.text}`)
    return { value: undefined }
  })
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
// zay, 2026-11-20: "the default fde mode should be able to do whatever it wants on a
// branch and raise the proposal and merge the proposal, just nothing direct against
// main or master". A promotion lands through a proposal, so in yolo it runs with no
// ask (yolo.test.ts Y19); only a direct write to main or master is held.
const PROMOTION_PATHS = new Set(['proposal merge', 'proposal accept', 'proposal approve', 'global-branch deploy', 'repository pull-request merge'])
const refusedAsPromotion = (reply: { deny?: string }, asked: number) => asked === 0 && /promotes work .*The operator does it/.test(reply.deny ?? '')
// The guard's own refusals before any question: no branch where one is needed,
// or a release tag whose call does not show what the operator would approve.
const refusedBeforeAsking = (reply: { deny?: string }, asked: number) => asked === 0 && /names no --branch, so it would change the main ontology|names no --branch, so it would write the default branch|must name a repository RID, a plain tag and one --commit-hash/.test(reply.deny ?? '')
const ran = (h: Harness, path: string) => h.calls.filter(line => line === path || line.startsWith(`${path} `))

/** A call of `entry` with every flag of its operator_approval, a placeholder
 * positional, and (for a work-branch scope) the branch as given. */
// Commands whose own guard rule wants real positionals before the ladder.
const POSITIONALS: Record<string, string[]> = {
  'repository tag create': ['ri.stemma.main.repository.00000000-0000-4000-8000-000000000003', 'v1.0.0', '--commit-hash', '0123456789abcdef0123456789abcdef01234567'],
}

function markedCall(entry: Entry, branch: 'none' | 'work' | 'main'): string[] {
  const condition = readApprovalCondition(entry.operator_approval)
  const flags = condition?.kind === 'flags' ? condition.flags : []
  const scope = readApprovalScope(entry.operator_approval_scope)
  const args = [...(POSITIONALS[entry.path] ?? [RID])]
  if (scope?.kind === 'work-branch') args.unshift(branch === 'work' ? WORK : branch === 'main' ? 'main' : RID)
  if (scope?.kind === 'flag' && branch !== 'none') args.push(scope.flags[0]!, branch === 'work' ? WORK : 'main')
  return [...args, ...flags]
}

test('S4: in yolo, every `always` marker of the release snapshot asks (or is refused outright), and a decline never reaches orthanc', async ($, on) => {
  const h = harness(on)
  h.answer = 'Decline'
  const always = markers().filter(entry => readApprovalScope(entry.operator_approval_scope)?.kind === 'always')
  expect(always.length > 0).toBe(true)
  const outcomes: string[] = []
  for (const entry of always) {
    for (const branch of ['none', 'work'] as const) {
      const before = h.asked.length
      const reply = await call($, entry.path, markedCall(entry, branch))
      const asked = h.asked.length - before
      if (PROMOTION_PATHS.has(entry.path)) {
        expect({ path: entry.path, branch, asked, denied: typeof reply.deny === 'string' }).toEqual({ path: entry.path, branch, asked: 0, denied: false })
        continue
      }
      // Asked once, naming the command; or refused before any question as a
      // promotion the operator does (Y19): both keep the write from orthanc.
      const outcome = asked === 1 && h.asked.at(-1)!.includes(`'${entry.path}'`) ? 'asked' : refusedAsPromotion(reply, asked) ? 'refused' : `asked ${asked}`
      expect({ path: entry.path, branch, outcome, kept: typeof reply.deny === 'string' && ['asked', 'refused'].includes(outcome) }).toEqual({
        path: entry.path,
        branch,
        outcome,
        kept: true,
      })
      outcomes.push(outcome)
      expect(ran(h, entry.path)).toEqual([])
    }
    if (PROMOTION_PATHS.has(entry.path)) expect(ran(h, entry.path).length).toBe(2)
  }
  // Most ask; a refusal is the exception, not the way the markers pass.
  expect(outcomes.filter(outcome => outcome === 'asked').length > outcomes.length / 2).toBe(true)
})

test('S4: in yolo, a work-branch marker of the release snapshot runs on a work branch and asks when it would land on main', async ($, on) => {
  const h = harness(on)
  const scoped = markers().filter(entry => ['work-branch', 'flag'].includes(readApprovalScope(entry.operator_approval_scope)?.kind ?? ''))
  expect(scoped.length > 0).toBe(true)
  const outcomes: string[] = []
  for (const entry of scoped) {
    const before = h.asked.length
    const work = await call($, entry.path, markedCall(entry, 'work'))
    // A promotion (proposal approve, …) runs in yolo with no ask, on a work branch or not (Y19).
    const promotion = PROMOTION_PATHS.has(entry.path)
    expect({ path: entry.path, deny: work.deny, asked: h.asked.length - before }).toEqual({ path: entry.path, deny: undefined, asked: 0 })
    h.answer = 'Decline'
    // Aimed at main: by name it asks (declined here); with no --branch at all,
    // a write the guard knows needs a branch is refused before any question.
    const targets = readApprovalScope(entry.operator_approval_scope)?.kind === 'flag' ? (['main', 'none'] as const) : (['main'] as const)
    for (const target of targets) {
      const asked = h.asked.length
      const main = await call($, entry.path, markedCall(entry, target))
      if (promotion) {
        expect({ path: entry.path, target, denied: typeof main.deny === 'string', asked: h.asked.length - asked }).toEqual({ path: entry.path, target, denied: false, asked: 0 })
        continue
      }
      const outcome = h.asked.length - asked === 1 ? 'asked' : refusedBeforeAsking(main, h.asked.length - asked) ? 'refused' : 'neither'
      expect({ path: entry.path, target, denied: typeof main.deny === 'string', stopped: outcome !== 'neither' }).toEqual({ path: entry.path, target, denied: true, stopped: true })
      outcomes.push(outcome)
    }
    h.answer = 'Approve'
    expect(ran(h, entry.path).length).toBe(promotion ? 1 + targets.length : 1)
  }
  // Most writes aimed at main ask; a refusal is the exception, not the way they pass.
  expect(outcomes.filter(outcome => outcome === 'asked').length > outcomes.length / 2).toBe(true)
})

for (const mode of MODES) {
  test(`S2: in ${mode} mode, an approval shape the guard cannot read asks, even on a work branch; declined or no one to ask, it never runs`, async ($, on) => {
    const target = markers().find(entry => readApprovalScope(entry.operator_approval_scope)?.kind === 'flag')!
    const unknown: Entry[] = [
      { ...target, path: 'future marker-a', operator_approval: { when_any_flags: ['--apply'] } },
      { ...target, path: 'future marker-b', operator_approval_scope: { work_branch_flag: '--branch', unless: '--force' } },
      { ...target, path: 'future marker-c', operator_approval_scope: 'main-only' },
    ]
    const h = harness(on, mode, [...snapshot.commands, ...unknown])
    for (const answer of ['Decline', 'throw'] as Answer[]) {
      h.answer = answer
      for (const entry of unknown) {
        const before = h.asked.length
        const reply = await call($, entry.path, [RID, '--branch', WORK, '--apply'])
        expect({ path: entry.path, answer, denied: typeof reply.deny === 'string', asked: h.asked.length - before }).toEqual({
          path: entry.path,
          answer,
          denied: true,
          asked: 1,
        })
        expect(ran(h, entry.path)).toEqual([])
      }
    }
  })
}

// ---------- the version tie ----------

const READ = snapshot.commands.find(entry => entry.kind === 'read-only' && !entry.path.includes('wait'))!.path
const warnings = (h: Harness) => h.shown.filter(line => line.includes('foundry 0.') && line.includes('orthanc'))

// Relative to the tie, so the table holds as releases move it.
const [MAJOR, MINOR, PATCH] = ORTHANC_CHECKED.split('.').map(Number) as [number, number, number]
const [MIN_MAJOR, MIN_MINOR, MIN_PATCH] = MIN_ORTHANC.split('.').map(Number) as [number, number, number]
const OLDER = MIN_PATCH > 0 ? `${MIN_MAJOR}.${MIN_MINOR}.${MIN_PATCH - 1}` : `${MIN_MAJOR}.${MIN_MINOR - 1}.99`
const NEXT_MINOR = `${MAJOR}.${MINOR + 1}.0`

const VERSIONS: [string, string | null | 'missing', string[]][] = [
  ['older than MIN_ORTHANC', OLDER, [`older than ${MIN_ORTHANC}`, ORTHANC_UPDATE]],
  ['newer than ORTHANC_CHECKED', NEXT_MINOR, [`newer than ${ORTHANC_CHECKED}`, PLUGIN_UPDATE]],
  ['a newer patch', `${MAJOR}.${MINOR}.${PATCH + 1}`, [`newer than ${ORTHANC_CHECKED}`, PLUGIN_UPDATE]],
  ['a two-digit minor', `${MAJOR}.${Math.max(10, MINOR + 1)}.0`, [`newer than ${ORTHANC_CHECKED}`]],
  ['a prerelease of the next minor', `${NEXT_MINOR}-rc.1`, [`newer than ${ORTHANC_CHECKED}`]],
  ['a prerelease of MIN_ORTHANC', `${MIN_ORTHANC}-rc.1`, [`older than ${MIN_ORTHANC}`]],
  ['no version in the reply', null, ['cannot compare', 'orthanc version']],
  ['no version command', 'missing', ['cannot compare']],
  ['a nightly name', 'nightly-20261118', ['cannot compare', 'nightly-20261118']],
]

for (const [name, version, says] of VERSIONS) {
  test(`S5 S6 S7: orthanc ${name}: the first manifest read warns once in the transcript and a toast, naming the command; reads still run`, async ($, on) => {
    const h = harness(on)
    h.version = version
    const listed = (await $.tool.call({ tool: HELP } as never)) as { result?: unknown }
    expect(String(listed.result)).toContain('Orthanc')
    const shown = warnings(h)
    expect(shown.length).toBe(2)
    expect(shown.some(line => line.startsWith('log '))).toBe(true)
    expect(shown.some(line => line.startsWith('toast '))).toBe(true)
    for (const text of says) expect({ text, shown: shown[0]!.includes(text) }).toEqual({ text, shown: true })
    expect(shown[0]!).toContain('Reads still run')
    const read = await call($, READ, [RID])
    expect(read.deny).toBe(undefined)
    expect(ran(h, READ).length).toBe(1)
    expect(h.asked).toEqual([])
    // V4: shown once, not on every call.
    await call($, READ, [RID, '--limit', '1'])
    expect(warnings(h).length).toBe(2)
  })
}

for (const version of [MIN_ORTHANC, ORTHANC_CHECKED, `v${ORTHANC_CHECKED}`, `${ORTHANC_CHECKED}-dev`, `${ORTHANC_CHECKED}+build.5`]) {
  test(`S5: orthanc ${version}, inside the range, shows no warning`, async ($, on) => {
    const h = harness(on)
    h.version = version
    await $.tool.call({ tool: HELP } as never)
    expect(warnings(h)).toEqual([])
  })
}
