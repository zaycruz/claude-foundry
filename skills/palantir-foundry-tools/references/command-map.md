# Orthanc command map

The Orthanc commands for the common Foundry tasks, by task. It is a map, not the
surface: Orthanc has more than 500 commands, and `orthanc_help` (a group, or
`{query}`) finds the rest. Read a command's page in `orthanc_help` before you run
it: the page has its flags, and the guard reads the same manifest.

Run reads as plain `orthanc …` or with `orthanc_cli`. Run writes with
`orthanc_cli` only. A write prints a plan unless `--apply`: read the plan, then
apply. `node scripts/orthanc-tie.mjs check` fails when a command on this page
leaves Orthanc's agent manifest.

## Start

- `orthanc verify`: the host and token of the active profile work.
- `orthanc capabilities`: every command with its mutation risk.

## Ontology work on a global branch

- `orthanc global-branch create`, `orthanc global-branch get`,
  `orthanc global-branch diff`: open the work branch, read it, and see what it
  changes against main.
- `orthanc global-branch update` (no `--description`): bring the branch up to
  date from main. The plan lists every conflict and sends nothing while one
  stands.
- `orthanc ontology branch-conflicts --branch <RID>`: the entities that the
  branch and main changed differently, with the fields that differ.
- `orthanc ontology branch-conflict-resolve`: settle one conflict by taking one
  side (`--take`). The other side is dropped on that branch: `--apply` needs
  `--yes`, and the call asks the operator outside yolo.
- `orthanc ontology branch-index-status`, `orthanc ontology branch-index`: an
  action applies on a branch only when every type it edits is indexed there.
- `orthanc global-branch check-deployable`, `orthanc proposal create`: check
  and propose the branch. Deploying, accepting and merging are the operator's.

## Code repositories

- `orthanc repository clone`, `orthanc repository branch create`,
  `orthanc repository push`: work on a branch that is not the default branch.
- `orthanc repository branch update-from-base`: bring a branch up to date with
  its base. The plan says whether the merge is empty, a fast-forward or a
  conflict; `--apply` pushes the merge commit. It never writes the default
  branch.
- `orthanc repository pull-request create`,
  `orthanc repository pull-request approval` (who must approve, what is
  missing), `orthanc repository checks wait`, `orthanc repository build-status`.
- `orthanc repository pull-request approve`: approves as the signed-in user.
  Approving and merging are the operator's; do not approve your own change.

## Pipelines and builds

- `orthanc pipeline get`, `orthanc pipeline check` (buildable and deployable):
  read a Pipeline Builder pipeline and check its sandbox.
- `orthanc pipeline sandbox create`, `orthanc pipeline edit`,
  `orthanc pipeline publish`, `orthanc pipeline deploy`: each works on the
  sandbox bound to `--branch`.
- `orthanc orchestration builds create`, `orthanc orchestration jobs logs`.

## Workshop

- `orthanc workshop module list`, `orthanc workshop module get`,
  `orthanc workshop module widgets`: find and read modules.
- `orthanc workshop module update`, `orthanc workshop module revert`: save a
  version on a global branch. `orthanc workshop module publish` marks a main
  version as published.

## Data freshness and impact

- `orthanc table freshness`, `orthanc table get`: when a virtual table last
  refreshed, and what it points at.
- `orthanc dataset health`: the Data Health checks of a dataset.
- `orthanc lineage impact`, `orthanc resource impact`,
  `orthanc dependency object-type`: what is downstream before you change,
  move or delete something.

## Access

- `orthanc admin group member list`, `orthanc admin user access`: who is in a
  group and what a user can reach.
- `orthanc admin group member add`, `orthanc admin group member remove`: these
  ask the operator in every mode.

## The operator's commands

`orthanc auth store`, `orthanc auth mint` and the `orthanc configure` commands
that take a credential are refused through Bash and `orthanc_cli`: a token
never passes through Claude. Tell the operator to run them in a terminal.
