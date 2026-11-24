#!/usr/bin/env node
// The plugin's tie to orthanc: one script for the orthanc release job and the
// operator. Node 18+ and nothing else (no TypeScript, no network).
//
//   node scripts/orthanc-tie.mjs check
//       Fails (exit 1) when plugin.json, marketplace.json, hooks/orthanc-tie.ts,
//       hooks/orthanc-manifest.snapshot.ts and hooks/orthanc-snapshot.json
//       disagree, or when the snapshot
//       holds a field or an approval shape the guard does not know.
//   node scripts/orthanc-tie.mjs refresh --manifest <file> --orthanc-version <v>
//                                [--plugin-version <v>] [--min-orthanc <v>]
//       Writes the trimmed snapshot from an `orthanc --agent agent-manifest`
//       output file, moves orthanc_checked (and the plugin version and
//       min_orthanc when given) in all four files, prints what changed in the
//       approval markers, then runs check. The release job dumps the manifest
//       with the new orthanc and passes the file; nothing here runs orthanc.
//
// Failure modes, written before the code:
//  T1  The four files drift apart (a hand edit, a half-applied bump): check
//      names each pair that differs.
//  T2  A new approval shape, a marker with no scope or a scope with no marker:
//      check fails and names the command. The guard itself asks on such a
//      shape (never allows); the failure is so a person reads it.
//  T3  A new entry or arg key or command kind: check fails until it is read and
//      added to the KNOWN_* lists in hooks/orthanc-tie.ts.
//  T4  The snapshot carries stack data: only path, kind, auth, input, the two
//      approval keys and, on marked entries, each flag's name, takes_value and
//      default are kept; check refuses an email, a full RID or a URL in it.
//  T5  The manifest file is not an agent-manifest envelope, or the version is
//      not x.y.z: refresh refuses and writes nothing.
//  T6  min_orthanc newer than orthanc_checked: check fails.
//  T7  The output is not stable (key order, command order): refresh sorts, so
//      the same manifest gives the same bytes and a rerun shows no diff.
//  T8  hooks/orthanc-snapshot.json (written by the orthanc release job) and
//      the guard's snapshot disagree on the orthanc or on any marker: check
//      fails and names the command. The release job's own pull request is in
//      this state until refresh finishes it (docs/RELEASE.md); check says so.
//  T9  refresh and the release job write hooks/orthanc-snapshot.json
//      differently: refresh writes the job's format byte for byte, and on the
//      job's branch (same orthanc_tag) it never rewrites the job's file; a
//      manifest that does not match it is refused (exit 2), nothing written.
//  T10 the two min_orthanc fields are confused: the job's file names the tag
//      it follows (min_orthanc = orthanc_tag), plugin.json names the oldest
//      orthanc the hooks support; check fails unless the job's equals its tag
//      and is not older than plugin.json's.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILES = {
  plugin: '.claude-plugin/plugin.json',
  marketplace: '.claude-plugin/marketplace.json',
  tie: 'hooks/orthanc-tie.ts',
  snapshot: 'hooks/orthanc-manifest.snapshot.ts',
  releaseJob: 'hooks/orthanc-snapshot.json',
}
const read = file => readFileSync(join(ROOT, file), 'utf8')
const write = (file, text) => writeFileSync(join(ROOT, file), text)
const VERSION = /^\d+\.\d+\.\d+$/

function tieConstants(text = read(FILES.tie)) {
  const string = name => new RegExp(`^export const ${name} = '([^']*)'`, 'm').exec(text)?.[1]
  const list = name => {
    const found = new RegExp(`^export const ${name} = \\[([^\\]]*)\\]`, 'm').exec(text)?.[1]
    return found === undefined ? undefined : [...found.matchAll(/'([^']*)'/g)].map(match => match[1])
  }
  return {
    plugin: string('PLUGIN_VERSION'),
    min: string('MIN_ORTHANC'),
    checked: string('ORTHANC_CHECKED'),
    entryKeys: list('KNOWN_ENTRY_KEYS'),
    argKeys: list('KNOWN_ARG_KEYS'),
    kinds: list('KNOWN_KINDS'),
  }
}

function snapshotData(text = read(FILES.snapshot)) {
  const start = text.indexOf('/* BEGIN SNAPSHOT */')
  const end = text.indexOf('/* END SNAPSHOT */')
  if (start < 0 || end < 0) throw new Error(`${FILES.snapshot}: no SNAPSHOT block`)
  return JSON.parse(text.slice(start + '/* BEGIN SNAPSHOT */'.length, end))
}

// The guard's readers (hooks/policy.ts readApprovalCondition, readApprovalScope),
// restated for a runtime without TypeScript. The plugin test
// orthanc-snapshot.test.ts runs the guard's own readers on the same snapshot.
const APPROVAL_FLAG = /^--?[a-z0-9][a-z0-9-]*$/i
const SCOPE_FLAG = /^--[a-z0-9][a-z0-9-]*$/
const isObject = value => typeof value === 'object' && value !== null && !Array.isArray(value)
function conditionReadable(value) {
  if (value === 'always') return true
  return (
    isObject(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray(value.when_all_flags) &&
    value.when_all_flags.length > 0 &&
    value.when_all_flags.every(flag => typeof flag === 'string' && APPROVAL_FLAG.test(flag))
  )
}
function scopeReadable(scope) {
  if (scope === 'always' || scope === 'work-branch') return true
  if (!isObject(scope)) return false
  if (!Object.keys(scope).every(key => key === 'work_branch_flag' || key === 'flag_aliases')) return false
  const aliases = scope.flag_aliases ?? []
  return (
    typeof scope.work_branch_flag === 'string' &&
    SCOPE_FLAG.test(scope.work_branch_flag) &&
    Array.isArray(aliases) &&
    aliases.every(alias => typeof alias === 'string' && SCOPE_FLAG.test(alias))
  )
}

const STACK_DATA = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'an email'],
  [/ri\.[a-z0-9-]+\.[a-z0-9-]*\.[a-z0-9-]+\.[0-9a-f]{8}-[0-9a-f-]{27}/i, 'a full RID'],
  [/https?:\/\//, 'a URL'],
]

export function check() {
  const problems = []
  const plugin = JSON.parse(read(FILES.plugin))
  const marketplace = JSON.parse(read(FILES.marketplace))
  const listed = marketplace.plugins?.find(entry => entry.name === plugin.name)
  const tie = tieConstants()
  let snap = null
  try {
    snap = snapshotData()
  } catch (error) {
    problems.push(String(error.message ?? error))
  }
  const same = (what, a, b) => {
    if (a !== b) problems.push(`${what}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`)
  }
  same(`${FILES.plugin} version vs ${FILES.marketplace} version`, plugin.version, listed?.version)
  same(`${FILES.plugin} version vs ${FILES.tie} PLUGIN_VERSION`, plugin.version, tie.plugin)
  same(`${FILES.plugin} min_orthanc vs ${FILES.tie} MIN_ORTHANC`, plugin.min_orthanc, tie.min)
  same(`${FILES.plugin} orthanc_checked vs ${FILES.tie} ORTHANC_CHECKED`, plugin.orthanc_checked, tie.checked)
  if (snap) same(`${FILES.tie} ORTHANC_CHECKED vs ${FILES.snapshot} orthanc_version`, tie.checked, snap.orthanc_version)
  for (const [name, value] of [['version', plugin.version], ['min_orthanc', plugin.min_orthanc], ['orthanc_checked', plugin.orthanc_checked]]) {
    if (typeof value !== 'string' || !VERSION.test(value)) problems.push(`${FILES.plugin} ${name} is not x.y.z: ${JSON.stringify(value)}`)
  }
  const num = value => (typeof value === 'string' ? value.split('.').map(Number) : [0, 0, 0])
  const [a, b] = [num(plugin.min_orthanc), num(plugin.orthanc_checked)]
  if (a[0] * 1e6 + a[1] * 1e3 + a[2] > b[0] * 1e6 + b[1] * 1e3 + b[2]) problems.push(`min_orthanc ${plugin.min_orthanc} is newer than orthanc_checked ${plugin.orthanc_checked}`)
  if (!tie.entryKeys || !tie.argKeys || !tie.kinds) problems.push(`${FILES.tie}: KNOWN_ENTRY_KEYS, KNOWN_ARG_KEYS or KNOWN_KINDS not found`)
  if (snap && tie.entryKeys && tie.argKeys && tie.kinds) {
    for (const key of snap.entry_keys) if (!tie.entryKeys.includes(key)) problems.push(`manifest entry key '${key}' is not one the guard was checked against (KNOWN_ENTRY_KEYS)`)
    for (const key of snap.arg_keys) if (!tie.argKeys.includes(key)) problems.push(`manifest arg key '${key}' is not one the guard was checked against (KNOWN_ARG_KEYS)`)
    for (const entry of snap.commands) {
      if (!tie.kinds.includes(entry.kind)) problems.push(`'${entry.path}': kind ${JSON.stringify(entry.kind)} is not one the guard was checked against (KNOWN_KINDS)`)
      const marked = 'operator_approval' in entry
      const scoped = 'operator_approval_scope' in entry
      if (marked !== scoped) problems.push(`'${entry.path}': operator_approval and operator_approval_scope must come together (orthanc OA5)`)
      if (marked && !conditionReadable(entry.operator_approval)) problems.push(`'${entry.path}': operator_approval ${JSON.stringify(entry.operator_approval)} is a shape the guard cannot read`)
      if (scoped && !scopeReadable(entry.operator_approval_scope)) problems.push(`'${entry.path}': operator_approval_scope ${JSON.stringify(entry.operator_approval_scope)} is a shape the guard cannot read`)
    }
    const text = read(FILES.snapshot)
    for (const [pattern, what] of STACK_DATA) if (pattern.test(text)) problems.push(`${FILES.snapshot} holds ${what}: ${pattern.exec(text)[0].slice(0, 12)}…`)
  }
  // T8: the orthanc release job's own snapshot (orthanc-source
  // scripts/release/plugin_release.py) must be of the same orthanc and carry
  // the same markers, so the two can never tell different stories.
  let job = null
  try {
    job = JSON.parse(read(FILES.releaseJob))
  } catch (error) {
    if (error.code !== 'ENOENT') problems.push(`${FILES.releaseJob}: ${error.message}`)
  }
  if (job) {
    same(`${FILES.releaseJob} min_orthanc vs its orthanc_tag (T10)`, `v${job.min_orthanc}`, job.orthanc_tag)
    const [j, p] = [num(job.min_orthanc), num(plugin.min_orthanc)]
    if (j[0] * 1e6 + j[1] * 1e3 + j[2] < p[0] * 1e6 + p[1] * 1e3 + p[2]) problems.push(`${FILES.releaseJob} min_orthanc ${job.min_orthanc} is older than ${FILES.plugin} min_orthanc ${plugin.min_orthanc} (T10)`)
  }
  if (job && snap) {
    if (job.orthanc_tag !== `v${tie.checked}`) {
      problems.push(
        `${FILES.releaseJob} is for orthanc ${job.orthanc_tag}, the guard was checked against v${tie.checked}. ` +
          `If this is the orthanc release job's pull request, finish it: node scripts/orthanc-tie.mjs refresh --manifest <agent-manifest of ${job.orthanc_tag}> --orthanc-version ${String(job.orthanc_tag).replace(/^v/, '')} (docs/RELEASE.md)`,
      )
    }
    const jobMarkers = markers(job)
    const ours = markers(snap)
    for (const [path, shape] of jobMarkers) if (ours.get(path) !== shape) problems.push(`'${path}': ${FILES.releaseJob} has ${shape}, ${FILES.snapshot} has ${ours.get(path) ?? 'no marker'}`)
    for (const path of ours.keys()) if (!jobMarkers.has(path)) problems.push(`'${path}': marked in ${FILES.snapshot}, not in ${FILES.releaseJob}`)
  }
  return problems
}

// Kept in the pin even without an approval key, because a flag of theirs is what
// makes the call a write, and LW8 fails when a rename or a takes_value change
// would leave the guard under-reading.
//
// `hooks/policy.ts` LOCAL_WRITE_COMMANDS carries a third, `smoke`, and it is not
// listed here. That is a gap, not a decision that closed one: `smoke`'s rule
// reads its flag from the call's argv, so nothing here pins the two flag names
// orthanc ships for it, and a rename of `--schedule` would leave the guard
// reading the install as a plain read (the old spelling then dies at pflag as an
// undeclared flag; the new one would not be seen at all). hooks/
// smoke-schedule.test.ts SS8 pins that the pin carries no `args` for `smoke`, so
// joining the two lists is a deliberate act. It needs `refresh`, which rewrites
// the pin for a whole orthanc release: that is the v0.7.13 tie in PR #41, and
// this file is one of the five it moves.
const LOCAL_WRITE_PIN = ['dev-console sdk install', 'repository clone']

const sortKeys = value =>
  Array.isArray(value) ? value.map(sortKeys) : isObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value

/** The trimmed snapshot of one agent-manifest envelope (T4, T7). */
export function trim(envelope, orthancVersion) {
  const data = envelope?.data
  if (envelope?.schema_version !== 'foundry-agent-v1' || !isObject(data) || !Array.isArray(data.commands) || data.commands.length === 0) {
    throw new Error('not an agent-manifest envelope with commands (orthanc --agent --non-interactive agent-manifest)')
  }
  const entryKeys = new Set()
  const argKeys = new Set()
  const commands = data.commands
    .filter(entry => isObject(entry) && typeof entry.path === 'string')
    .map(entry => {
      for (const key of Object.keys(entry)) entryKeys.add(key)
      for (const arg of Array.isArray(entry.args) ? entry.args : []) if (isObject(arg)) for (const key of Object.keys(arg)) argKeys.add(key)
      const kept = { path: entry.path, kind: entry.kind }
      for (const key of ['auth', 'input']) if (typeof entry[key] === 'string') kept[key] = entry[key]
      // Two entries the guard judges by a flag, not by an approval key: their
      // flags decide a write (hooks/policy.ts LOCAL_WRITE_COMMANDS), so the pin
      // carries them and hooks/local-write.test.ts LW8 fails when a rename or a
      // takes_value change would leave the guard under-reading.
      const judgedByFlag = LOCAL_WRITE_PIN.includes(entry.path)
      if ('operator_approval' in entry || 'operator_approval_scope' in entry || judgedByFlag) {
        kept.args = (Array.isArray(entry.args) ? entry.args : [])
          .filter(arg => isObject(arg) && typeof arg.flag === 'string')
          .map(arg => ({ flag: arg.flag, takes_value: arg.takes_value === true, ...(typeof arg.default === 'string' ? { default: arg.default } : {}) }))
        if ('operator_approval' in entry) kept.operator_approval = entry.operator_approval
        if ('operator_approval_scope' in entry) kept.operator_approval_scope = entry.operator_approval_scope
      }
      return sortKeys(kept)
    })
    .sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0))
  return { orthanc_version: orthancVersion, schema_version: data.schema_version ?? null, entry_keys: [...entryKeys].sort(), arg_keys: [...argKeys].sort(), commands }
}

export function render(snap) {
  const lines = [
    '{',
    `  "orthanc_version": ${JSON.stringify(snap.orthanc_version)},`,
    `  "schema_version": ${JSON.stringify(snap.schema_version)},`,
    `  "entry_keys": ${JSON.stringify(snap.entry_keys)},`,
    `  "arg_keys": ${JSON.stringify(snap.arg_keys)},`,
    '  "commands": [',
    snap.commands.map(entry => `    ${JSON.stringify(entry)}`).join(',\n'),
    '  ]',
    '}',
  ]
  return [
    '// The orthanc agent manifest this guard was last checked against, trimmed.',
    '// Generated by `node scripts/orthanc-tie.mjs refresh`; do not edit by hand.',
    '// Kept: path, kind, auth, input, operator_approval, operator_approval_scope and,',
    '// on entries that carry an approval key or a flag the guard judges a write by',
    '// (`repository clone`, `dev-console sdk install`), each flag (name, takes_value, default).',
    '// Dropped: descriptions, help, examples, positionals and the environment block,',
    '// so it carries no stack data. entry_keys and arg_keys are every key the full',
    '// manifest had, so a new field shows up here.',
    '// prettier-ignore',
    `export const SNAPSHOT = /* BEGIN SNAPSHOT */ ${lines.join('\n')} /* END SNAPSHOT */`,
    '',
  ].join('\n')
}

/** hooks/orthanc-snapshot.json as orthanc-source scripts/release/plugin_release.py
 * writes it (projection + snapshot_text): Python json.dumps(indent=2,
 * sort_keys=True) plus a newline (T9). */
const JOB_FIELDS = ['kind', 'auth', 'operator_approval', 'operator_approval_scope']
export function jobSnapshotText(envelope, orthancVersion) {
  const commands = (envelope?.data?.commands ?? []).map(entry => {
    const kept = { path: entry.path }
    for (const field of JOB_FIELDS) if (field in entry) kept[field] = entry[field]
    return kept
  })
  commands.sort((a, b) => (String(a.path) < String(b.path) ? -1 : String(a.path) > String(b.path) ? 1 : 0))
  const document = { min_orthanc: orthancVersion, orthanc_tag: `v${orthancVersion}`, snapshot_version: 1, commands }
  return `${JSON.stringify(sortKeys(document), null, 2)}\n`
}

const markers = snap => new Map((snap?.commands ?? []).filter(entry => 'operator_approval' in entry || 'operator_approval_scope' in entry).map(entry => [entry.path, JSON.stringify([entry.operator_approval, entry.operator_approval_scope])]))

function refresh(options) {
  const version = options['orthanc-version']
  if (!options.manifest || !version) throw new Error('refresh needs --manifest <file> and --orthanc-version <x.y.z>')
  for (const [name, value] of [['--orthanc-version', version], ['--plugin-version', options['plugin-version']], ['--min-orthanc', options['min-orthanc']]]) {
    if (value !== undefined && !VERSION.test(value)) throw new Error(`${name} is not x.y.z: ${value}`)
  }
  const envelope = JSON.parse(readFileSync(options.manifest, 'utf8'))
  const fresh = trim(envelope, version)
  // T9: on the release job's branch its file is the job's; check it, never rewrite it.
  const jobText = jobSnapshotText(envelope, version)
  let jobOld = null
  try {
    jobOld = JSON.parse(read(FILES.releaseJob))
  } catch {
    jobOld = null
  }
  const jobOwned = jobOld?.orthanc_tag === `v${version}`
  if (jobOwned && JSON.stringify(sortKeys(jobOld.commands)) !== JSON.stringify(JSON.parse(jobText).commands)) {
    throw new Error(`${FILES.releaseJob} is the release job's snapshot of v${version}, and --manifest is not that manifest; nothing written`)
  }
  let old = null
  try {
    old = snapshotData()
  } catch {
    old = null
  }
  const plugin = JSON.parse(read(FILES.plugin))
  const pluginVersion = options['plugin-version'] ?? plugin.version
  const min = options['min-orthanc'] ?? plugin.min_orthanc
  // Everything is computed before the first write (T5).
  const snapshotText = render(fresh)
  // Text edits, so the files keep their layout and a bump PR is a few lines.
  const setKey = (text, key, value, after) => {
    const present = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`)
    if (present.test(text)) return text.replace(present, `$1"${value}"`)
    const anchor = new RegExp(`^(\\s*)("${after}"\\s*:\\s*"[^"]*",?)$`, 'm')
    if (!anchor.test(text)) throw new Error(`cannot place "${key}" after "${after}"`)
    return text.replace(anchor, (_line, indent, rest) => `${indent}${rest.endsWith(',') ? rest : `${rest},`}\n${indent}"${key}": "${value}"${rest.endsWith(',') ? ',' : ''}`)
  }
  let pluginText = read(FILES.plugin)
  pluginText = setKey(pluginText, 'version', pluginVersion, 'name')
  pluginText = setKey(pluginText, 'min_orthanc', min, 'version')
  pluginText = setKey(pluginText, 'orthanc_checked', version, 'min_orthanc')
  const pluginParsed = JSON.parse(pluginText)
  if (pluginParsed.version !== pluginVersion || pluginParsed.min_orthanc !== min || pluginParsed.orthanc_checked !== version) throw new Error(`${FILES.plugin}: the edit did not take`)
  const entryPattern = new RegExp(`(\\{[^{}]*"name"\\s*:\\s*"${plugin.name}"[^{}]*"version"\\s*:\\s*)"[^"]*"`)
  const marketplaceText = read(FILES.marketplace).replace(entryPattern, `$1"${pluginVersion}"`)
  if (JSON.parse(marketplaceText).plugins?.find(entry => entry.name === plugin.name)?.version !== pluginVersion) throw new Error(`${FILES.marketplace}: the edit did not take`)
  let tie = read(FILES.tie)
  for (const [name, value] of [['PLUGIN_VERSION', pluginVersion], ['MIN_ORTHANC', min], ['ORTHANC_CHECKED', version]]) {
    const pattern = new RegExp(`^(export const ${name} = )'[^']*'`, 'm')
    if (!pattern.test(tie)) throw new Error(`${FILES.tie}: ${name} not found`)
    tie = tie.replace(pattern, `$1'${value}'`)
  }
  write(FILES.snapshot, snapshotText)
  if (!jobOwned) write(FILES.releaseJob, jobText)
  write(FILES.plugin, pluginText)
  write(FILES.marketplace, marketplaceText)
  write(FILES.tie, tie)

  const before = markers(old)
  const after = markers(fresh)
  const report = [`orthanc ${old?.orthanc_version ?? '(none)'} -> ${version}; plugin ${plugin.version} -> ${pluginVersion}; min_orthanc ${plugin.min_orthanc ?? '(none)'} -> ${min}`]
  report.push(`commands: ${old?.commands.length ?? 0} -> ${fresh.commands.length}; approval markers: ${before.size} -> ${after.size}`)
  report.push(jobOwned ? `${FILES.releaseJob}: the release job's, for v${version}; matches the manifest, left as it is` : `${FILES.releaseJob}: written for v${version}`)
  for (const [path, shape] of after) if (!before.has(path)) report.push(`  + ${path} ${shape}`)
  for (const [path, shape] of before) if (!after.has(path)) report.push(`  - ${path} ${shape}`)
  for (const [path, shape] of after) if (before.has(path) && before.get(path) !== shape) report.push(`  ~ ${path} ${before.get(path)} -> ${shape}`)
  const newKeys = fresh.entry_keys.filter(key => !(old?.entry_keys ?? []).includes(key))
  if (newKeys.length > 0) report.push(`new entry keys: ${newKeys.join(', ')}`)
  if (old && before.size === after.size && report.length === 3 && JSON.stringify(old.commands) === JSON.stringify(fresh.commands)) report.push('manifest unchanged apart from the version')
  return report
}

function parseOptions(argv) {
  const options = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) throw new Error(`unexpected argument: ${arg}`)
    const [name, inline] = arg.slice(2).split('=', 2)
    options[name] = inline ?? argv[++index]
  }
  return options
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, ...rest] = process.argv.slice(2)
  try {
    if (command === 'refresh') {
      for (const line of refresh(parseOptions(rest))) console.log(line)
    } else if (command !== 'check') {
      throw new Error('usage: orthanc-tie.mjs check | refresh --manifest <file> --orthanc-version <v> [--plugin-version <v>] [--min-orthanc <v>]')
    }
    const problems = check()
    for (const problem of problems) console.log(`FAIL ${problem}`)
    if (problems.length > 0) process.exit(1)
    console.log('orthanc tie: ok')
  } catch (error) {
    console.error(`orthanc-tie: ${error.message ?? error}`)
    process.exit(2)
  }
}
