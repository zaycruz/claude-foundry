// The orthanc_help and orthanc_cli tools' pure half.
// Pure: the envelope, the manifest and the help text. Running orthanc stays
// in register.tsx, where `$` lives.

import { DENIED_COMMANDS, type ManifestCommand } from './policy'

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
        }]
      : [],
  )
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
