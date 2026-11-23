// FDE mode (/fde): one session, one goal, one global branch (an agent/ one it
// made, or one the person adopted), and the namespace in scope, if any. Pure
// functions, shared by the hooks and the tests.
//
// zay, 2026-11-20: "if i do approval mode yolo fde should be able to do
// everything and anything it wants on a branch and deploy branches, just cant
// make changes directly against master thats it. otherwise, actually, the
// default fde mode should be able to do whatever it wants on a branch and raise
// the proposal and merge the proposal, just nothing direct against main or
// master". So the mode keeps exactly one hard refusal of its own: a write whose
// branch flag aims directly at main, master or HEAD. Everything else —
// creating, closing, deploying or renaming global branches, every proposal
// write, applies with no dry run, files naming other RIDs, --profile, writes on
// another stack — the branch rule and the approval ladder judge, as they do
// without the mode. Ontology writes that name no branch still get the
// session's branch added.

import type { FdeSession, FoundryNamespace } from '../types'
import { isRecord } from './orthanc'
import { BRANCH_FLAGS, flagValues, isProtectedValue, requiresBranch, validateBranchName } from './policy'

const PREFIX = 'agent/fde-'
const NAME_MAX = 64
const GOAL_MAX = 200
const RECORD_MAX = 50
const GLOBAL_BRANCH = /^ri\.branch\.\.branch\.[A-Za-z0-9-]+$/
const PROPOSAL_RID = /^ri\.branch\.\.proposal\.[A-Za-z0-9-]+$/
// A display name safe to show: one plain branch name, no spaces, quotes or control characters.
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
const FOREIGN_LINE = 'not an agent/ branch: FDE mode adopted it, and others may have work on it'

// A name or path that is safe to show: no control, line-breaking or bidi character, at most 100 of them.
const NOT_PLAIN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/

/** The space as it may be shown: a name or path that is not plain shows as the space's RID. */
export function plainSpace(space: FoundryNamespace): FoundryNamespace {
  const shown = (value: string) => (value.length <= 100 && !NOT_PLAIN.test(value) ? value : space.rid)
  return { rid: space.rid, name: shown(space.name), path: shown(space.path) }
}

/** One line, no control characters, at most 200 characters. */
const cleanGoal = (text: string) =>
  text
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, GOAL_MAX)

export type FdeArgs =
  | { kind: 'status' }
  | { kind: 'end' }
  | { kind: 'resume' }
  | { kind: 'start'; goal: string }
  | { kind: 'adopt'; rid: string; goal: string }
  | { kind: 'goal'; goal: string }
  | { kind: 'error'; reason: string }

/** The goal as shown; a session started with /fde on has none until /fde goal sets one. */
export const goalLabel = (goal: string) => (goal === '' ? 'no goal set' : goal)

export function parseFdeArgs(text: string): FdeArgs {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === 'status') return { kind: 'status' }
  if (trimmed === 'end') return { kind: 'end' }
  if (trimmed === 'resume') return { kind: 'resume' }
  if (trimmed.toLowerCase() === 'on') return { kind: 'start', goal: '' }
  const setGoal = /^goal(?:\s+([\s\S]*))?$/.exec(trimmed)
  if (setGoal) {
    const goal = cleanGoal(setGoal[1] ?? '')
    return goal === '' ? { kind: 'error', reason: 'Name the goal: /fde goal <text>.' } : { kind: 'goal', goal }
  }
  const adopt = /^--branch(?:=|\s+)(\S+)\s*([\s\S]*)$/.exec(trimmed)
  if (adopt) {
    const rid = adopt[1]!
    const goal = cleanGoal(adopt[2] ?? '')
    if (!GLOBAL_BRANCH.test(rid)) return { kind: 'error', reason: `'${rid}' is not a global branch RID (ri.branch..branch.…).` }
    return { kind: 'adopt', rid, goal }
  }
  return { kind: 'start', goal: cleanGoal(trimmed) }
}

const stamp = (now: Date) => now.toISOString().replace(/\D/g, '').slice(0, 12)

/** agent/fde-<goal slug>-<yyyymmddhhmm>, at most 64 characters, valid for global-branch create. */
export function fdeBranchName(goal: string, now: Date): string {
  const suffix = `-${stamp(now)}`
  const room = NAME_MAX - PREFIX.length - suffix.length
  let slug = goal
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length > room) slug = slug.slice(0, room).replace(/-[^-]*$/, '') || slug.slice(0, room)
  slug = slug.replace(/-+$/, '')
  const name = slug === '' ? `${PREFIX}${stamp(now)}` : `${PREFIX}${slug}${suffix}`
  return validateBranchName('global-branch create', name).ok ? name : `${PREFIX}work${suffix}`
}

export function branchCreateArgs(name: string, ontologyRid: string, goal: string): string[] {
  return ['global-branch', 'create', name, '--ontology-rid', ontologyRid, '--description', (goal === '' ? 'claude-foundry FDE session' : `claude-foundry FDE: ${goal}`).slice(0, GOAL_MAX), '--apply']
}

/** The global branch RID in a clean orthanc envelope; null on errors or none. */
export function branchRidFrom(envelope: { data?: unknown; errors?: unknown }): string | null {
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) return null
  const found = /ri\.branch\.\.branch\.[A-Za-z0-9-]+/.exec(JSON.stringify(envelope.data ?? null))
  return found ? found[0] : null
}

/** One write this session ran while bound, newest last, at most 50 of them. */
export const recordWrite = (fde: FdeSession, command: string, now: Date): FdeSession => ({
  ...fde,
  applied: [...fde.applied, { command, at: now.toISOString() }].slice(-RECORD_MAX),
})

/** Each asked RID's spaceRid in a batch-get `data`, in asked order: null when batch-get left it out. */
export function spacesOf(data: unknown, asked: readonly string[]): Map<string, string | null> {
  const rows = isRecord(data) && Array.isArray(data.resources) ? data.resources.filter(isRecord) : []
  const spaces = new Map(rows.flatMap(row => (typeof row.rid === 'string' && typeof row.spaceRid === 'string' ? [[row.rid, row.spaceRid] as [string, string]] : [])))
  return new Map(asked.map(rid => [rid, spaces.get(rid) ?? null] as [string, string | null]))
}

/**
 * Binds one orthanc_cli call to the session: the (possibly rewritten) args, or
 * why it is refused. The mode's one hard refusal is a write whose branch flag
 * aims directly at main, master or HEAD, however it is spelled; everything else
 * passes to the branch rule and the approval ladder, which judge a bound call
 * as they do without the mode. An ontology write that needs a branch and names
 * none still gets the session's.
 */
export function fdeBind(
  fde: FdeSession,
  path: string,
  args: readonly string[],
  isMutation: boolean,
): { args: string[] } | { deny: string } {
  if (!isMutation) return { args: [...args] }
  const branches = flagValues(args, BRANCH_FLAGS)
  // However it is spelled (--branch=main, -bmaster, 'refs/heads/main', HEAD), a
  // branch flag naming the baseline is the one thing FDE mode refuses itself.
  const onMain = [...new Set(branches.filter(isProtectedValue))]
  if (onMain.length > 0) {
    return {
      deny:
        `FDE mode (${fde.branchName}): this write aims at ${onMain.join(', ')}, and FDE mode never writes main or master directly. ` +
        `Work on a branch: the session's is ${fde.branchRid}, or pass --branch <global branch RID>.`,
    }
  }
  if (path.startsWith('ontology ') && branches.length === 0 && requiresBranch(path)) {
    return { args: [...args, '--branch', fde.branchRid] }
  }
  return { args: [...args] }
}

/** A stored binding: junk is null, and a session from before namespaces has `namespace: null, spaces: []`. */
export function normalizeFde(stored: unknown): FdeSession | null {
  if (!isRecord(stored) || typeof stored.branchRid !== 'string') return null
  const space = (value: unknown): FoundryNamespace | null =>
    isRecord(value) && typeof value.rid === 'string' && value.rid !== '' && typeof value.name === 'string' && typeof value.path === 'string'
      ? { rid: value.rid, name: value.name, path: value.path }
      : null
  const plain = (value: unknown): FoundryNamespace | null => {
    const found = space(value)
    return found === null ? null : plainSpace(found)
  }
  return {
    ...(stored as object as FdeSession),
    applied: Array.isArray((stored as { applied?: unknown }).applied)
      ? ((stored as { applied: unknown[] }).applied).filter(
          entry => isRecord(entry) && typeof entry.command === 'string' && typeof entry.at === 'string',
        ) as FdeSession['applied']
      : [],
    namespace: plain((stored as { namespace?: unknown }).namespace),
    spaces: Array.isArray((stored as { spaces?: unknown }).spaces) ? ((stored as { spaces: unknown[] }).spaces).map(plain).filter((entry): entry is FoundryNamespace => entry !== null) : [],
  }
}

/**
 * The branch to show when `data` (global-branch get) is an OPEN branch of
 * `ontologyRid`, whatever its prefix (a Foundry AI FDE branch is named
 * ai-fde/<user>/<slug>): its display name when that is a plain branch name,
 * its RID when it is not. Anything else is a reason it cannot be adopted.
 */
export function adoptable(data: unknown, ontologyRid: string): { name: string } | string {
  const record = (data as { branch_record?: Record<string, unknown> } | null)?.branch_record
  if (typeof record !== 'object' || record === null) return 'global-branch get returned no branch record.'
  if (record.branch_status !== 'OPEN') return `The branch is ${String(record.branch_status ?? 'unknown')}, not OPEN.`
  if (record.ontology_rid !== ontologyRid) return `The branch belongs to ontology ${String(record.ontology_rid ?? 'unknown')}, not the selected ${ontologyRid}.`
  const name = typeof record.display_name === 'string' && PLAIN_NAME.test(record.display_name) ? record.display_name : ''
  if (name !== '') return { name }
  if (typeof record.branch_rid === 'string' && GLOBAL_BRANCH.test(record.branch_rid)) return { name: record.branch_rid }
  return 'The branch has no plain name, and global-branch get returned no branch RID to show instead.'
}

/**
 * The branch an ontology listing may read: FDE mode's, and only while its stack
 * and ontology are the ones in scope. The binding itself survives a later
 * /ontology or /profile pick (nothing unbinds it); this guard is what stops a
 * surviving binding naming this ontology's or this stack's types as the branch's.
 * Null reads the main branch.
 *
 * The session's other branch (`workingBranch`) must not be used here: when a
 * branch creation returns no RID the mod stores its *name* there, and nothing
 * pairs it with an ontology, so it could ask orthanc for a branch of another
 * ontology and read that one's types back as this one's.
 */
export function readBranch(fde: FdeSession | null, profile: string, ontologyRid: string): { rid: string; name: string } | null {
  if (fde === null || fde.profile !== profile || fde.ontologyRid !== ontologyRid) return null
  return { rid: fde.branchRid, name: fde.branchName }
}

/** The proposal `data` (global-branch get) has open on the branch; null when it has none. */
export function openProposal(data: unknown): string | null {
  const rid = (data as { branch_record?: Record<string, unknown> } | null)?.branch_record?.active_proposal
  return typeof rid === 'string' && PROPOSAL_RID.test(rid) ? rid : null
}

/** A branch FDE mode could have made itself; every other one belongs to someone else. */
export function isAgentBranch(name: string): boolean {
  return name.startsWith('agent/') && validateBranchName('global-branch create', name).ok
}

const adoptedForeign = (fde: FdeSession) => !isAgentBranch(fde.branchName)

const appliedLines = (fde: FdeSession) =>
  fde.applied.length === 0 ? ['- nothing run'] : fde.applied.map(entry => `- ${entry.at} ${entry.command}`)

export function fdeContext(fde: FdeSession): string {
  return [
    '# FDE mode',
    `Goal: ${goalLabel(fde.goal)}${fde.goal === '' ? ' (the operator works with you turn by turn; /fde goal sets one)' : ''}`,
    `This session works on one global branch: ${fde.branchName} (${fde.branchRid}) on ontology ${fde.ontologyRid}, stack ${fde.profile}.`,
    ...(adoptedForeign(fde)
      ? [`This is ${FOREIGN_LINE}. Change only what the goal needs, and leave what you did not make as you found it.`]
      : []),
    ...(fde.namespace ? [`The namespace in scope is ${fde.namespace.name} (${fde.namespace.path}); /namespace stays locked until /fde end.`] : []),
    'Ontology writes that name no branch get this one added. The one thing FDE mode refuses is a write aimed directly at main or master; ' +
      'everything else on branches is yours to do: create, close, deploy or rename global branches, raise, review, accept and merge proposals, ' +
      'and apply writes — the branch rule and the approval ladder judge each call as they do without the mode.',
    'Work as an FDE: scout what exists, make the smallest change on the branch, verify it on the branch, then report.',
  ].join('\n')
}

export function fdeStatus(fde: FdeSession): string {
  return [
    `FDE mode on · ${goalLabel(fde.goal)}`,
    `branch ${fde.branchName} (${fde.branchRid})`,
    ...(adoptedForeign(fde) ? [FOREIGN_LINE] : []),
    `stack ${fde.profile} · ontology ${fde.ontologyRid} · since ${fde.startedAt}`,
    ...(fde.namespace ? [`namespace ${fde.namespace.name} (${fde.namespace.path}) in scope; /namespace is locked until /fde end`] : []),
    `${fde.applied.length} writes run`,
    '/fde end hands off and leaves the branch open.',
  ].join('\n')
}

export function fdeHandoff(fde: FdeSession): string {
  return [
    `# FDE handoff: ${goalLabel(fde.goal)}`,
    '',
    `- Branch: ${fde.branchName} (${fde.branchRid}), left open.`,
    `- Stack ${fde.profile}, ontology ${fde.ontologyRid}, started ${fde.startedAt}.`,
    ...(fde.namespace ? [`- Namespace: ${fde.namespace.name} (${fde.namespace.path}).`] : []),
    `- Writes run (${fde.applied.length}):`,
    ...appliedLines(fde).map(line => `  ${line}`),
    '',
    adoptedForeign(fde)
      ? 'This is not an agent/ branch: FDE mode adopted it and leaves it as it found it, open. Whoever owns it decides whether it merges or closes.'
      : 'Merging or closing it is the operator\'s call: a proposal can merge it (proposal merge <proposal rid> --apply --yes), ' +
        'or close it with: orthanc global-branch close ' + `${fde.branchRid} --apply --yes.`,
  ].join('\n')
}
