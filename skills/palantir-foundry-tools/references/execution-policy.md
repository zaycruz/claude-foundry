# Foundry execution policy

Use this policy whenever the Foundry tool decision flow reaches documentation, resource execution, `orthanc`, mutation, or read-back work.

## Native-first execution

1. Discover the command with `orthanc_help` (group listing, command schema, or `{query}` keyword search across all groups) before the first operation.
2. Execute platform operations with `orthanc_cli` — agent-mode envelope, usage-shaped errors, verification hints, fail-closed commands explain the alternative. Do not use Foundry REST, raw `orthanc` in Bash, or another CLI in its place.
3. Read official Palantir documentation before a material decision (a connected Palantir MCP server is fine for this, read-only). A search snippet is not decision evidence; load the full page.
4. Search for the existing resource before creating one (`orthanc search` for titles, `resource search` within a folder).
5. Read the resource and its dependencies before modifying it.

## Branches, never main

All agent work happens on branches. The mod blocks a write with no branch in every approval mode. A write that names `main`, `master` or `HEAD` as its branch, or works on main only (`workshop module publish`), asks the operator in every mode, yolo too, and is blocked when the operator declines or no one can be asked.

1. Ontology: create a global branch (`global-branch create agent/<kebab-name>`) and pass its RID (`ri.branch..branch.…`) as `--branch` on every ontology write. An ontology branch RID is not enough: only a global branch is provably not main.
2. Datasets, streams, builds, `cp`, connectivity imports, repository imports, `dataset create-from-csv`, `workshop module update`, `automate update`/`pause`/`resume` and `pipeline` sandbox/edit/publish/deploy: pass one `--branch <work branch>` (a global branch RID where the command asks for one), never `master` or `main`. A schedule's build action (`orchestration schedules create`/`replace`) names `"branchName": "<work branch>"`. Running or unpausing a stored schedule, or running an import, asks the operator when what it builds is main, names no branch, or cannot be read. Create a dataset branch with `dataset branches create <dataset> agent-<kebab-name>`.
3. Code: push to a work branch with `repository push <rid> refs/heads/<work> refs/heads/<work>` and open a pull request. Never `--allow-default-branch`, never raw `git push`.
4. Promotion is the operator's: do not merge, accept or approve proposals, deploy a global branch (`global-branch deploy`) or merge a code pull request (`repository pull-request merge`); the mod refuses them in every mode. A release tag (`repository tag create --apply`) asks the operator in every mode: run it with orthanc_cli, and the operator approves or declines it in the dialog. In yolo only a tag with `--branch <global branch RID>` runs at once. A write the agent manifest marks `operator_approval` asks the same way; in yolo it runs at once only when its `operator_approval_scope` shows it lands on one global work branch. `ontology object-upsert`, `object-upsert-batch` and `action-apply-with-overrides` cannot take a branch, so agents do not run them.

5. Writes go through `orthanc_cli` only. Bash may run Orthanc reads; an Orthanc write in Bash, in any wrapping, is blocked.
6. Writes run on the stack the operator picked with `/profile`. Do not pass `--profile`: a write that names it is blocked in every mode, because orthanc would run it on that other stack. A read may name another stack. `configure use` and `configure set-default` are blocked too: they change the stack a later session starts on.

## Local repository clones (orthanc-first)

Code repositories are cloned locally through Orthanc, never through raw git smart-HTTP:

1. Resolve the repository name to a RID with `orthanc search "<name>"` (Compass resources of type code repository; the RID looks like `ri.stemma.main.repository.…`).
2. Plan first: `orthanc_cli repository clone <rid> <target-dir> --dry-run` — the envelope resolves the git URL, default branch, and target without writing anything.
3. Clone: `orthanc_cli repository clone <rid> <target-dir>` (add `-b <branch>` for a non-default branch, `--force` to reuse a non-empty directory).
4. Work inside the clone with absolute paths (plain git and file tools); use `orthanc repository context <rid>` for the remote tree and `orthanc repository push` / `repository pull-request *` to ship changes back.
5. Deleting the clone directory is allowed. Never print `git remote -v` for a clone: the remote URL can carry a token.

## Orthanc gaps

When Orthanc fail-closes a required operation, stop and report it: the command you needed and the error envelope. Do not substitute another tool.

Do not run `orthanc ai-fde` from an agent. Report AI FDE-loop work to the operator.

Parse the `foundry-agent-v1` JSON envelope. Treat a nonempty `errors` field as failure, even when the process exit code is zero. Follow pagination until the required result is complete.

For a mutation, use only the explicit confirmation flag reported by the current CLI. Keep the non-interactive safety refusal intact. A refused or ambiguous mutation remains blocked.

## Dependency evidence

Before a mutation, run `orthanc dependency` for each target type it supports. Retain its graph artifact with the task evidence. Block the mutation when coverage is partial or a result requires unresolved verification. For unsupported target types, record the uncovered scope and do not claim verified dependency safety.

## Read-back and verification

After execution, read the changed resource with the strongest available tool. Then run the applicable build, preview, validation, deployment check, or smoke test. Record identifiers, command output, coverage limits, and verification results. A successful command without read-back is incomplete.
