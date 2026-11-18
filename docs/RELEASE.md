# Releasing the plugin with orthanc

Each orthanc release opens one pull request here. The pull request moves the
plugin to that orthanc. The operator reviews it, merges it and tags the plugin.
Orthanc never merges or tags here.

## What ties the plugin to orthanc

| Where | Field | Meaning |
| --- | --- | --- |
| `.claude-plugin/plugin.json` | `version` | the plugin version |
| `.claude-plugin/plugin.json` | `min_orthanc` | the oldest orthanc this plugin supports |
| `.claude-plugin/plugin.json` | `orthanc_checked` | the orthanc whose manifest the guard was last checked against |
| `.claude-plugin/marketplace.json` | `plugins[foundry].version` | the same as `version` |
| `hooks/orthanc-tie.ts` | `PLUGIN_VERSION`, `MIN_ORTHANC`, `ORTHANC_CHECKED` | the same three values, for the hooks (a hooks module cannot read JSON) |
| `hooks/orthanc-tie.ts` | `KNOWN_ENTRY_KEYS`, `KNOWN_ARG_KEYS`, `KNOWN_KINDS` | every manifest field the guard was checked against |
| `hooks/orthanc-manifest.snapshot.ts` | `orthanc_version`, `commands` | the trimmed `orthanc agent-manifest` of `orthanc_checked` |

`node scripts/orthanc-tie.mjs refresh` writes all of them. Do not edit them by
hand. `node scripts/orthanc-tie.mjs check` fails when they disagree.

The snapshot keeps only `path`, `kind`, `auth`, `input`, the two approval keys
and, on entries that carry an approval key, each flag's name, `takes_value` and
`default`. It drops descriptions, help, examples, positionals and the
environment block. So it holds no stack data. `check` refuses an email, a full
RID or a URL in it.

When orthanc is older than `min_orthanc` or newer than `orthanc_checked`, the
first manifest read of a session shows one line in the transcript and a toast,
and names the command to run:

- older: `orthanc update --apply`
- newer: `claude plugin marketplace update claude-foundry && claude plugin update foundry@claude-foundry`
- a version it cannot read or parse: `orthanc version`

The warning never blocks a call. Reads run. Writes that the manifest marks
`operator_approval` ask, as before.

`/mcp-status` shows the same line, or the supported range when there is no
warning.

## Failure modes, and what catches each

| ID | Failure | What catches it |
| --- | --- | --- |
| F1 | orthanc ships an `operator_approval` or `operator_approval_scope` shape the guard cannot read | At run time, the guard asks on every call to that command, in every mode, yolo included. A decline, or no one to ask, never runs it (test S2). At release time, `orthanc-tie.mjs check` and the test S1 fail and name the command. |
| F2 | The installed orthanc is newer than the plugin | A warning that names the plugin update command (V2, S5). Reads are not blocked (S6). |
| F3 | The installed orthanc is older than `min_orthanc` | A warning that names `orthanc update --apply` (V1, S5). Reads are not blocked. |
| F4 | The snapshot drifts silently: refreshed without the version, the version moved without the snapshot, or a new manifest field | `check` compares all four files and the KNOWN lists (T1, T3). The test S3 compares the snapshot with `ORTHANC_CHECKED`. |
| F5 | A marker of the release is not enforced | The test S4 drives every marker of the snapshot through the hooks in yolo. An `always` marker must ask, or be refused outright. A work-branch marker must run on a work branch and ask when it would land on main. |
| F6 | The manifest file is not an agent manifest | `refresh` refuses before it writes anything (T5). |
| F7 | Two orthanc releases come close together | One branch and one pull request per tag, `orthanc-tie/v<tag>`. A branch that already exists is never pushed over. The operator merges the newest and closes the older one. |
| F8 | The plugin repository cannot be reached | The orthanc release still publishes. The job reports that it opened no pull request. |
| F9 | The token is broader than one repository | The job refuses to run (orthanc side, SRC-178). |

## The orthanc release job (orthanc-source, SRC-178)

This is the contract that job follows. It runs after `publish`, with the new
binary.

1. Dump the manifest of the new release:
   `orthanc --agent --non-interactive agent-manifest > manifest.json`.
2. Check out this repository at `main` and create the branch
   `orthanc-tie/v<orthanc version>`. If that branch or its pull request already
   exists, stop and report it. Never overwrite it.
3. Run
   `node scripts/orthanc-tie.mjs refresh --manifest manifest.json --orthanc-version <x.y.z> --plugin-version <next>`.
   - `<next>` is the next patch version of the plugin by default. The operator
     can change it in the pull request.
   - Pass `--min-orthanc <x.y.z>` only when the plugin starts to need a newer
     orthanc, for example a new approval field that older releases lack.
   - Node 18 or later is enough. The script runs no orthanc and reaches no
     network.
4. `refresh` prints what changed in the approval markers (`+`, `-` and `~`
   lines, and new entry keys), then runs `check`.
   - Exit 0: the guard knows every shape.
   - Exit 1: open the pull request anyway, with the `FAIL` lines in its body,
     and fail the release summary with one line, `plugin guard does not know
     <field>`. The guard asks on those commands until someone ships a plugin
     that reads them.
   - Exit 2: the input was bad. Report it and open no pull request.
5. Commit the result, push the branch, and open a pull request titled
   `Tie the plugin to orthanc <x.y.z>`. Its body holds the `refresh` output.
6. Never merge, never tag, never push to `main`.

The token is a fine-grained token for this one repository only. It has two
permissions: contents write and pull requests write. GitHub has no permission
that opens a pull request without pushing a branch, so contents write is
needed. A token that reaches any other repository, or has any other write
permission, is refused.

When the manifest has not changed apart from the version, `refresh` says
`manifest unchanged apart from the version`. The job still opens the pull
request. That pull request only moves `orthanc_checked` and the plugin's patch
version, and its title ends with `(manifest unchanged)`. If the job opens no
pull request, `orthanc_checked` stays behind, and every session on the new
orthanc warns that orthanc is newer than the plugin.

## What the operator does

1. Review the pull request. Read every `+`, `-` and `~` marker line. Read any
   new entry key, and either teach the guard to read it, or add it to
   `KNOWN_ENTRY_KEYS` with a note that it changes nothing for the guard.
2. Bring `origin/main` into the branch, then run:

   ```
   node scripts/orthanc-tie.mjs check
   claude plugin validate .
   claude plugin test .
   ```

3. Merge into `main`.
4. Tag the merge commit with the plugin version, and push the tag:

   ```
   git tag v<plugin version> <merge commit>
   git push origin v<plugin version>
   ```

5. Update the marketplace copy and the installed plugin on each machine:

   ```
   claude plugin marketplace update claude-foundry
   claude plugin update foundry@claude-foundry
   ```

   `orthanc update --apply --plugin` does both, and updates orthanc too. A new
   session then shows no tie warning when orthanc is in range.

## The first release with this flow

0.7.0 releases `main` as it was after v0.6.0: yolo asks only on main (#10), and
the guard reads `operator_approval` by branch (#12). It sets `min_orthanc` to
0.7.8, the first orthanc whose manifest carries `operator_approval_scope`. It
sets `orthanc_checked` to 0.7.9, built from the v0.7.9 tag. The snapshot holds
516 commands and 20 approval markers.

To make the snapshot again from a binary:

```
orthanc --agent --non-interactive agent-manifest > manifest.json
node scripts/orthanc-tie.mjs refresh --manifest manifest.json --orthanc-version 0.7.9
```

A run on the same manifest makes the same bytes, so `git diff` shows nothing.
