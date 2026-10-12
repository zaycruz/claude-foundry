// FDE mode (/fde): one session, one goal, one agent global branch. Pure
// functions, shared by the hooks and the tests. The mode only adds checks: the
// branch rule, the ladder and the destructive rule run as they do without it.
//
// While bound:
//  - every ontology write is pinned to the session's global branch (injected
//    when the call names none, refused when it names another);
//  - no global-branch or proposal changes (but add-repo on the bound branch):
//    closing or merging is the operator's;
//  - --apply runs only after a clean dry run of the same call, with every file
//    it reads pinned by SHA-256; each dry run licenses one apply.

import type { FdeSession } from '../types'
import { BRANCH_FLAGS, flagValues, requiresBranch, unquote, validateBranchName } from './policy'

const PREFIX = 'agent/fde-'
const NAME_MAX = 64
const GOAL_MAX = 200
const RECORD_MAX = 50
const GLOBAL_BRANCH = /^ri\.branch\.\.branch\.[A-Za-z0-9-]+$/
const GLOBAL_BRANCH_ANY = /ri\.branch\.\.branch\.[A-Za-z0-9-]+/g
const ONTOLOGY_RID = /ri\.ontology\.main\.ontology\.[A-Za-z0-9-]+/g
// Flags that could be read as a branch flag by a lenient parser: a --br… prefix, or -b inside a bundle.
const AMBIGUOUS_BRANCH_FLAG = /^(--br(?!anch(=|$))[a-z-]*(=.*)?|-[a-z]*b[a-z]+|-[a-z]+b)$/i
const PROFILE_FLAG = /^--profile(=|$)/
// While bound, only this branch command runs, and only on the bound branch.
const GLOBAL_BRANCH_ALLOWED = new Set(['global-branch add-repo'])

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
  | { kind: 'error'; reason: string }

export function parseFdeArgs(text: string): FdeArgs {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === 'status') return { kind: 'status' }
  if (trimmed === 'end') return { kind: 'end' }
  if (trimmed === 'resume') return { kind: 'resume' }
  const adopt = /^--branch(?:=|\s+)(\S+)\s*([\s\S]*)$/.exec(trimmed)
  if (adopt) {
    const rid = adopt[1]!
    const goal = cleanGoal(adopt[2] ?? '')
    if (!GLOBAL_BRANCH.test(rid)) return { kind: 'error', reason: `'${rid}' is not a global branch RID (ri.branch..branch.…).` }
    if (goal === '') return { kind: 'error', reason: 'Name the goal after the branch: /fde --branch <rid> <goal>.' }
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
  slug = slug.replace(/-+$/, '') || 'work'
  const name = `${PREFIX}${slug}${suffix}`
  return validateBranchName('global-branch create', name).ok ? name : `${PREFIX}work${suffix}`
}

export function branchCreateArgs(name: string, ontologyRid: string, goal: string): string[] {
  return ['global-branch', 'create', name, '--ontology-rid', ontologyRid, '--description', `claude-foundry FDE: ${goal}`.slice(0, GOAL_MAX), '--apply']
}

/** The global branch RID in a clean orthanc envelope; null on errors or none. */
export function branchRidFrom(envelope: { data?: unknown; errors?: unknown }): string | null {
  if (Array.isArray(envelope.errors) && envelope.errors.length > 0) return null
  const found = /ri\.branch\.\.branch\.[A-Za-z0-9-]+/.exec(JSON.stringify(envelope.data ?? null))
  return found ? found[0] : null
}

export const hasApply = (args: readonly string[]) => args.some(arg => /^--apply(=.*)?$/.test(unquote(arg)))

const FILE_FLAG = /^--(?:[a-z0-9-]+-)?file$/
const absolute = (path: string, cwd: string, home: string) => {
  const expanded = home !== '' ? path.replace(/^~(?=\/|$)/, home) : path
  return expanded.startsWith('/') ? expanded : `${cwd.replace(/\/$/, '')}/${expanded}`
}
// Any word that could name a file: not a flag, RID, URL or number. A word that
// is not a file simply does not read, and is left out of the plan.
const looksLikePath = (value: string) =>
  value !== '' && !value.startsWith('-') && !/^ri\./.test(value) && !/^[a-z]+:\/\//i.test(value) && !/^[0-9.:]+$/.test(value) && !/[\n{}]/.test(value)

/** Files a call may read, absolute against `cwd`: `required` (values of --file
 * and --*-file flags, and @name references) must be readable; `optional`
 * (every other word that could be a path) is hashed when it reads. Directories
 * do not read, so their contents are not pinned. */
export function fileCandidates(args: readonly string[], cwd: string, home = ''): { required: string[]; optional: string[] } {
  const required: string[] = []
  const optional: string[] = []
  for (let index = 0; index < args.length; index += 1) {
    const arg = unquote(args[index] ?? '')
    if (FILE_FLAG.test(arg) && args[index + 1] !== undefined) {
      required.push(absolute(unquote(args[index + 1]!).replace(/^@/, ''), cwd, home))
      index += 1
      continue
    }
    const joined = /^(--[a-z0-9-]+)=(.+)$/i.exec(arg)
    const raw = joined ? unquote(joined[2]!) : arg
    const value = raw.replace(/^@/, '')
    if ((joined && FILE_FLAG.test(joined[1]!)) || (raw.startsWith('@') && value !== '')) required.push(absolute(value, cwd, home))
    else if (looksLikePath(value)) optional.push(absolute(value, cwd, home))
  }
  return { required, optional }
}

/** SHA-256 of the text, with its length: what a plan pins a file to. */
export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return `${text.length}:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')}`
}

/** One call, --apply removed, with the hash of every file it reads. */
export function planSignature(path: string, args: readonly string[], fileHashes: Record<string, string>): string {
  const kept = args.filter(arg => !/^--apply(=.*)?$/.test(unquote(arg))).map(unquote)
  const files = Object.keys(fileHashes)
    .sort()
    .map(file => [file, fileHashes[file]])
  return JSON.stringify([path, kept, files])
}

export function planGate(fde: FdeSession, signature: string, isApply: boolean): string | null {
  if (!isApply || fde.plans.includes(signature)) return null
  return (
    'FDE mode: --apply runs only after a clean dry run of the same call. Run it without --apply first, ' +
    'read the plan, then apply with identical arguments. Each dry run licenses one apply, and editing a file the call reads voids it.'
  )
}

export const recordPlan = (fde: FdeSession, signature: string): FdeSession =>
  fde.plans.includes(signature) ? fde : { ...fde, plans: [...fde.plans, signature].slice(-RECORD_MAX) }

/** Takes the plan for one apply, so a second identical apply (even in parallel) finds it gone. */
export function takePlan(fde: FdeSession, signature: string): { fde: FdeSession; taken: boolean } {
  if (!fde.plans.includes(signature)) return { fde, taken: false }
  return { fde: { ...fde, plans: fde.plans.filter(plan => plan !== signature) }, taken: true }
}

/** Why a file the call reads is refused: it names another global branch or ontology. */
export function foreignRids(fde: FdeSession, text: string): string | null {
  const branches = new Set(text.match(GLOBAL_BRANCH_ANY) ?? [])
  branches.delete(fde.branchRid)
  const ontologies = new Set(text.match(ONTOLOGY_RID) ?? [])
  ontologies.delete(fde.ontologyRid)
  const found = [...branches, ...ontologies]
  return found.length === 0 ? null : `a file this call reads names ${found.join(', ')}; the session works on ${fde.branchRid} in ${fde.ontologyRid} only.`
}

/** An apply consumes its dry run: the next apply needs a new one. */
export const recordApply = (fde: FdeSession, command: string, signature: string, now: Date): FdeSession => ({
  ...fde,
  plans: fde.plans.filter(plan => plan !== signature),
  applied: [...fde.applied, { command, at: now.toISOString() }].slice(-RECORD_MAX),
})

/** Binds one orthanc_cli call to the session: the (possibly rewritten) args, or why it is refused. */
export function fdeBind(
  fde: FdeSession,
  path: string,
  args: readonly string[],
  profile: string,
  isMutation: boolean,
): { args: string[] } | { deny: string } {
  const tag = `FDE mode (${fde.branchName})`
  const words = args.map(unquote)
  // The stack is the session's: no call may switch it, read or write.
  if (words.some(word => PROFILE_FLAG.test(word))) return { deny: `${tag}: --profile is not allowed while bound; the session runs on stack '${fde.profile}'.` }
  if (!isMutation) return { args: [...args] }
  if (profile !== fde.profile) {
    return { deny: `${tag}: the session's branch is on stack '${fde.profile}', but the active stack is '${profile}'. Switch back with /profile ${fde.profile}, or /fde end.` }
  }
  if (path === 'global-branch create') {
    return { deny: `${tag}: this session works on ${fde.branchRid} only. Do not create another global branch; the operator ends the mode with /fde end.` }
  }
  if ((path.startsWith('global-branch ') && !GLOBAL_BRANCH_ALLOWED.has(path)) || path.startsWith('proposal ')) {
    return { deny: `${tag}: '${path}' changes branches or proposals, which is the operator's decision at handoff. Report that the work is ready instead.` }
  }
  const foreign = new Set(words.flatMap(word => word.match(GLOBAL_BRANCH_ANY) ?? []))
  foreign.delete(fde.branchRid)
  if (foreign.size > 0) return { deny: `${tag}: this call names ${[...foreign].join(', ')}; the session works on ${fde.branchRid} only.` }
  if (path.startsWith('global-branch ') && !words.includes(fde.branchRid)) {
    return { deny: `${tag}: '${path}' must name the session's branch ${fde.branchRid}.` }
  }
  const ontologies = new Set(words.flatMap(word => word.match(ONTOLOGY_RID) ?? []))
  ontologies.delete(fde.ontologyRid)
  if (ontologies.size > 0) {
    return { deny: `${tag}: the branch belongs to ontology ${fde.ontologyRid}; this call names ${[...ontologies].join(', ')}.` }
  }
  if (!path.startsWith('ontology ')) return { args: [...args] }
  if (words.some(word => AMBIGUOUS_BRANCH_FLAG.test(word))) {
    return { deny: `${tag}: spell the branch flag as --branch (or leave it out and the mode supplies it).` }
  }
  const branches = flagValues(args, BRANCH_FLAGS)
  if (branches.length === 0) return { args: requiresBranch(path) ? [...args, '--branch', fde.branchRid] : [...args] }
  if (branches.length === 1 && branches[0] === fde.branchRid) return { args: [...args] }
  const named = branches.filter(Boolean).join(', ') || '(no value)'
  return { deny: `${tag}: ontology writes go to ${fde.branchRid}; this call names --branch ${named}. Drop --branch and the mode supplies it.` }
}

/** The branch's name when `data` (global-branch get) is an OPEN agent/ branch of `ontologyRid`; why not otherwise. */
export function adoptable(data: unknown, ontologyRid: string): { name: string } | string {
  const record = (data as { branch_record?: Record<string, unknown> } | null)?.branch_record
  if (typeof record !== 'object' || record === null) return 'global-branch get returned no branch record.'
  const name = typeof record.display_name === 'string' ? cleanGoal(record.display_name) : ''
  if (record.branch_status !== 'OPEN') return `The branch is ${String(record.branch_status ?? 'unknown')}, not OPEN.`
  if (record.ontology_rid !== ontologyRid) return `The branch belongs to ontology ${String(record.ontology_rid ?? 'unknown')}, not the selected ${ontologyRid}.`
  if (!name.startsWith('agent/') || !validateBranchName('global-branch create', name).ok) return `The branch '${name.slice(0, 80) || '?'}' is not a valid agent/ branch name.`
  return { name }
}

const appliedLines = (fde: FdeSession) =>
  fde.applied.length === 0 ? ['- nothing applied'] : fde.applied.map(entry => `- ${entry.at} ${entry.command}`)

export function fdeContext(fde: FdeSession): string {
  return [
    '# FDE mode',
    `Goal: ${fde.goal}`,
    `This session works on one global branch: ${fde.branchName} (${fde.branchRid}) on ontology ${fde.ontologyRid}, stack ${fde.profile}.`,
    'Ontology writes are pinned to it: omit --branch and the mode adds it; any other branch, --profile or a new branch is refused. ' +
      'Pass --branch with that RID on reads you mean to see the branch (`ontology definition --object-type X --branch <rid>`); reads without it see main.',
    'Plan, then apply: run each write as a dry run (no --apply), read the plan, then repeat it with --apply and identical arguments. ' +
      'Each dry run licenses one apply, and editing a file the call reads voids it. Keep request files outside ~/.claude.',
    'Work as an FDE: scout what exists, make the smallest change on the branch, verify it on the branch, then report. ' +
      'Never create, close or merge branches: the operator ends the mode with /fde end and decides what lands.',
  ].join('\n')
}

export function fdeStatus(fde: FdeSession): string {
  return [
    `FDE mode on · ${fde.goal}`,
    `branch ${fde.branchName} (${fde.branchRid})`,
    `stack ${fde.profile} · ontology ${fde.ontologyRid} · since ${fde.startedAt}`,
    `${fde.applied.length} applied · ${fde.plans.length} planned`,
    '/fde end hands off and leaves the branch open.',
  ].join('\n')
}

export function fdeHandoff(fde: FdeSession): string {
  return [
    `# FDE handoff: ${fde.goal}`,
    '',
    `- Branch: ${fde.branchName} (${fde.branchRid}), still OPEN and not merged.`,
    `- Stack ${fde.profile}, ontology ${fde.ontologyRid}, started ${fde.startedAt}.`,
    `- Applied writes (${fde.applied.length}):`,
    ...appliedLines(fde).map(line => `  ${line}`),
    '',
    'The operator reviews the branch, then merges it through a proposal or closes it: ' +
      `orthanc global-branch close ${fde.branchRid} --apply --yes.`,
  ].join('\n')
}
