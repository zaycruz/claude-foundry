// Two binary captures the plugin's own pin cannot hold, for the self-update
// guard's tests.
//
// The `kind: local` surface used to live here as a hand-copied list of the pin's
// local commands. It moved to hooks/self-update.test.ts, which now derives it
// from hooks/orthanc-manifest.snapshot.ts (the pin `refresh` writes and `check`
// watches), so a tie carries its local surface with it. An orthanc tie left the
// typed list behind once: v0.7.13 added `auth mint` and the list stayed at 29
// while the pin moved to 30.

/** What the live binary's `agent-manifest` says `update` does, captured from
 * orthanc 0.7.11 (orthanc-x86_64-unknown-linux-gnu.tar.gz, sha256
 * d746a6bfa6837b93333bafc7439c790386971c6f9068c6d7b4b97ae3c99bbb31):
 * `mutation_risk: "replaces-binary"`, one of the two risks that release names
 * (the other is `solution-design delete`: "moves-a-resource-to-the-trash").
 * Not derived from the pin: the pin has no `mutation_risk` field at all, which is
 * why the guard's rule reads the command name as well as the field. */
export const UPDATE_MUTATION_RISK = 'replaces-binary'

/** The pinned entry of Orthanc's self-update. The pin records at most five fields
 * per command (`path`, `kind`, `auth`, `operator_approval`,
 * `operator_approval_scope`; `update` carries three of them), and here they say
 * `kind: mutation`, `auth: none`, no `operator_approval`. That is why Bash already
 * refused the command, and why the read fast path never saw it. */
export const UPDATE_ENTRY = {
  path: 'update',
  kind: 'mutation',
  auth: 'none',
} as const
