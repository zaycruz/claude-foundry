// FDE mode (/fde): one session, one goal, one global branch (an agent/ one it
// made, or one the person adopted), and the namespace in scope, if any. Pure
// functions, shared by the hooks and the tests. The mode only adds checks: the
// branch rule, the ladder and the destructive rule run as they do without it.
//
// While bound:
//  - every ontology write is pinned to the session's global branch (injected
//    when the call names none, refused when it names another);
//  - no global-branch or proposal changes (but add-repo on the bound branch):
//    closing or merging is the operator's;
//  - --apply runs only after a clean dry run of the same call, with every file
//    it reads pinned by SHA-256; each dry run licenses one apply;
//  - when a namespace is bound, every resource a write names, in its arguments
//    or the files it reads, must be in it (reads may look anywhere).

import type { FdeSession, FoundryNamespace } from '../types'
import { isRecord } from './orthanc'
import { BRANCH_FLAGS, flagValues, requiresBranch, unquote, validateBranchName } from './policy'

const PREFIX = 'agent/fde-'
const NAME_MAX = 64
const GOAL_MAX = 200
const RECORD_MAX = 50
const GLOBAL_BRANCH = /^ri\.branch\.\.branch\.[A-Za-z0-9-]+$/
const PROPOSAL_RID = /^ri\.branch\.\.proposal\.[A-Za-z0-9-]+$/
// A display name safe to show: one plain branch name, no spaces, quotes or control characters.
const PLAIN_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/
const FOREIGN_LINE = 'not an agent/ branch: FDE mode adopted it, and others may have work on it'
const GLOBAL_BRANCH_ANY = /ri\.branch\.\.branch\.[A-Za-z0-9-]+/g
const ONTOLOGY_RID = /ri\.ontology\.main\.ontology\.[A-Za-z0-9-]+/g
// Any Compass resource RID: RIDs a mutation names go to batch-get for their namespace.
const RESOURCE_RID = /ri\.[a-z0-9-]+\.[a-z0-9-]*\.[a-z0-9-]+\.[A-Za-z0-9-]+/g
// A quoted path in a file the call reads: an unquoted word in prose is not a path.
const QUOTED_PATH = /(?:"[^"\n]*"|'[^'\n]*')/g
// A path right after a quote: what a decoded double encoding leaves when its quotes no longer pair.
const QUOTE_OPENED_PATH = /["'](\/[^"'\n]*)/g
const BRANCH_RID_PREFIX = 'ri.branch.'
// A Compass folder RID: what `resource batch-get` may leave out, and what a write must then place.
export const COMPASS_FOLDER_RID = 'ri.compass.main.folder.'
const BATCH_MAX = 1000
// Flags that could be read as a branch flag by a lenient parser: a --br… prefix, or -b inside a bundle.
const AMBIGUOUS_BRANCH_FLAG = /^(--br(?!anch(=|$))[a-z-]*(=.*)?|-[a-z]*b[a-z]+|-[a-z]+b)$/i
const PROFILE_FLAG = /^--profile(=|$)/
// While bound, only this branch command runs, and only on the bound branch.
const GLOBAL_BRANCH_ALLOWED = new Set(['global-branch add-repo'])

// One JSON string escape and its letter forms, in one alternation: one pass never turns
// `\\u002e` into `\.`, only into `\u002e`.
const JSON_ESCAPE = /\\(?:u([0-9a-fA-F]{4})|(["\\/bfnrt]))/g
const ESCAPED: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

/** The text, then each JSON-unescaped copy of it until one stops changing (at most 8): what a parser reads out of an escaped or doubly encoded string. */
export function decodings(text: string): string[] {
  const out = [text]
  let current = text
  for (let pass = 0; pass < 8; pass += 1) {
    const next = current.replace(JSON_ESCAPE, (_whole, hex: string | undefined, letter: string | undefined) =>
      hex !== undefined ? String.fromCharCode(parseInt(hex, 16)) : (ESCAPED[letter!] ?? letter!),
    )
    if (next === current || out.includes(next)) break
    out.push(next)
    current = next
  }
  return out
}

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
    // A short flag with its file attached: -s@/work/schema.json is that file.
    const attached = /^-[A-Za-z]=?@(.+)$/.exec(arg)
    if (attached !== null) {
      required.push(absolute(attached[1]!, cwd, home))
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

/** Why a file the call reads is refused: it names another global branch or ontology, escaped or not. */
export function foreignRids(fde: FdeSession, text: string): string | null {
  const decoded = decodings(text)
  const branches = new Set(decoded.flatMap(copy => copy.match(GLOBAL_BRANCH_ANY) ?? []))
  branches.delete(fde.branchRid)
  const ontologies = new Set(decoded.flatMap(copy => copy.match(ONTOLOGY_RID) ?? []))
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
  if (fde.namespace !== null && path === 'space create') {
    return { deny: `${tag}: the session works in ${fde.namespace.name} only, and a new space is outside it. The operator ends the mode with /fde end.` }
  }
  if (path === 'global-branch create') {
    return { deny: `${tag}: this session works on ${fde.branchRid} only. Do not create another global branch; the operator ends the mode with /fde end.` }
  }
  if ((path.startsWith('global-branch ') && !GLOBAL_BRANCH_ALLOWED.has(path)) || path.startsWith('proposal ')) {
    return { deny: `${tag}: '${path}' changes branches or proposals, which is the operator's decision at handoff. Report that the work is ready instead.` }
  }
  const decoded = words.flatMap(word => decodings(word))
  const foreign = new Set(decoded.flatMap(word => word.match(GLOBAL_BRANCH_ANY) ?? []))
  foreign.delete(fde.branchRid)
  if (foreign.size > 0) return { deny: `${tag}: this call names ${[...foreign].join(', ')}; the session works on ${fde.branchRid} only.` }
  if (path.startsWith('global-branch ') && !words.includes(fde.branchRid)) {
    return { deny: `${tag}: '${path}' must name the session's branch ${fde.branchRid}.` }
  }
  const ontologies = new Set(decoded.flatMap(word => word.match(ONTOLOGY_RID) ?? []))
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
    namespace: plain(stored.namespace),
    spaces: Array.isArray(stored.spaces) ? stored.spaces.map(plain).filter((entry): entry is FoundryNamespace => entry !== null) : [],
  }
}

/** Why a write is refused: what it names, the namespace it is in, and that inputs count too. */
const refusal = (fde: FdeSession, target: string, spaceRid: string): string => {
  const ns = fde.namespace!
  const listed = fde.spaces.find(space => space.rid === spaceRid)
  const label = listed ? listed.name : `another namespace (${spaceRid})`
  return (
    `FDE mode (${fde.branchName}): ${target} is in ${label}, not ${ns.name}; the session works in ${ns.name} only, ` +
    'and every resource a write names (in its arguments or the files it reads) must be in it.'
  )
}

/** The space `path` names, by whole segments: `/Acme` does not claim `/Acme Dev/x`. Only a real path places one: a RID or an empty path standing in for a path claims nothing. */
const placePath = (fde: FdeSession, path: string): FoundryNamespace | undefined =>
  fde.spaces.find(space => space.path.startsWith('/') && (path === space.path || path.startsWith(space.path + '/')))

/** The arg as a path: `--flag=/x` carries `/x`; anything that is not absolute is not a path. */
const argPath = (arg: string): string => {
  const word = unquote(arg)
  const joined = /^--[a-z0-9-]+=(.*)$/i.exec(word)
  return joined ? unquote(joined[1]!) : word
}

/**
 * What a write names that could sit outside the bound namespace: the RIDs left
 * to look up, or why the call is refused now. Without a bound namespace nothing
 * is checked; a path under no listed space is nobody's business.
 */
export function namespaceScan(fde: FdeSession, args: readonly string[], texts: readonly string[]): { deny: string } | { lookup: string[] } {
  if (fde.namespace === null) return { lookup: [] }
  const skip = new Set([fde.branchRid, fde.ontologyRid, fde.namespace.rid])
  const found: string[] = []
  for (const arg of args) found.push(...decodings(unquote(arg)).flatMap(copy => copy.match(RESOURCE_RID) ?? []))
  for (const text of texts) found.push(...decodings(text).flatMap(copy => copy.match(RESOURCE_RID) ?? []))
  const lookup: string[] = []
  for (const rid of new Set(found)) {
    if (skip.has(rid) || rid.startsWith(BRANCH_RID_PREFIX)) continue
    // batch-get never returns a namespace's own space, so a listed one is refused by the list.
    const named = fde.spaces.find(space => space.rid === rid)
    if (named !== undefined) return { deny: refusal(fde, rid, named.rid) }
    lookup.push(rid)
  }
  // Whole args are paths; inside an arg (inline JSON) or a file, only quoted strings
  // and paths that open right after a quote are, in every decoding.
  const paths = [
    ...args.flatMap(arg => decodings(arg).map(argPath)),
    ...[...args, ...texts].flatMap(text =>
      decodings(text).flatMap(copy => [
        ...(copy.match(QUOTED_PATH) ?? []).map(unquote),
        ...Array.from(copy.matchAll(QUOTE_OPENED_PATH), match => match[1]!),
      ]),
    ),
  ]
  for (const path of paths) {
    if (!path.startsWith('/')) continue
    const placed = placePath(fde, path)
    if (placed !== undefined && placed.rid !== fde.namespace.rid) return { deny: refusal(fde, path, placed.rid) }
  }
  return { lookup }
}

/** `resource batch-get` argv for one call: at most 1000 RIDs each, in order. */
export function batchGetArgs(rids: readonly string[]): string[][] {
  const chunks: string[][] = []
  for (let index = 0; index < rids.length; index += BATCH_MAX) chunks.push(['resource', 'batch-get', ...rids.slice(index, index + BATCH_MAX)])
  return chunks
}

/** Each asked RID's spaceRid in a batch-get `data`, in asked order: null when batch-get left it out. */
export function spacesOf(data: unknown, asked: readonly string[]): Map<string, string | null> {
  const rows = isRecord(data) && Array.isArray(data.resources) ? data.resources.filter(isRecord) : []
  const spaces = new Map(rows.flatMap(row => (typeof row.rid === 'string' && typeof row.spaceRid === 'string' ? [[row.rid, row.spaceRid] as [string, string]] : [])))
  return new Map(asked.map(rid => [rid, spaces.get(rid) ?? null] as [string, string | null]))
}

/** Why this write names something outside the bound namespace; null when nothing looked-up is outside. */
export function namespaceDeny(fde: FdeSession, spaces: ReadonlyMap<string, string | null>): string | null {
  if (fde.namespace === null) return null
  const ns = fde.namespace
  for (const [rid, spaceRid] of spaces) {
    if (spaceRid === null) {
      if (!rid.startsWith(COMPASS_FOLDER_RID)) continue
      return (
        `FDE mode (${fde.branchName}): ${rid} is a Compass folder resource batch-get did not return, so it cannot be placed in ${ns.name}; ` +
        `the session works in ${ns.name} only, and every resource a write names (in its arguments or the files it reads) must be in it.`
      )
    }
    if (spaceRid !== ns.rid) return refusal(fde, rid, spaceRid)
  }
  return null
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
  fde.applied.length === 0 ? ['- nothing applied'] : fde.applied.map(entry => `- ${entry.at} ${entry.command}`)

export function fdeContext(fde: FdeSession): string {
  return [
    '# FDE mode',
    `Goal: ${goalLabel(fde.goal)}${fde.goal === '' ? ' (the operator works with you turn by turn; /fde goal sets one)' : ''}`,
    `This session works on one global branch: ${fde.branchName} (${fde.branchRid}) on ontology ${fde.ontologyRid}, stack ${fde.profile}.`,
    ...(adoptedForeign(fde)
      ? [`This is ${FOREIGN_LINE}. Change only what the goal needs, and leave what you did not make as you found it.`]
      : []),
    ...(fde.namespace ? [`Writes are limited to namespace ${fde.namespace.name} (${fde.namespace.path}): every resource a write names (in its arguments or the files it reads) must be in it, or the write is refused. Reads may look anywhere.`] : []),
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
    `FDE mode on · ${goalLabel(fde.goal)}`,
    `branch ${fde.branchName} (${fde.branchRid})`,
    ...(adoptedForeign(fde) ? [FOREIGN_LINE] : []),
    `stack ${fde.profile} · ontology ${fde.ontologyRid} · since ${fde.startedAt}`,
    ...(fde.namespace ? [`namespace ${fde.namespace.name} (${fde.namespace.path}): writes naming resources outside it are refused`] : []),
    `${fde.applied.length} applied · ${fde.plans.length} planned`,
    '/fde end hands off and leaves the branch open.',
  ].join('\n')
}

export function fdeHandoff(fde: FdeSession): string {
  return [
    `# FDE handoff: ${goalLabel(fde.goal)}`,
    '',
    `- Branch: ${fde.branchName} (${fde.branchRid}), still OPEN and not merged.`,
    `- Stack ${fde.profile}, ontology ${fde.ontologyRid}, started ${fde.startedAt}.`,
    ...(fde.namespace ? [`- Namespace: ${fde.namespace.name} (${fde.namespace.path}).`] : []),
    `- Applied writes (${fde.applied.length}):`,
    ...appliedLines(fde).map(line => `  ${line}`),
    '',
    adoptedForeign(fde)
      ? 'This is not an agent/ branch: FDE mode adopted it and leaves it as it found it, open. Whoever owns it decides whether it merges or closes.'
      : 'The operator reviews the branch, then merges it through a proposal or closes it: ' +
        `orthanc global-branch close ${fde.branchRid} --apply --yes.`,
  ].join('\n')
}
