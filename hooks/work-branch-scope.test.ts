// Yolo runs a "work-branch" write that provably does not land on main (board task FND-31).
//
// zay, 2026-11-17: "no approvals are necessary for anything on the branch, only
// main." orthanc v0.7.13 marks two more writes operator_approval with scope
// "work-branch", and the guard could not see the work branch in either:
//   repository branch update-from-base <repo> <branch> [--from <base>] --apply
//     The branch it writes is a code-repository branch (a name, not a global
//     branch RID), so the guard never found a work branch and asked.
//   ontology branch-conflict-resolve --branch <RID> --entity <e> --take main|branch --apply --yes
//     `--take` is an enumerated option (values ["branch","main"]); the guard read
//     its value `main` as a branch the write lands on, and asked.
// In yolo with no one to ask (a subagent, a -p run) an ask is a refusal, so
// neither ran.
//
// The rules now (hooks/policy.ts approvalOnWorkBranch):
//  (a) A word that is the value of an option whose manifest entry enumerates
//      that word is not a branch mention. The narrower of the two rules the
//      task offered: an option's name does not say whether its value is a
//      branch (`--from` is one, and is not branch-shaped), but a value Orthanc
//      lists for the option is one of its fixed choices, never a branch the
//      caller named.
//  (b) On a "work-branch" command whose manifest names a positional `branch`
//      (a code-repository branch; global branches are `branch_rid`), the write
//      lands on that positional. When every flag of the call is one the
//      manifest declares, so each word's place is known, and that positional is
//      a branch name that is not main, master or HEAD, the call is on a work
//      branch. Orthanc itself refuses the repository's default branch there.
//
// Ways this can fail, written before the code:
//  WB1  In yolo, with no one to ask, update-from-base on a plain branch name
//       asks or is refused; so does `--from develop`, `--from main`, the `=`
//       spelling, or a global branch RID as the branch.
//  WB2  In yolo, with no one to ask, branch-conflict-resolve `--take main`
//       asks or is refused, or `--take branch` stops running; `--take=main`
//       and `--take main` decide differently.
//  WB3  update-from-base runs in yolo with main, master or HEAD as the branch
//       to bring up to date, in any spelling (refs/heads/main, +master, :HEAD).
//  WB4  Either call runs in yolo with `--branch main`, `--branch=main` or
//       `-bmain`, or with branch-conflict-resolve's `--branch` naming main.
//  WB5  A scope the guard cannot read (missing, null, "always", unknown,
//       wrong case, an object) lets either call run in yolo; or an
//       operator_approval it cannot read does.
//  WB6  `--take main` runs in yolo when the manifest lists no values for
//       --take, lists other values, or does not list --take at all; or a value
//       the option does not list (`--take MAIN`, `--take master`) runs.
//  WB7  update-from-base runs in yolo when the call carries a flag the
//       manifest does not declare (the guard cannot tell then which word is the
//       branch: `--from` unknown, `--yes main`), or when `--from` swallows the
//       branch so that main is the positional.
//  WB8  update-from-base runs in yolo with no branch, with an extra positional,
//       with a quoted branch, with a branch no branch name spells, or with
//       anything after `--`.
//  WB9  The positional rule spreads: a global-branch command whose positional
//       is `branch_rid` runs with a plain name (`global-branch roles set
//       agent/x`), or a command whose manifest names no positional `branch`
//       runs with one.
//  WB10 Another mode stops asking: in ask-always, allow-edits and auto both
//       calls still ask once, and declined they never reach orthanc.
//  WB11 A free-text option's value naming main (`--entity main`) runs in yolo
//       on the RID path: only an enumerated value is exempt.
//
// The manifest entries are those of the agent-manifest of an orthanc built from
// the v0.7.13 tag (e735b99), copied verbatim.
import type { On } from 'claude-code'
import { expect, test } from 'claude-code/testing'
import { manifestFrom } from './orthanc'
import { classifyCall, ladderDecision, type ManifestCommand } from './policy'

const CLI = 'mcp__foundry__orthanc_cli'
const REPO = 'ri.stemma.main.repository.e0000000-0000-4000-8000-0000000000e1'
const RID = 'ri.branch..branch.b0000000-0000-4000-8000-0000000000f4'
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const OTHER_MODES = MODES.filter(mode => mode !== 'yolo')
type Mode = (typeof MODES)[number]
const UPDATE = 'repository branch update-from-base'
const RESOLVE = 'ontology branch-conflict-resolve'

// orthanc v0.7.13, `orthanc --agent --non-interactive agent-manifest`, verbatim.
const UPDATE_ENTRY = {
  args: [
    { help: 'Code repository RID (ri.stemma.main.repository.…)', kind: 'positional', name: 'repository', repeatable: false, required: true, takes_value: true },
    { help: "The branch to bring up to date; never the repository's default branch", kind: 'positional', name: 'branch', repeatable: false, required: true, takes_value: true },
    { flag: '--from', help: "The base branch to merge in; the repository's default branch by default", kind: 'option', name: 'from', repeatable: false, required: false, takes_value: true },
    { flag: '--expect-head', help: 'Refuse the merge when the branch does not read at this commit', kind: 'option', name: 'expect_head', repeatable: false, required: false, takes_value: true },
    { flag: '--fast-forward-only', help: 'Refuse when the merge needs a merge commit, instead of making one', kind: 'option', name: 'fast_forward_only', repeatable: false, required: false, takes_value: false },
    { flag: '--apply', help: 'Push the merge; without this flag the command prints a plan', kind: 'option', name: 'apply', repeatable: false, required: false, takes_value: false },
  ],
  auth: 'bearer-token',
  description: "Bring a branch up to date with its base branch (the repository's default branch by default): the plan says whether the merge is empty, a fast-forward, or a conflict, and --apply pushes the merge commit. Never writes the repository's default branch",
  effect: "merges a base branch into another branch of the repository and pushes the merge commit; refuses the repository's default branch, and refuses a conflicted merge with every conflicting path",
  help: 'orthanc repository branch update-from-base --help',
  kind: 'mutation',
  operator_approval: { when_all_flags: ['--apply'] },
  operator_approval_scope: 'work-branch',
  path: UPDATE,
}
const RESOLVE_ENTRY = {
  args: [
    { flag: '--branch', help: 'Global branch RID (ri.branch..branch.…) or ontology branch RID', kind: 'option', name: 'branch', repeatable: false, required: true, takes_value: true },
    { flag: '--entity', help: 'The conflicting entity to settle, as branch-conflicts lists it', kind: 'option', name: 'entity', repeatable: false, required: true, takes_value: true },
    { flag: '--take', help: "Whose value the branch keeps after this: the branch's own, or main's", kind: 'option', name: 'take', repeatable: false, required: true, takes_value: true, values: ['branch', 'main'] },
    { flag: '--apply', help: 'Send the change; without this flag the command prints a plan', kind: 'option', name: 'apply', repeatable: false, required: false, takes_value: false },
    { flag: '--yes', help: 'Confirm that the side not taken is dropped; required with --apply', kind: 'option', name: 'yes', repeatable: false, required: false, takes_value: false },
  ],
  auth: 'bearer-token',
  description: 'Settle one of those conflicts by taking one side. The side not taken is dropped on that branch: --apply needs --yes, and the manifest marks the write for operator approval',
  effect: "settles one conflicting entity by taking one side: --take main discards the branch's change to it, --take branch keeps the branch's value and supersedes main's change on this branch",
  help: 'orthanc ontology branch-conflict-resolve --help',
  kind: 'mutation',
  operator_approval: { when_all_flags: ['--apply', '--yes'] },
  operator_approval_scope: 'work-branch',
  path: RESOLVE,
}
const ROLES_ENTRY = {
  args: [
    { help: 'Global branch RID (ri.branch..branch.…)', kind: 'positional', name: 'branch_rid', repeatable: false, required: true, takes_value: true },
    { flag: '--principal-type', kind: 'option', name: 'principal_type', takes_value: true, values: ['user', 'group', 'everyone'] },
    { flag: '--principal', kind: 'option', name: 'principal', takes_value: true },
    { flag: '--role', kind: 'option', name: 'role', takes_value: true },
    { flag: '--remove', kind: 'option', name: 'remove', takes_value: false },
    { flag: '--apply', kind: 'option', name: 'apply', takes_value: false },
    { flag: '--yes', kind: 'option', name: 'yes', takes_value: false },
  ],
  auth: 'bearer-token',
  kind: 'mutation',
  operator_approval: { when_all_flags: ['--apply'] },
  operator_approval_scope: 'work-branch',
  path: 'global-branch roles set',
}
const ENTRIES = [{ path: 'configure list', kind: 'local' }, UPDATE_ENTRY, RESOLVE_ENTRY, ROLES_ENTRY]

const envelope = (data: unknown) =>
  JSON.stringify({ schema_version: 'foundry-agent-v1', data, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null })

type Answer = string | 'throw'
type Harness = { calls: string[]; asked: string[]; answer: Answer }

// The real hook, a synthetic stack: orthanc answers the manifest and echoes every other call.
function harness(on: On, mode: Mode = 'yolo', entries: unknown[] = ENTRIES): Harness {
  const h: Harness = { calls: [], asked: [], answer: 'throw' }
  const store = new Map<string, unknown>([['approvalMode', mode]])
  const manifest = envelope({ commands: entries })
  on('process.run', (_$, e) => {
    let words = e.argv.slice(1).filter(word => word !== '--agent' && word !== '--non-interactive')
    if (words[0] === '--profile') words = words.slice(2)
    const line = words.join(' ')
    h.calls.push(line)
    const stdout =
      line === 'agent-manifest'
        ? manifest
        : line === 'configure list'
          ? envelope({ profiles: [{ name: 'tester', host: 'tester.example.com', is_default: true, status: 'ok' }] })
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
const write = ($: Engine, command: string, args: string[]) =>
  $.tool.call({ tool: CLI, command, args } as never) as Promise<{ deny?: string; result?: unknown }>
const ran = (h: Harness, path: string) => h.calls.filter(call => call.startsWith(path))

// The guard's own reading of the manifest, so the policy-level tests see what the hook sees.
const manifestOf = (entries: unknown[]): ManifestCommand[] =>
  manifestFrom({ schema_version: 'foundry-agent-v1', data: { commands: entries }, errors: [], meta: {}, warnings: [], artifacts: [], pagination: null } as never)
const MANIFEST = manifestOf(ENTRIES)
const outcome = (command: string, args: string[], manifest = MANIFEST, mode: Mode = 'yolo') => {
  const classification = classifyCall(CLI, { command, args }, manifest, null)!
  return classification.error !== undefined ? 'block' : ladderDecision(mode, classification, null).outcome
}
const withEntry = (path: string, change: (entry: Record<string, unknown>) => Record<string, unknown>) =>
  manifestOf(ENTRIES.map(entry => (entry.path === path ? change({ ...entry }) : entry)))
const withTake = (take: Record<string, unknown> | null) =>
  withEntry(RESOLVE, entry => ({
    ...entry,
    args: (entry.args as Record<string, unknown>[]).flatMap(arg => (arg.flag !== '--take' ? [arg] : take === null ? [] : [take])),
  }))

const UPDATES_ON_A_WORK_BRANCH: string[][] = [
  [REPO, 'agent-branch', '--apply'],
  [REPO, 'agent-branch', '--from', 'develop', '--apply'],
  [REPO, 'agent-branch', '--from', 'main', '--apply'],
  [REPO, 'agent-branch', '--from=main', '--apply'],
  [REPO, 'agent/feature-x', '--from', 'master', '--fast-forward-only', '--apply'],
  ['--apply', REPO, 'agent-branch', '--expect-head', '0123456789abcdef0123456789abcdef01234567'],
  [REPO, RID, '--apply'],
]
const RESOLVES_ON_A_WORK_BRANCH: string[][] = [
  ['--branch', RID, '--entity', 'X', '--take', 'branch', '--apply', '--yes'],
  ['--branch', RID, '--entity', 'X', '--take', 'main', '--apply', '--yes'],
  ['--branch', RID, '--entity', 'X', '--take=main', '--apply', '--yes'],
  [`--branch=${RID}`, '--take', 'main', '--entity', 'X', '--yes', '--apply'],
]

test('WB1 WB2: end to end in yolo with no one to ask, both calls run with no ask', async ($, on) => {
  const h = harness(on)
  for (const [command, args] of [
    ...UPDATES_ON_A_WORK_BRANCH.map(args => [UPDATE, args] as const),
    ...RESOLVES_ON_A_WORK_BRANCH.map(args => [RESOLVE, args] as const),
  ]) {
    expect({ command, args, deny: (await write($, command, [...args])).deny }).toEqual({ command, args, deny: undefined })
    expect(ran(h, command).at(-1)).toBe(`${command} ${args.join(' ')}`)
  }
  expect(h.asked).toEqual([])
})

const UPDATES_ON_MAIN: string[][] = [
  [REPO, 'main', '--apply'],
  [REPO, 'master', '--apply'],
  [REPO, 'HEAD', '--apply'],
  [REPO, 'refs/heads/main', '--apply'],
  [REPO, '+master', '--apply'],
  [REPO, ':HEAD', '--apply'],
  [REPO, 'main', '--from', 'develop', '--apply'],
  [REPO, 'agent-branch', '--branch', 'main', '--apply'],
  [REPO, 'agent-branch', '--branch=main', '--apply'],
  [REPO, 'agent-branch', '-bmain', '--apply'],
]
const RESOLVES_ON_MAIN: string[][] = [
  ['--branch', 'main', '--entity', 'X', '--take', 'branch', '--apply', '--yes'],
  ['--branch=main', '--entity', 'X', '--take', 'main', '--apply', '--yes'],
  ['--branch', RID, '-bmain', '--entity', 'X', '--take', 'main', '--apply', '--yes'],
  ['--branch', RID, '--entity', 'X', '--take', 'main', 'main', '--apply', '--yes'],
]

test('WB3 WB4: end to end in yolo with no one to ask, a call naming main asks once and never reaches orthanc', async ($, on) => {
  const h = harness(on)
  for (const [command, args] of [
    ...UPDATES_ON_MAIN.map(args => [UPDATE, args] as const),
    ...RESOLVES_ON_MAIN.map(args => [RESOLVE, args] as const),
  ]) {
    const before = h.asked.length
    expect({ command, args, denied: typeof (await write($, command, [...args])).deny }).toEqual({ command, args, denied: 'string' })
    expect({ command, args, asked: h.asked.length - before }).toEqual({ command, args, asked: 1 })
  }
  expect(ran(h, UPDATE)).toEqual([])
  expect(ran(h, RESOLVE)).toEqual([])
})

test('WB5: a scope or operator_approval the guard cannot read asks in yolo', async () => {
  const update = [REPO, 'agent-branch', '--apply']
  const resolve = ['--branch', RID, '--entity', 'X', '--take', 'main', '--apply', '--yes']
  for (const scope of [undefined, null, 7, 'always', 'Work-Branch', 'work_branch', 'sometimes', {}, ['work-branch'], { work_branch_flag: 'branch' }]) {
    const set = (entry: Record<string, unknown>) => {
      const { operator_approval_scope: _scope, ...rest } = entry
      return scope === undefined ? rest : { ...rest, operator_approval_scope: scope }
    }
    expect({ scope, outcome: outcome(UPDATE, update, withEntry(UPDATE, set)) }).toEqual({ scope, outcome: 'ask' })
    expect({ scope, outcome: outcome(RESOLVE, resolve, withEntry(RESOLVE, set)) }).toEqual({ scope, outcome: 'ask' })
  }
  for (const approval of [null, 'sometimes', { when_any_flags: ['--apply'] }, { when_all_flags: [] }]) {
    const set = (entry: Record<string, unknown>) => ({ ...entry, operator_approval: approval })
    expect({ approval, outcome: outcome(UPDATE, update, withEntry(UPDATE, set)) }).toEqual({ approval, outcome: 'ask' })
    expect({ approval, outcome: outcome(RESOLVE, resolve, withEntry(RESOLVE, set)) }).toEqual({ approval, outcome: 'ask' })
  }
  // The readable entries, for contrast.
  expect(outcome(UPDATE, update)).toBe('run')
  expect(outcome(RESOLVE, resolve)).toBe('run')
})

test('WB6: --take main runs in yolo only when the manifest lists main among the values of --take', async () => {
  const take = (values?: unknown) => ({ flag: '--take', kind: 'option', name: 'take', takes_value: true, ...(values === undefined ? {} : { values }) })
  for (const [why, manifest] of [
    ['no values', withTake(take())],
    ['other values', withTake(take(['branch', 'ours']))],
    ['values not a list', withTake(take('branch,main'))],
    ['no --take entry', withTake(null)],
    ['--take takes no value', withTake({ ...take(['branch', 'main']), takes_value: false })],
  ] as [string, ManifestCommand[]][]) {
    for (const args of [
      ['--branch', RID, '--entity', 'X', '--take', 'main', '--apply', '--yes'],
      ['--branch', RID, '--entity', 'X', '--take=main', '--apply', '--yes'],
    ]) {
      expect({ why, args, outcome: outcome(RESOLVE, args, manifest) }).toEqual({ why, args, outcome: 'ask' })
    }
  }
  // A value the option does not list is not one of its choices.
  for (const value of ['MAIN', 'master', 'HEAD', 'refs/heads/main']) {
    for (const args of [
      ['--branch', RID, '--entity', 'X', '--take', value, '--apply', '--yes'],
      ['--branch', RID, '--entity', 'X', `--take=${value}`, '--apply', '--yes'],
    ]) {
      expect({ args, outcome: outcome(RESOLVE, args) }).toEqual({ args, outcome: 'ask' })
    }
  }
  // `--entity` takes a value, so `--take` is its value and main is a positional.
  expect(outcome(RESOLVE, ['--branch', RID, '--entity', '--take', 'main', '--apply', '--yes'])).toBe('ask')
})

test('WB7 WB8: update-from-base asks in yolo unless every word of the call has a known place', async () => {
  const fromless = withEntry(UPDATE, entry => ({ ...entry, args: (entry.args as Record<string, unknown>[]).filter(arg => arg.flag !== '--from') }))
  for (const args of [
    [REPO, 'agent-branch', '--from', 'main', '--apply'],
    [REPO, 'agent-branch', '--from=main', '--apply'],
    [REPO, 'agent-branch', '--from', 'develop', '--apply'],
  ]) {
    expect({ args, outcome: outcome(UPDATE, args, fromless) }).toEqual({ args, outcome: 'ask' })
  }
  for (const args of [
    // A flag the manifest does not declare: which word is the branch is unknown.
    [REPO, '--yes', 'main', '--apply'],
    [REPO, 'agent-branch', '--onto', 'main', '--apply'],
    [REPO, 'agent-branch', '--onto=main', '--apply'],
    [REPO, 'agent-branch', '--FROM', 'develop', '--apply'],
    [REPO, 'agent-branch', '-f', 'develop', '--apply'],
    // --from swallows the branch, so main is the positional.
    [REPO, '--from', 'agent-branch', 'main', '--apply'],
    // No branch, an extra positional, a quoted or unspellable branch, `--`.
    [REPO, '--apply'],
    ['--apply'],
    [REPO, 'agent-branch', 'other', '--apply'],
    [REPO, '"agent-branch"', '--apply'],
    [REPO, "'agent-branch'", '--apply'],
    [REPO, 'agent branch', '--apply'],
    [REPO, 'agent;branch', '--apply'],
    [REPO, '', '--apply'],
    [REPO, '--', 'agent-branch', '--apply'],
    [REPO, 'agent-branch', '--apply', '--', 'main'],
    // Main at the branch slot, however the rest reads.
    [REPO, 'main', '--from', 'agent-branch', '--apply'],
    [REPO, 'MAIN', '--apply'],
  ]) {
    expect({ args, outcome: outcome(UPDATE, args) }).toEqual({ args, outcome: 'ask' })
  }
})

test('WB9: the positional rule holds only for a positional the manifest names branch', async () => {
  // A global-branch command: its positional is branch_rid, so a name is not a work branch.
  for (const args of [['agent/x', '--apply'], ['agent-branch', '--role', 'OWNER', '--apply']]) {
    expect({ args, outcome: outcome('global-branch roles set', args) }).toEqual({ args, outcome: 'ask' })
  }
  expect(outcome('global-branch roles set', [RID, '--principal-type', 'user', '--role', 'OWNER', '--apply'])).toBe('run')
  // update-from-base with its positional renamed, or dropped, by a future manifest.
  const renamed = withEntry(UPDATE, entry => ({
    ...entry,
    args: (entry.args as Record<string, unknown>[]).map(arg => (arg.name === 'branch' ? { ...arg, name: 'target' } : arg)),
  }))
  const dropped = withEntry(UPDATE, entry => ({ ...entry, args: (entry.args as Record<string, unknown>[]).filter(arg => arg.kind !== 'positional') }))
  const twice = withEntry(UPDATE, entry => ({ ...entry, args: [...(entry.args as Record<string, unknown>[]), { kind: 'positional', name: 'branch', repeatable: false, takes_value: true }] }))
  const repeatable = withEntry(UPDATE, entry => ({
    ...entry,
    args: (entry.args as Record<string, unknown>[]).map(arg => (arg.name === 'repository' ? { ...arg, repeatable: true } : arg)),
  }))
  for (const [why, manifest] of [['renamed', renamed], ['dropped', dropped], ['twice', twice], ['repeatable', repeatable]] as [string, ManifestCommand[]][]) {
    expect({ why, outcome: outcome(UPDATE, [REPO, 'agent-branch', '--apply'], manifest) }).toEqual({ why, outcome: 'ask' })
  }
  // Two positionals named branch: which one the write lands on is unclear, even when the count matches.
  expect(outcome(UPDATE, [REPO, 'agent-branch', 'other-branch', '--apply'], twice)).toBe('ask')
})

for (const mode of OTHER_MODES) {
  test(`WB10: in ${mode} mode both calls still ask once; declined, nothing reaches orthanc`, async ($, on) => {
    const h = harness(on, mode)
    h.answer = 'Decline'
    for (const [command, args] of [
      ...UPDATES_ON_A_WORK_BRANCH.map(args => [UPDATE, args] as const),
      ...RESOLVES_ON_A_WORK_BRANCH.map(args => [RESOLVE, args] as const),
    ]) {
      const before = h.asked.length
      expect({ command, args, denied: typeof (await write($, command, [...args])).deny }).toEqual({ command, args, denied: 'string' })
      expect({ command, args, asked: h.asked.length - before }).toEqual({ command, args, asked: 1 })
    }
    expect(ran(h, UPDATE)).toEqual([])
    expect(ran(h, RESOLVE)).toEqual([])
  })
}

test('WB11: only an enumerated value is exempt; a free-text value naming main asks in yolo', async () => {
  for (const args of [
    ['--branch', RID, '--entity', 'main', '--take', 'branch', '--apply', '--yes'],
    ['--branch', RID, '--entity=master', '--take', 'branch', '--apply', '--yes'],
  ]) {
    expect({ args, outcome: outcome(RESOLVE, args) }).toEqual({ args, outcome: 'ask' })
  }
  // The enumerated values of another option are exempt on the RID path too.
  expect(outcome('global-branch roles set', [RID, '--principal-type', 'everyone', '--role', 'OWNER', '--apply'])).toBe('run')
})
