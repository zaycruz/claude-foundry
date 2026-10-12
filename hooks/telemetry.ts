// Trace export: one OTLP trace per Foundry turn, sent to any OTLP/HTTP
// collector (Langfuse's /api/public/otel among them). Pure functions: the
// hooks hold the state and do the fetch. Every exported value is redacted at
// source; a value that cannot be serialized is dropped, never sent raw.

export type TraceConfig = { url: string; headers: Record<string, string>; host: string; toolIo: boolean }

export type TraceEnv = Partial<Record<string, string>>

export const TRACE_ENV_KEYS: readonly string[] = [
  'OTEL_EXPORTER_OTLP_TRACES_ENDPOINT',
  'OTEL_EXPORTER_OTLP_ENDPOINT',
  'OTEL_EXPORTER_OTLP_HEADERS',
  'LANGFUSE_BASE_URL',
  'LANGFUSE_HOST',
  'LANGFUSE_PUBLIC_KEY',
  'LANGFUSE_SECRET_KEY',
  'FOUNDRY_OTEL',
  'FOUNDRY_OTEL_TOOL_IO',
  'PALANTIR_AGENT_OTEL_TOOL_IO',
  'OTEL_SERVICE_NAME',
  'OTEL_RESOURCE_ATTRIBUTES',
  'FOUNDRY_OTEL_REDACT_DOMAINS',
]

/**
 * An env file read as data, never run: `[export ]KEY=VALUE` lines for the
 * TRACE_ENV_KEYS only, quotes stripped. A value that is a 1Password reference
 * (op://vault/item/field) is returned in `refs` for the caller to resolve
 * through `op read` by argv; anything that looks like shell ($, `) is dropped,
 * and a credential written literally is ignored and named in `literalSecrets`.
 */
// Keys that carry credentials: in the file they must be op:// references, so
// the file itself holds nothing secret even if something reads it.
const SECRET_ENV_KEYS = new Set(['LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'OTEL_EXPORTER_OTLP_HEADERS'])
// A URL with userinfo or a query string can carry a credential too.
const URL_ENV_KEYS = new Set(['OTEL_EXPORTER_OTLP_TRACES_ENDPOINT', 'OTEL_EXPORTER_OTLP_ENDPOINT', 'LANGFUSE_BASE_URL', 'LANGFUSE_HOST'])

export function parseEnvFile(text: string): { env: TraceEnv; refs: Record<string, string>; literalSecrets: string[] } {
  const env: TraceEnv = {}
  const refs: Record<string, string> = {}
  const literalSecrets: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(raw)
    if (!match || !TRACE_ENV_KEYS.includes(match[1]!)) continue
    let value = match[2]!.trim()
    const quoted = /^(["'])(.*)\1$/.exec(value)
    if (quoted) value = quoted[2]!
    else value = value.replace(/\s+#.*$/, '')
    if (value === '' || /[`$]/.test(value)) continue
    if (/^op:\/\/.+/.test(value)) refs[match[1]!] = value
    else if (SECRET_ENV_KEYS.has(match[1]!)) literalSecrets.push(match[1]!)
    else if (URL_ENV_KEYS.has(match[1]!) && /^[a-z]+:\/\/[^/?#]*@|\?/i.test(value)) literalSecrets.push(match[1]!)
    else env[match[1]!] = value
  }
  return { env, refs, literalSecrets }
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function utf8(text: string): number[] {
  const out: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  return out
}

export function base64(text: string): string {
  const bytes = utf8(text)
  let out = ''
  for (let index = 0; index < bytes.length; index += 3) {
    const [a, b, c] = [bytes[index]!, bytes[index + 1], bytes[index + 2]]
    out += BASE64[a >> 2]! + BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)]!
    out += b === undefined ? '=' : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)]!
    out += c === undefined ? '=' : BASE64[c & 63]!
  }
  return out
}

/** `k=v,k2=v2`, values percent-decoded, as the OTel spec writes OTEL_EXPORTER_OTLP_HEADERS. */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const pair of (raw ?? '').split(',')) {
    const at = pair.indexOf('=')
    if (at <= 0) continue
    try {
      headers[pair.slice(0, at).trim()] = decodeURIComponent(pair.slice(at + 1).trim())
    } catch {
      headers[pair.slice(0, at).trim()] = pair.slice(at + 1).trim()
    }
  }
  return headers
}

/** Where traces go, or null when tracing is off or unconfigured. OTEL_* first, then LANGFUSE_*. */
export function traceConfig(env: TraceEnv): TraceConfig | null {
  if ((env.FOUNDRY_OTEL ?? '').toLowerCase() === 'off') return null
  const toolIo = ![env.FOUNDRY_OTEL_TOOL_IO, env.PALANTIR_AGENT_OTEL_TOOL_IO].some(value => (value ?? '').toLowerCase() === 'off')
  const exact = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  let url = exact || (base ? `${base.replace(/\/$/, '')}/v1/traces` : '')
  let headers = parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS)
  const langfuse = (env.LANGFUSE_BASE_URL || env.LANGFUSE_HOST)?.trim()
  if (url === '' && langfuse && env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY) {
    url = `${langfuse.replace(/\/$/, '')}/api/public/otel/v1/traces`
    headers = { Authorization: `Basic ${base64(`${env.LANGFUSE_PUBLIC_KEY}:${env.LANGFUSE_SECRET_KEY}`)}` }
  }
  if (!/^https?:\/\//.test(url)) return null
  const host = /^https?:\/\/([^/?#]+)/.exec(url)?.[1]?.replace(/^[^@]*@/, '') ?? ''
  return { url, headers: { ...headers, 'Content-Type': 'application/json' }, host, toolIo }
}

/** The OTel resource: service name and OTEL_RESOURCE_ATTRIBUTES (k=v,…), plus the mod's own. */
export function resourceAttributes(env: TraceEnv, profile: string | null): Record<string, string> {
  return {
    'service.name': env.OTEL_SERVICE_NAME?.trim() || 'claude-foundry',
    ...parseOtlpHeaders(env.OTEL_RESOURCE_ATTRIBUTES),
    'agent.harness': 'claude-code',
    ...(profile ? { 'palantir.agent.profile': profile } : {}),
  }
}

/** The Langfuse public API base for a trace URL that ends in /api/public/otel/v1/traces; null for other collectors. */
export function langfuseApiBase(config: TraceConfig): string | null {
  const match = /^(.*\/api\/public)\/otel\/v1\/traces\/?$/.exec(config.url)
  return match ? match[1]! : null
}

// Redaction: field names, then patterns, then URLs, before the 64 KiB cap,
// so a secret can never straddle the cut.
const FIELD_MAX_CHARS = 64 * 1024
const REDACTED = '[REDACTED]'
const SUBSTRING_KEY_TERMS = [
  'token', 'secret', 'password', 'apikey', 'api_key', 'api-key', 'authorization', 'bearer', 'cookie',
  'credential', 'privatekey', 'private_key', 'private-key', 'ssn', 'cardnumber', 'card_number', 'card-number',
  'rid', 'org', 'tenant', 'space', 'host', 'cluster', 'node', 'vmid', 'ctid', 'amount', 'balance', 'price',
]
const EXACT_KEY_TERMS = new Set(['name', 'address', 'street', 'city'])
const KEY_REDACTION_EXEMPT = new Set(['userid', 'user_id', 'sessionid', 'session_id'])

export function isSensitiveKey(key: string): boolean {
  const lowered = key.toLowerCase()
  if (KEY_REDACTION_EXEMPT.has(lowered)) return false
  return EXACT_KEY_TERMS.has(lowered) || SUBSTRING_KEY_TERMS.some(term => lowered.includes(term))
}

function redactUrls(value: string): string {
  return value.replace(/(?<![a-z0-9+.-])([a-z][a-z0-9+.-]{0,30}:\/\/)([^\s"')\]]+)/gi, (_whole, scheme: string, rest: string) => {
    let out = rest.replace(/^[^:@/?#]+(:[^@/?#]*)?@/, `${REDACTED}@`)
    out = out.replace(/\?[^#\s]*/, `?${REDACTED}`)
    out = out.replace(/(hooks\.slack\.com\/services\/)[^?\s]*/i, `$1${REDACTED}`)
    out = out.replace(/(\/)[A-Za-z0-9_-]{20,}(?=\/|$)/g, `$1${REDACTED}`)
    return scheme + out
  })
}

// Token prefixes match without a leading boundary: a token glued to other text still goes.
const REDACTION_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /sk-(proj|ant|svcacct)-[A-Za-z0-9_-]{20,}/g,
  /[sr]k_live_[A-Za-z0-9]{20,}\b/g,
  /github_pat_[A-Za-z0-9_]{22,}\b/g,
  /gh[pousr]_[A-Za-z0-9]{36,}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g,
  /A[KS]IA[0-9A-Z]{16}\b/g,
  /xox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /Bearer\s+[A-Za-z0-9._~+/-]+=*/gi,
  /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g,
  /\b\d{3}-\d{2}-\d{4}\b/g,
  /\b[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}[- ]?[0-9]{4}\b/g,
  /\b(?:10|100)\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
  /\b(?:172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
  /(?<![A-Za-z0-9.-])[A-Za-z0-9][A-Za-z0-9.-]{0,252}\.(?:local|internal|lan|corp)\b/gi,
  /\+?[0-9][0-9 .-]{7,}[0-9]/g,
  /\bBasic\s+[A-Za-z0-9+/=]{8,}\b/gi,
  /npm_[A-Za-z0-9]{30,}\b/g,
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{0,40}(password|passwd|pwd|token|secret|api[-_]?key|private[-_]?key|credential)[A-Za-z0-9_-]{0,40}["']?\s*[=:]\s*["']?[^\s&"',}]{4,}/gi,
  /\b(pk|sk)-lf-[A-Za-z0-9-]{6,}/g,
  /Authorization["']?\s*[=:]\s*["']?(Basic|Bearer)?(\s|%20)*[A-Za-z0-9._~+/=%-]{6,}/gi,
  /Basic%20[A-Za-z0-9+/=%]{8,}/gi,
  /(\s-u\s+|--user[=\s]+)\S+:\S+/g,
  /\bri\.[a-z0-9-]+\.[a-z0-9-]*\.[A-Za-z0-9._-]+/g,
]

const SECRET_FLAG = /^--?(password|passwd|token|secret|api-?key|key|auth|credential|private-key)$/i

/** An args array with the value after a secret-bearing flag (and --flag=value) redacted. */
export function redactArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg, index) => {
    if (typeof arg !== 'string') return arg
    const joined = /^(--?[A-Za-z-]+)=/.exec(arg)
    if (joined && SECRET_FLAG.test(joined[1]!)) return `${joined[1]}=${REDACTED}`
    const previous = args[index - 1]
    return typeof previous === 'string' && SECRET_FLAG.test(previous) ? REDACTED : arg
  })
}

/** Extra hostname suffixes to redact (FOUNDRY_OTEL_REDACT_DOMAINS, comma-separated). */
export function domainPatterns(raw: string | undefined): RegExp[] {
  return (raw ?? '')
    .split(',')
    .map(domain => domain.trim().replace(/^\.+/, ''))
    .filter(domain => /^[A-Za-z0-9.-]+$/.test(domain))
    .map(domain => new RegExp(`(?<![A-Za-z0-9.-])[A-Za-z0-9][A-Za-z0-9.-]{0,252}\\.${domain.replace(/\./g, '\\.')}\\b`, 'gi'))
}

export function redactString(value: string, extra: readonly RegExp[] = []): string {
  let out = redactUrls(value)
  for (const pattern of [...REDACTION_PATTERNS, ...extra]) out = out.replace(pattern, REDACTED)
  return out
}

const cap = (value: string) => (value.length > FIELD_MAX_CHARS ? `${value.slice(0, FIELD_MAX_CHARS)}[TRUNCATED]` : value)

/** Redacted, capped JSON for one attribute; undefined when the value cannot be serialized. */
export function serializePayload(value: unknown, extra: readonly RegExp[] = []): string | undefined {
  if (value === undefined || value === null) return undefined
  try {
    const json = JSON.stringify(value, (key, item: unknown) => {
      if (key && isSensitiveKey(key)) return REDACTED
      if (Array.isArray(item)) return redactArgs(item)
      if (typeof item !== 'string') return item
      // A JSON document carried as a string (an Orthanc envelope) is redacted by key too.
      if (/^\s*[[{]/.test(item)) {
        let parsed: unknown
        try {
          parsed = JSON.parse(item)
        } catch {}
        if (typeof parsed === 'object' && parsed !== null) {
          const nested = serializePayload(parsed, extra)
          try {
            return JSON.parse(nested ?? 'null')
          } catch {
            return nested
          }
        }
      }
      return redactString(item, extra)
    })
    return json === undefined ? undefined : cap(json)
  } catch {
    return undefined
  }
}

export type SpanRecord = {
  spanId: string
  parentSpanId?: string
  name: string
  startMs: number
  endMs: number
  attributes: Record<string, string | number | boolean | string[]>
  error?: string
}

export function randomHex(length: number): string {
  let out = ''
  while (out.length < length) out += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0')
  return out.slice(0, length)
}

function attributeValue(value: string | number | boolean | string[]) {
  if (Array.isArray(value)) return { arrayValue: { values: value.map(item => ({ stringValue: item })) } }
  if (typeof value === 'number') return Number.isInteger(value) ? { intValue: value } : { doubleValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  return { stringValue: value }
}

const attributes = (record: Record<string, string | number | boolean | string[]>) =>
  Object.entries(record).map(([key, value]) => ({ key, value: attributeValue(value) }))

const nanos = (ms: number) => `${Math.round(ms)}000000`

/** One trace as an OTLP/JSON ExportTraceServiceRequest body. */
export function otlpBody(traceId: string, resource: Record<string, string>, spans: readonly SpanRecord[]): string {
  return JSON.stringify({
    resourceSpans: [
      {
        resource: { attributes: attributes(resource) },
        scopeSpans: [
          {
            scope: { name: 'claude-foundry' },
            spans: spans.map(span => ({
              traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: 1,
              startTimeUnixNano: nanos(span.startMs),
              endTimeUnixNano: nanos(Math.max(span.endMs, span.startMs)),
              attributes: attributes(span.attributes),
              status: span.error ? { code: 2, message: span.error.slice(0, 500) } : { code: 1 },
            })),
          },
        ],
      },
    ],
  })
}
