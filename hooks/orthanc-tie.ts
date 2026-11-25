// The plugin's tie to orthanc. A hooks module cannot read plugin.json, so the
// three constants below mirror it: `scripts/orthanc-tie.mjs refresh` writes
// both, and `scripts/orthanc-tie.mjs check` fails when they differ. Do not edit
// them by hand; docs/RELEASE.md says how a release moves them.
//
// Failure modes, written before the code:
//  V1  orthanc is older than MIN_ORTHANC: its manifest may lack markers or
//      scopes the guard relies on. Warn and name the update command; never
//      block a read (the guard asks more, never less, on a manifest it lacks).
//  V2  orthanc is newer than ORTHANC_CHECKED: its manifest may carry approval
//      shapes this guard cannot read. Warn and name the plugin update command;
//      the guard still asks on every shape it cannot read.
//  V3  the version cannot be read or parsed (no `orthanc version`, a nightly
//      name): say it cannot be compared, never throw, never block.
//  V4  the same warning repeats on every manifest read: shown once per text.
//  V5  the binary is swapped mid-session: the warning follows the new read.

/** The plugin version, as in .claude-plugin/plugin.json `version`. */
export const PLUGIN_VERSION = '0.7.4'
/** The oldest orthanc this plugin supports (plugin.json `min_orthanc`). */
export const MIN_ORTHANC = '0.7.8'
/** The orthanc the guard was last checked against (plugin.json `orthanc_checked`); hooks/orthanc-manifest.snapshot.ts is its manifest. */
export const ORTHANC_CHECKED = '0.7.14'

/** Every key of a manifest command entry this guard was checked against. A new
 * key (a new approval field, say) fails the snapshot test and
 * `scripts/orthanc-tie.mjs check` until someone reads it and adds it here. */
export const KNOWN_ENTRY_KEYS = ['args', 'auth', 'credential_store', 'description', 'effect', 'example', 'failure_state', 'help', 'hidden', 'input', 'kind', 'local_effect', 'mutation_risk', 'operator_approval', 'operator_approval_scope', 'path', 'requires', 'status']
/** Every key of an entry's `args` items, as above. */
export const KNOWN_ARG_KEYS = ['default', 'flag', 'help', 'hidden', 'kind', 'name', 'repeatable', 'required', 'short', 'takes_value', 'values']
/** Every command `kind`, as above. The guard reads only `read-only` (and a few `local` commands) as reads; anything else is a write. */
export const KNOWN_KINDS = ['local', 'mutation', 'read-only']

export const ORTHANC_UPDATE = 'orthanc update --apply'
export const PLUGIN_UPDATE = 'claude plugin marketplace update claude-foundry && claude plugin update foundry@claude-foundry'

type Version = { core: [number, number, number]; pre: boolean }

function parseVersion(text: string): Version | null {
  const found = /^v?(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.exec(text.trim())
  if (!found) return null
  return { core: [Number(found[1]), Number(found[2]), Number(found[3])], pre: found[4] !== undefined }
}

/** Negative when a < b. A prerelease sorts before its release. */
function compare(a: Version, b: Version): number {
  for (let index = 0; index < 3; index += 1) {
    const diff = a.core[index]! - b.core[index]!
    if (diff !== 0) return diff
  }
  return Number(b.pre) - Number(a.pre)
}

export type Tie = { plugin: string; min: string; checked: string }
export const TIE: Tie = { plugin: PLUGIN_VERSION, min: MIN_ORTHANC, checked: ORTHANC_CHECKED }

/** The one-line warning for the installed orthanc, or null when it is within
 * [min, checked]. Never throws. */
export function orthancVersionWarning(installed: string | null, tie: Tie = TIE): string | null {
  const range = `${tie.min} to ${tie.checked}`
  const raw = installed?.trim() ?? ''
  const version = raw === '' ? null : parseVersion(raw)
  const min = parseVersion(tie.min)
  const checked = parseVersion(tie.checked)
  if (version === null || min === null || checked === null) {
    return (
      `foundry ${tie.plugin}: cannot compare orthanc ${raw === '' ? '(no version read)' : JSON.stringify(raw.slice(0, 40))} with ${range}, ` +
      `the orthanc range this plugin supports. Reads still run; writes the manifest marks for approval still ask. Run: orthanc version`
    )
  }
  if (compare(version, min) < 0) {
    return (
      `foundry ${tie.plugin}: orthanc ${raw} is older than ${tie.min}, the oldest orthanc this plugin supports. ` +
      `Reads still run; the guard can only read the approval markers this orthanc's manifest carries. Run: ${ORTHANC_UPDATE}`
    )
  }
  if (compare(version, checked) > 0) {
    return (
      `foundry ${tie.plugin}: orthanc ${raw} is newer than ${tie.checked}, the orthanc this plugin's guard was last checked against. ` +
      `Reads still run; an approval shape the guard cannot read asks on every call. Run: ${PLUGIN_UPDATE}`
    )
  }
  return null
}
