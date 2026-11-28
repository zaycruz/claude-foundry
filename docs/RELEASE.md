# Releasing the plugin with orthanc

Each orthanc release opens one pull request here. The release job writes part of
it; the operator finishes it with `refresh`, reviews it, merges it and tags the
plugin. Orthanc never merges or tags here.

## What ties the plugin to orthanc

| Where | Field | Meaning |
| --- | --- | --- |
| `.claude-plugin/plugin.json` | `version` | the plugin version |
| `.claude-plugin/plugin.json` | `min_orthanc` | the oldest orthanc this plugin supports |
| `.claude-plugin/plugin.json` | `orthanc_checked` | the orthanc whose manifest the guard was last checked against |
| `.claude-plugin/marketplace.json` | `plugins[foundry].version` | the same as `version` |
| `hooks/orthanc-tie.ts` | `PLUGIN_VERSION`, `MIN_ORTHANC`, `ORTHANC_CHECKED` | the same three values, for the hooks (a hooks module cannot read JSON) |
| `hooks/orthanc-tie.ts` | `KNOWN_ENTRY_KEYS`, `KNOWN_ARG_KEYS`, `KNOWN_KINDS` | every manifest field the guard was checked against |
| `hooks/orthanc-manifest.snapshot.ts` | `orthanc_version`, `commands` | the trimmed `orthanc agent-manifest` of `orthanc_checked`, the one the hooks tests read |
| `hooks/orthanc-snapshot.json` | `orthanc_tag`, `min_orthanc`, `commands` | the release job's snapshot (orthanc-source `scripts/release/plugin_release.py`). Its `min_orthanc` is the tag the file follows, always `orthanc_tag` without the `v`; the orthanc release gate reads it. It is not the plugin's `min_orthanc`, which is the oldest orthanc the hooks support. Tests cannot import JSON, so the hooks do not read this file. `check` fails unless `orthanc_tag` is `v<orthanc_checked>`, its `min_orthanc` equals its tag and is not older than the plugin's, and its markers match the `.ts` snapshot entry for entry (T8, T10). |

`node scripts/orthanc-tie.mjs refresh` writes all of them. It writes
`hooks/orthanc-snapshot.json` in the release job's format, byte for byte. When
that file already holds the job's snapshot of the same tag, `refresh` leaves it
as it is and refuses (exit 2, nothing written) a manifest that does not match it
(T9). Do not edit these files by hand. `node scripts/orthanc-tie.mjs check`
fails when they disagree.

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
| F4 | The snapshot drifts silently: refreshed without the version, the version moved without the snapshot, the release job's pull request merged unfinished, or a new manifest field | `check` compares all five files and the KNOWN lists (T1, T3, T8). The test S3 compares the snapshot with `ORTHANC_CHECKED`. |
| F5 | A marker of the release is not enforced | The test S4 drives every marker of the snapshot through the hooks in yolo. An `always` marker must ask, or be refused outright. A work-branch marker must run on a work branch and ask when it would land on main. |
| F6 | The manifest file is not an agent manifest | `refresh` refuses before it writes anything (T5). |
| F7 | Two orthanc releases come close together | One branch and one pull request per tag, `orthanc-v<tag>`. A branch that already exists is never pushed over. Each open pull request proposes its own plugin version (the job's P12). The operator finishes and merges them oldest first, or merges the newest and closes the older ones. |
| F8 | The plugin repository cannot be reached | The orthanc release still publishes. The job reports that it opened no pull request (its P1). |
| F9 | The token is broader than one repository | The job refuses to run (its P4). |
| F10 | The release job's pull request is merged as the job opened it | `check` fails on it (T8) and names the `refresh` to run. Run `check` before every merge; CI runs it on every pull request and every push to main (`.github/workflows/ci.yml`, job `orthanc-tie`), so the pull request is red until it is finished. |

## The orthanc release job (orthanc-source, SRC-178)

The job is `scripts/release/plugin_release.py` in orthanc-source. It runs after
`publish`. It does not run anything from this repository. Per tag it:

1. Reads the agent manifest of the published binary.
2. Opens one pull request from the branch `orthanc-v<x.y.z>`. The pull request
   changes two files only:
   - `.claude-plugin/plugin.json`: `version` goes to the next patch version.
     No other line changes.
   - `hooks/orthanc-snapshot.json`: the snapshot of the new manifest, with
     `orthanc_tag` and `min_orthanc` set to the new tag.
3. Lists in the pull request body every approval shape the guard cannot read,
   and ends the release red if there is one.
4. Opens a pull request even when the manifest has not changed. An existing
   branch is never overwritten. The job never merges and never tags.

The token is the job's business (its P4). To push the branch it needs contents
write as well as pull requests write, on this one repository.

The job does not move `marketplace.json`, `orthanc_checked`,
`hooks/orthanc-tie.ts` or `hooks/orthanc-manifest.snapshot.ts`. So its pull
request is not finished when it opens: `check` fails on it, and one `FAIL`
line says how to finish it. The operator finishes it (step 2 below). The hooks
read the `.ts` files, so a merge without that step would leave the guard on the
old manifest. `check` is there to stop that merge.

When the guard needs a newer orthanc (a new approval field that older releases
lack, for example), the operator passes `--min-orthanc <x.y.z>` to `refresh`
in that step.

## What the operator does

1. Check out the job's branch, `orthanc-v<x.y.z>`, and bring `origin/main`
   into it.
2. Finish the pull request with the manifest of the same orthanc:

   ```
   orthanc --agent --non-interactive agent-manifest > manifest.json
   node scripts/orthanc-tie.mjs refresh --manifest manifest.json --orthanc-version <x.y.z>
   ```

   - `refresh` keeps the plugin version that the job set. It moves
     `marketplace.json`, `orthanc_checked`, `hooks/orthanc-tie.ts` and the
     `.ts` snapshot, and checks the job's `hooks/orthanc-snapshot.json`
     against the manifest. It does not rewrite that file.
   - If the manifest is not the one the job snapshotted, `refresh` exits 2
     and writes nothing. Get the binary of that tag and run it again.
   - It prints every `+`, `-` and `~` marker line and every new entry key,
     then runs `check`. Exit 1 here is real: a shape or field the guard
     cannot read. Teach the guard to read it, or add the key to
     `KNOWN_ENTRY_KEYS` with a note that it changes nothing for the guard.
   - Commit the result to the same branch.

3. Run:

   ```
   node scripts/orthanc-tie.mjs check
   claude plugin validate .
   claude plugin test .
   ```

4. Merge into `main`.
5. Tag the merge commit with the plugin version, and push the tag:

   ```
   git tag v<plugin version> <merge commit>
   git push origin v<plugin version>
   ```

6. Update the marketplace copy and the installed plugin on each machine:

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
sets `orthanc_checked` to 0.7.12, built from the v0.7.12 tag. The snapshot
holds 543 commands and 58 approval markers. They match, marker for marker,
`hooks/orthanc-snapshot.json`, which main took from the orthanc release job.
That file's `min_orthanc` (0.7.12) is the job's own value. The plugin's
`min_orthanc` is the one in `plugin.json`.

To make the snapshot again from a binary:

```
orthanc --agent --non-interactive agent-manifest > manifest.json
node scripts/orthanc-tie.mjs refresh --manifest manifest.json --orthanc-version 0.7.12
```

A run on the same manifest makes the same bytes, so `git diff` shows nothing.

Without a release job pull request (a hand-made release), `refresh` alone is
enough: pass `--plugin-version <next>` as well. It also writes
`hooks/orthanc-snapshot.json`, in the job's format, so the next job run
compares with it.
