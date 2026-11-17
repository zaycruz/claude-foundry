// The orthanc_help and orthanc_cli tools' pure half.
// Pure: the envelope, the manifest and the help text. Running orthanc stays
// in register.tsx, where `$` lives.

import { DENIED_COMMANDS, type ManifestCommand, type ManifestFlag } from './policy'

export type Envelope = {
  schema_version: string
  data?: unknown
  errors?: unknown[]
  meta?: Record<string, unknown>
  warnings?: unknown[]
  [key: string]: unknown
}

const INLINE_LIMIT = 20_000
const ROW_NAMES_LIMIT = 8_000

/** A row's identity for a cut listing: api name, else display name, else RID. */
const rowName = (row: Record<string, unknown>) =>
  [row.api_name, row.apiName, row.display_name, row.name, row.rid].find((value): value is string => typeof value === 'string' && value !== '') ?? ''
const USAGE_ERRORS = ['required arguments were not provided', 'unexpected argument', 'usage: orthanc', 'invalid value']

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export function parseEnvelope(stdout: string): Envelope | null {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return isRecord(parsed) && parsed.schema_version === 'foundry-agent-v1' ? (parsed as Envelope) : null
  } catch {
    return null
  }
}

export const failure = (type: string, message: string, operation: string, extra: Record<string, unknown> = {}): Envelope => ({
  schema_version: 'foundry-agent-v1',
  data: null,
  errors: [{ type, message, ...extra }],
  meta: { operation },
  warnings: [],
})

export function manifestFrom(envelope: Envelope): ManifestCommand[] {
  const commands = isRecord(envelope.data) && Array.isArray(envelope.data.commands) ? envelope.data.commands : []
  return commands.filter(isRecord).flatMap(entry =>
    typeof entry.path === 'string'
      ? [{
          path: entry.path,
          kind: typeof entry.kind === 'string' ? entry.kind : undefined,
          auth: typeof entry.auth === 'string' ? entry.auth : undefined,
          input: typeof entry.input === 'string' ? entry.input : undefined,
          flags: flagsFrom(entry.args),
        }]
      : [],
  )
}

function flagsFrom(args: unknown): ManifestFlag[] {
  if (!Array.isArray(args)) return []
  return args.filter(isRecord).flatMap(arg =>
    typeof arg.flag === 'string'
      ? [{ flag: arg.flag, takesValue: arg.takes_value === true, ...(typeof arg.default === 'string' ? { default: arg.default } : {}) }]
      : [],
  )
}

// orthanc_cli's process timer. Waiting commands (repository checks wait,
// ontology branch-index-status --wait, sql wait, ai-fde run, …) run as long as
// their own --timeout, plus --publish-grace after the checks pass. The timer
// gives them that wait, any fixed time Orthanc adds around it, one poll
// interval (Orthanc can overshoot its deadline by one) and a margin, so Orthanc
// reports its own timeout instead of being killed. The floor is the old fixed
// 300 s; the cap is Orthanc's longest default wait (ai-fde run: 1800 s plus
// 370 s around it) plus the margin, or more for a command whose own defaults
// need more, so a call with its defaults is never refused. A call that would
// need more is refused before Orthanc starts.
const CLI_MARGIN_S = 120
export const CLI_TIMEOUT_FLOOR_MS = 300_000
const WAIT_FLAGS = ['--timeout', '--publish-grace']
const POLL_FLAGS = ['--interval', '--poll-interval']

// What the manifest cannot say about a command's wait (orthanc-source
// src/ai_fde_web.rs): ai-fde run's --timeout is 1800 s when absent but the
// flag carries no manifest default, and around it Orthanc gives the browser
// worker 300 s to start, stops it up to 60 s past the timeout and waits 10 s
// for it to exit. A manifest default, when one appears, wins over `defaults`.
type WaitExtra = { defaults: Record<string, string>; aroundS: number; detachHint: string; stoppedHint: string }
const AI_FDE_RUN_EXTRA: WaitExtra = {
  defaults: { '--timeout': '1800' },
  aroundS: 300 + 60 + 10,
  detachHint: "or pass --detach and read the run later with 'ai-fde status <thread>' and 'ai-fde result <thread>'",
  stoppedHint:
    "The run may still be going in the AI FDE web app: find its thread with 'ai-fde threads list' and read it with " +
    "'ai-fde status <thread>' and 'ai-fde result <thread>'. For a long run, pass --detach next time.",
}
const WAIT_EXTRAS: Readonly<Record<string, WaitExtra>> = { 'ai-fde run': AI_FDE_RUN_EXTRA }
const CLI_LONGEST_WAIT_S = 1800 + AI_FDE_RUN_EXTRA.aroundS
export const CLI_TIMEOUT_CAP_MS = (CLI_LONGEST_WAIT_S + CLI_MARGIN_S) * 1000

/** The last value given for `flag` (`--flag v` or `--flag=v`); '' when it dangles, undefined when absent. */
function flagArgument(args: readonly string[], flag: string): string | undefined {
  let value: string | undefined
  args.forEach((arg, index) => {
    if (arg === flag) value = args[index + 1] ?? ''
    else if (arg.startsWith(`${flag}=`)) value = arg.slice(flag.length + 1)
  })
  return value
}

export type CliWait = {
  timeoutMs: number
  neededMs: number
  /** The cap for this command: the general cap, or what its own defaults need when that is more. */
  capMs: number
  overCap: boolean
  /** The largest --timeout that fits, when one does. */
  maxTimeoutS?: number
  /** The flags the call passed that put it over the cap, --timeout when one smaller would fit. */
  overFlags?: string[]
}

const OFF_VALUES = new Set(['false', '0', 'no', 'off'])

/**
 * orthanc_cli's timer for `command` with `args` (the resolved args, flags
 * included): `timeoutMs` the timer, cut to the cap; `overCap` when the call
 * would need more, then with the largest `maxTimeoutS` that fits, and the
 * flags to make smaller.
 */
export function cliWait(command: ManifestCommand | undefined, args: readonly string[]): CliWait {
  const flags = command?.flags ?? []
  const extra = command ? WAIT_EXTRAS[command.path] : undefined
  const declares = (flag: string) => flags.some(entry => entry.flag === flag)
  // A switch is on when passed bare or with a value other than false/0/no/off.
  const passes = (flag: string) =>
    args.some(arg => arg === flag || (arg.startsWith(`${flag}=`) && !OFF_VALUES.has(arg.slice(flag.length + 1).trim().toLowerCase())))
  const given = (flag: string) => args.some(arg => arg === flag || arg.startsWith(`${flag}=`))
  const parse = (raw: string | undefined) => {
    const value = raw === undefined || raw.trim() === '' ? NaN : Number(raw)
    return Number.isFinite(value) && value >= 0 ? value : undefined
  }
  const defaultSeconds = (flag: string) =>
    parse(flags.find(entry => entry.flag === flag)?.default ?? extra?.defaults[flag]) ?? 0
  // A value orthanc will reject counts as the default, so the timer is never
  // shorter than the wait orthanc would run.
  const seconds = (flag: string) => parse(flagArgument(args, flag)) ?? defaultSeconds(flag)
  // A command with a --wait switch only waits when it is passed; --no-wait never
  // waits; --detach returns once the job exists; without --apply it is a plan.
  const waits =
    !passes('--no-wait') &&
    !passes('--detach') &&
    (!declares('--apply') || passes('--apply')) &&
    (!declares('--wait') || passes('--wait'))
  const totalOf = (secondsOf: (flag: string) => number) => {
    const wait = WAIT_FLAGS.reduce((sum, flag) => sum + secondsOf(flag), 0)
    return wait === 0 ? 0 : wait + (extra?.aroundS ?? 0) + Math.max(...POLL_FLAGS.map(secondsOf)) + CLI_MARGIN_S
  }
  const capMs = Math.max(CLI_TIMEOUT_CAP_MS, totalOf(defaultSeconds) * 1000)
  const totalS = waits ? totalOf(seconds) : 0
  if (totalS === 0) return { timeoutMs: CLI_TIMEOUT_FLOOR_MS, neededMs: CLI_TIMEOUT_FLOOR_MS, capMs, overCap: false }
  const neededMs = Math.max(CLI_TIMEOUT_FLOOR_MS, totalS * 1000)
  const overCap = neededMs > capMs
  if (!overCap) return { timeoutMs: neededMs, neededMs, capMs, overCap }
  const fits = Math.floor(capMs / 1000 - (totalS - seconds('--timeout')))
  // When no --timeout fits, the other passed flags are what to make smaller.
  const others = [...WAIT_FLAGS, ...POLL_FLAGS].filter(flag => flag !== '--timeout' && given(flag) && seconds(flag) > 0)
  const overFlags = fits > 0 ? ['--timeout'] : others
  return {
    timeoutMs: capMs,
    neededMs,
    capMs,
    overCap,
    ...(fits > 0 ? { maxTimeoutS: fits } : {}),
    ...(overFlags.length > 0 ? { overFlags } : {}),
  }
}

/** How long orthanc_cli lets `command` run with `args`, in ms. */
export const cliTimeoutMs = (command: ManifestCommand | undefined, args: readonly string[]) => cliWait(command, args).timeoutMs

/** The refusal of a call that would run past the cap; Orthanc did not start. */
export function overCapFailure(command: ManifestCommand, wait: CliWait): Envelope {
  const cap = wait.capMs / 1000
  const needed = Math.ceil(wait.neededMs / 1000)
  const smaller = wait.overFlags?.length ? wait.overFlags.join(' or ') : '--timeout'
  const ways = [
    wait.maxTimeoutS === undefined ? `Pass a smaller ${smaller}` : `Pass --timeout ${wait.maxTimeoutS} or less`,
    WAIT_EXTRAS[command.path]?.detachHint,
    command.kind === 'read-only' ? 'and call it again if it times out: the wait is a read' : undefined,
  ].filter(Boolean)
  return failure(
    'timeout-over-cap',
    `'${command.path}' could run for ${needed} s; orthanc_cli runs a call for at most ${cap} s, so it did not start. ${ways.join(', ')}.`,
    command.path,
    { cap_seconds: cap, needed_seconds: needed, ...(wait.maxTimeoutS === undefined ? {} : { max_timeout_seconds: wait.maxTimeoutS }) },
  )
}

// Refusals orthanc_cli makes itself, before orthanc starts.
const NOT_RUN_TYPES = new Set(['timeout-over-cap', 'credential-command-denied', 'unknown-command', 'orthanc-binary-changed', 'orthanc-manifest-unavailable'])

/** True when the failure never reached Foundry: orthanc_cli refused it, or orthanc rejected its usage. */
export function notRunFailure(envelope: Envelope): boolean {
  const [first] = Array.isArray(envelope.errors) ? envelope.errors : []
  return (isRecord(first) && typeof first.type === 'string' && NOT_RUN_TYPES.has(first.type)) || isUsageError(envelope)
}

/** The next step after orthanc_cli's timer stopped a call, or the call was cancelled. */
function stoppedHint(command: ManifestCommand, reason: 'timeout' | 'cancelled'): string {
  const extra = WAIT_EXTRAS[command.path]
  if (extra) return extra.stoppedHint
  if (command.kind === 'read-only') {
    return reason === 'timeout'
      ? 'It is a read: call it again to keep waiting, with a --timeout that fits.'
      : 'It is a read: call it again to keep waiting.'
  }
  return 'Read the matching Foundry state before any retry.'
}

/** Adds the next step to a launch error whose call was stopped (its `reason`). */
export function withStoppedHint(envelope: Envelope, command: ManifestCommand): Envelope {
  const [first, ...rest] = Array.isArray(envelope.errors) ? envelope.errors : []
  if (!isRecord(first) || (first.reason !== 'timeout' && first.reason !== 'cancelled')) return envelope
  return { ...envelope, errors: [{ ...first, hint: stoppedHint(command, first.reason) }, ...rest] }
}

export const normalizeCommand = (command: string) => command.trim().replace(/\s+/g, ' ')

const groupOf = (path: string) => path.split(' ')[0] ?? path

function commandLine(command: ManifestCommand): string {
  const traits = [command.kind, command.auth && `auth: ${command.auth}`, command.input && `input: ${command.input}`]
    .filter(Boolean)
    .join(', ')
  return `${command.path}${traits ? ` — ${traits}` : ''}`
}

export const isCredentialCommand = (command: ManifestCommand) =>
  DENIED_COMMANDS.has(command.path) || command.input === 'token-on-stdin'

export function renderCommand(command: ManifestCommand, help: string | null): string {
  const lines = [commandLine(command)]
  if (help) {
    lines.push('', help.slice(0, 4000), '')
    lines.push(
      'For orthanc_cli, put positionals first in args, then exact flags. Do not invent flags. ' +
        'Agent/non-interactive flags and the profile are supplied by the tool.',
    )
  }
  if (isCredentialCommand(command)) {
    lines.push('This credential-input command is not executable through orthanc_cli; the operator runs it in a terminal.')
  }
  return lines.join('\n')
}

export function renderListing(
  commands: readonly ManifestCommand[],
  input: { group?: string; query?: string },
): string {
  if (input.query) {
    const terms = input.query.toLowerCase().split(/\s+/).filter(Boolean)
    const hits = commands
      .map(command => ({ command, score: terms.filter(term => command.path.toLowerCase().includes(term)).length }))
      .filter(hit => hit.score > 0)
      .sort((left, right) => right.score - left.score || left.command.path.localeCompare(right.command.path))
      .slice(0, 20)
    if (hits.length === 0) return `No Orthanc commands matched '${input.query}'.`
    return [`Orthanc search '${input.query}': ${hits.length} hit${hits.length === 1 ? '' : 's'}.`, '', ...hits.map(hit => commandLine(hit.command))].join('\n')
  }
  if (input.group) {
    const matches = commands.filter(command => groupOf(command.path) === input.group)
    if (matches.length === 0) {
      return `Unknown Orthanc group '${input.group}'. Groups: ${[...new Set(commands.map(command => groupOf(command.path)))].sort().join(', ')}.`
    }
    return [`Orthanc group '${input.group}': ${matches.length} command${matches.length === 1 ? '' : 's'}.`, '', ...matches.map(commandLine)].join('\n')
  }
  const counts = new Map<string, number>()
  for (const command of commands) counts.set(groupOf(command.path), (counts.get(groupOf(command.path)) ?? 0) + 1)
  return [
    `Orthanc command surface: ${commands.length} commands in ${counts.size} groups.`,
    'Call orthanc_help with a group to list commands, with a command path to inspect it, or with query to search.',
    '',
    ...[...counts.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([group, count]) => `${group} (${count})`),
  ].join('\n')
}

function verificationHint(path: string): string {
  if (path.startsWith('global-branch create')) return "verify with 'global-branch get <branch_rid>' before reporting success"
  if (path.startsWith('dataset branches create')) return "verify with 'dataset branches list <dataset_rid>' before reporting success"
  if (path.startsWith('dataset create')) return "verify with 'dataset get <dataset_rid>' before reporting success"
  if (path.startsWith('ontology ')) return 'verify with the matching ontology read for the changed type before reporting success'
  return 'verify the change with the matching read operation before reporting success'
}

export const isErrorEnvelope = (envelope: Envelope) => Array.isArray(envelope.errors) && envelope.errors.length > 0

export function isUsageError(envelope: Envelope): boolean {
  const reason = JSON.stringify(envelope.errors ?? []).toLowerCase()
  return USAGE_ERRORS.some(pattern => reason.includes(pattern))
}

/** Usage hint on usage errors; verification hint or uncertain-mutation flag on mutations. */
export function guideEnvelope(envelope: Envelope, command: ManifestCommand, help: string | null): Envelope {
  const usage = isUsageError(envelope)
  let guided = usage && help ? { ...envelope, usage_hint: help.slice(0, 4000) } : envelope
  if (command.kind !== 'mutation') return guided
  if (!isErrorEnvelope(guided)) return { ...guided, verification_hint: verificationHint(command.path) }
  if (!usage && JSON.stringify(guided.errors).includes('orthanc-launch-error')) {
    guided = { ...guided, uncertain_mutation: true, guidance: 'reconcile observable Foundry state before any retry' }
  }
  return guided
}

/**
 * The envelope as text for the model. Over the inline limit it is cut, with the
 * page token and list sizes hoisted above the cut (they sit in `data`, which the
 * cut can hide) and, when given, the path the whole envelope was written to.
 */
export function serialize(value: unknown, spillPath?: string): string {
  const text = JSON.stringify(value, null, 2) ?? 'null'
  if (text.length <= INLINE_LIMIT) return text
  const header = [`orthanc output is ${text.length} chars; showing the first ${INLINE_LIMIT}.`]
  if (spillPath) header.push(`The whole envelope is in ${spillPath}: read it with the Read tool (offset/limit) or jq.`)
  const data = isRecord(value) ? value.data : undefined
  if (isRecord(data)) {
    const token = data.next_page_token ?? data.nextPageToken
    if (typeof token === 'string' && token) header.push(`next_page_token: ${token} (pass --page-token to read the next page).`)
    const sizes = Object.entries(data).filter(([, entry]) => Array.isArray(entry)).map(([key, entry]) => `${key}: ${(entry as unknown[]).length}`)
    if (sizes.length > 0) header.push(`rows on this page: ${sizes.join(', ')}.`)
    for (const [key, entry] of Object.entries(data)) {
      if (!Array.isArray(entry)) continue
      const names = entry.filter(isRecord).map(rowName).filter(Boolean)
      if (names.length === 0) continue
      const joined = names.join(', ')
      header.push(`${key}: ${joined.length > ROW_NAMES_LIMIT ? `${joined.slice(0, ROW_NAMES_LIMIT)} …` : joined}`)
    }
  }
  if (!spillPath) header.push('Narrow the call (--page-size, a get command) for less output.')
  return `${header.join('\n')}\n\n${text.slice(0, INLINE_LIMIT)}\n... truncated`
}

export const isOversized = (value: unknown) => (JSON.stringify(value, null, 2)?.length ?? 0) > INLINE_LIMIT

/** The list inside an orthanc list envelope, wherever the envelope keeps it. */
export function listItems(envelope: Envelope, key: string): Record<string, unknown>[] {
  const data = envelope.data
  if (Array.isArray(data)) return data.filter(isRecord)
  if (!isRecord(data)) return []
  const list = data[key] ?? data.data
  return Array.isArray(list) ? list.filter(isRecord) : []
}

/** The rows of an envelope whose list key varies by command: the named keys, then the first list in data. */
export function rowsOf(envelope: Envelope, keys: readonly string[]): Record<string, unknown>[] {
  const data = envelope.data
  if (Array.isArray(data)) return data.filter(isRecord)
  if (!isRecord(data)) return []
  for (const key of [...keys, 'data']) {
    const list = data[key]
    if (Array.isArray(list)) return list.filter(isRecord)
  }
  const first = Object.values(data).find(Array.isArray)
  return Array.isArray(first) ? first.filter(isRecord) : []
}
