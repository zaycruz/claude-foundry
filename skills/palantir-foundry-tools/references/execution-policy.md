# Foundry execution policy

Use this policy whenever the Foundry tool decision flow reaches documentation, resource execution, `orthanc`, mutation, or read-back work.

## Native-first execution

1. Discover the command with `orthanc_help` (group listing, command schema, or `{query}` keyword search across all groups) before the first operation.
2. Execute platform operations with `orthanc_cli` — agent-mode envelope, usage-shaped errors, verification hints, fail-closed commands explain the alternative. Do not use Foundry REST, raw `orthanc` in Bash, or another CLI in its place.
3. Read official Palantir documentation before a material decision (a connected Palantir MCP server is fine for this, read-only). A search snippet is not decision evidence; load the full page.
4. Search for the existing resource before creating one (`orthanc search` for titles, `resource search` within a folder).
5. Read the resource and its dependencies before modifying it.

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
