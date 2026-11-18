// End to end on zap: the real Orthanc, its real agent-manifest, and the plugin's
// own policy code (manifestFrom, classifyCall, ladderDecision), in yolo.
//
//   bun scripts/approval-zap-e2e.ts [out.json]        (default live-out/approval-zap-transcript.json)
//
// For each call the ladder decides. A call that must ask is NOT run (the operator
// is taken to have declined): the transcript shows it stopped. A call that must not
// ask is run on zap, and Orthanc's real answer is recorded. Applied writes never
// reach zap from here. Placeholder RIDs only; zap answers them with not-found, which
// is a real answer from the real stack and proves the call went out.
import { mkdirSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { manifestFrom } from '../hooks/orthanc'
import { classifyCall, ladderDecision } from '../hooks/policy'

const PROFILE = process.env.ZAP_PROFILE ?? 'zap'
const BIN = process.env.ORTHANC_BIN ?? 'orthanc'
const SOURCE = 'ri.magritte..source.00000000-0000-4000-8000-000000000000'
const FOLDER = 'ri.compass.main.folder.00000000-0000-4000-8000-000000000000'

const orthanc = (...args: string[]) => spawnSync(BIN, ['--agent', '--non-interactive', '--profile', PROFILE, ...args], { encoding: 'utf8' })
const manifestRun = orthanc('agent-manifest')
if (manifestRun.status !== 0) throw new Error(`agent-manifest failed: ${manifestRun.stderr.slice(0, 300)}`)
const manifest = manifestFrom(JSON.parse(manifestRun.stdout))
const version = (spawnSync(BIN, ['--version'], { encoding: 'utf8' }).stdout ?? '').trim()

// [command, args, must ask in yolo]
const CASES: [string, string[], boolean][] = [
  ['connectivity source secret set', [SOURCE, 'api-key', '--apply'], true],
  ['connectivity webhook create', ['--source-rid', SOURCE, 'notify', '--apply'], true],
  ['connectivity webhook update', ['--source-rid', SOURCE, 'notify', '--apply'], true],
  ['connectivity egress ensure', [SOURCE, '--apply'], true],
  ['connectivity rest-source create', ['--name', 'orders-api', '--apply'], true],
  ['dev-console scope add', ['app-1', '--scope', 'api:read', '--apply'], true],
  ['admin group create', ['analysts', '--apply'], true],
  ['project add-orgs', [FOLDER, '--apply'], true],
  ['resource add-markings', [FOLDER, '--apply'], true],
  ['resource-role grant', [FOLDER, '--apply'], true],
  ['connectivity webhook list', ['--source-rid', SOURCE], false],
  ['connectivity webhook create', ['--source-rid', SOURCE, 'notify'], false],
  ['connectivity source secret set', [SOURCE, 'api-key'], false],
]

const rows = CASES.map(([command, args, mustAsk]) => {
  const classification = classifyCall('mcp__foundry__orthanc_cli', { command, args }, manifest, null)
  const decision = classification === null ? { outcome: 'run' as const, reason: 'a read: outside the ladder' } : ladderDecision('yolo', classification)
  const asked = decision.outcome === 'ask'
  const row: Record<string, unknown> = {
    mode: 'yolo',
    command: [command, ...args].join(' '),
    approvalClass: classification?.approval ?? null,
    ladder: decision.outcome,
    expected: mustAsk ? 'ask' : 'run',
    ok: asked === mustAsk,
  }
  if (asked) {
    row.operatorAnswer = 'declined'
    row.sentToZap = false
  } else {
    // Run on zap. A plan of a write sends no --apply, so it changes nothing there.
    const out = orthanc(...command.split(" "), ...args)
    let envelope: { errors?: unknown; data?: unknown } = {}
    try {
      envelope = JSON.parse(out.stdout)
    } catch {
      /* not JSON: kept as text below */
    }
    row.sentToZap = true
    row.exitCode = out.status
    row.zapErrors = envelope.errors ?? out.stderr.slice(0, 300)
  }
  return row
})

const out = process.argv[2] ?? 'live-out/approval-zap-transcript.json'
mkdirSync(out.includes('/') ? out.slice(0, out.lastIndexOf('/')) : '.', { recursive: true })
writeFileSync(out, `${JSON.stringify({ test: 'approval-class on zap', profile: PROFILE, orthanc: version, manifestCommands: manifest.length, rows }, null, 2)}\n`)
console.log(`wrote ${out}: ${rows.filter(row => row.ok).length}/${rows.length} as expected`)
process.exit(rows.every(row => row.ok) ? 0 : 1)
