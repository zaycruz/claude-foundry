// The `kind: local` commands of the orthanc this plugin is tied to, as a module.
//
// Generated from hooks/orthanc-snapshot.json — the plugin's pinned record of
// 0.7.11 (541 commands, 29 of them `local`). A test cannot open
// that JSON: a hooks module imports only its own files and "claude-code". So the
// pin's local surface is read out of it once, into this file, and the guard's
// read list is checked against what the plugin actually pins rather than against
// a list typed beside the test. Regenerate after an orthanc tie lands:
//
//   python3 -c "import json;d=json.load(open('hooks/orthanc-snapshot.json'));\
//     print('\n'.join(\"  '%s',\" % c['path'] for c in sorted(d['commands'],key=lambda c:c['path']) if c.get('kind')=='local'))"
//
// Pull request #18 adds hooks/orthanc-manifest.snapshot.ts — the whole surface of
// the checked orthanc, with `check` watching it — and replaces this file.

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

/** What the live binary's `agent-manifest` says `update` does, captured from
 * orthanc 0.7.11 (orthanc-x86_64-unknown-linux-gnu.tar.gz, sha256
 * d746a6bfa6837b93333bafc7439c790386971c6f9068c6d7b4b97ae3c99bbb31):
 * `mutation_risk: "replaces-binary"`, one of the two risks that release names
 * (the other is `solution-design delete`: "moves-a-resource-to-the-trash").
 * Not derived from the pin: the pin has no `mutation_risk` field at all, which is
 * why the guard's rule reads the command name as well as the field. */
export const UPDATE_MUTATION_RISK = 'replaces-binary'

/** The pinned entry of Orthanc's self-update: five fields per command
 * (`path`, `kind`, `auth`, `operator_approval`, `operator_approval_scope`), with
 * `update` a `mutation` and `auth: none`. That is why Bash already refused it,
 * and why the read fast path never saw it. */
export const UPDATE_ENTRY = {
  path: 'update',
  kind: 'mutation',
  auth: 'none',
} as const
