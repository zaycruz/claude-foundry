// The `kind: local` commands of the orthanc this plugin is tied to, as a module.
//
// Generated from hooks/orthanc-snapshot.json (v0.7.11, 0.7.11,
// 541 commands) — a test cannot open that file, because a hooks
// module imports only its own files and "claude-code". So the pin's local
// surface is read out of it once, into this file, and the guard's read list is
// checked against what the plugin actually pins rather than against a list typed
// beside the test. Regenerate after an orthanc tie lands:
//
//   python3 -c "import json;d=json.load(open('hooks/orthanc-snapshot.json'));\
//     print('\n'.join(\"  '%s',\" % c['path'] for c in sorted(d['commands'],key=lambda c:c['path']) if c.get('kind')=='local'))"
//   # then update ORTHANC_TAG and the count in the line below.
//
// Pull request #18 adds hooks/orthanc-manifest.snapshot.ts, the whole surface of
// the checked orthanc with `check` watching it; that module replaces this one.

/** The tag this list was read from. */
export const ORTHANC_TAG = 'v0.7.11'

/** Every `kind: local` command of 0.7.11: 29 of them. */
export const LOCAL_COMMANDS: readonly string[] = [
  'agent-manifest',
  'alias add',
  'alias clear',
  'alias edit',
  'alias export',
  'alias import',
  'alias list',
  'alias remove',
  'alias resolve',
  'alias show',
  'auth delete',
  'auth store',
  'capabilities',
  'completion install',
  'completion show',
  'configure configure',
  'configure delete',
  'configure list',
  'configure profile create',
  'configure profile set',
  'configure set-default',
  'configure use',
  'hello',
  'onboarding',
  'shell',
  'shell interactive',
  'shell start',
  'smoke schedule',
  'version',
]

/** The pinned entry of Orthanc's self-update: `mutation_risk` is the field the
 * guard reads, and `kind: mutation` is why Bash already refused the command. */
export const UPDATE_ENTRY = {
"path": "update",
"kind": "mutation",
"auth": "none"
} as const
