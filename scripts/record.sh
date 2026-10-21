#!/bin/zsh
# Records the real orthanc envelopes the E2E test replays (hooks/fixtures.local.ts).
# Re-run after an orthanc upgrade: ./scripts/record.sh, then claude plugin test.
set -eu
O=${ORTHANC_BIN:-orthanc}
# Your stack: FOUNDRY_E2E_PROFILE, FOUNDRY_E2E_PROJECT (a project RID), FOUNDRY_E2E_ONTOLOGY (an ontology RID),
# FOUNDRY_E2E_SPACE (the RID of the namespace that holds the project).
P=${FOUNDRY_E2E_PROFILE:?set FOUNDRY_E2E_PROFILE}
SHARED=${FOUNDRY_E2E_PROJECT:?set FOUNDRY_E2E_PROJECT}
ONT=${FOUNDRY_E2E_ONTOLOGY:?set FOUNDRY_E2E_ONTOLOGY}
SPACE=${FOUNDRY_E2E_SPACE:?set FOUNDRY_E2E_SPACE}
SEARCH=${FOUNDRY_E2E_SEARCH:-a}
out=${0:A:h}/../hooks/fixtures.local.ts
SPACE_PATH=$($O --agent --non-interactive --profile $P space list | jq -r --arg rid $SPACE '.data.spaces[] | select(.rid == $rid) | .path')
[[ -n $SPACE_PATH ]] || { print -u2 "no space $SPACE on $P"; exit 1 }
SPACE_PROJECTS=($($O --agent --non-interactive --profile $P project list --space-rid $SPACE | jq -r '.data.projects[].rid'))
calls=(
  "version"
  "agent-manifest"
  "configure list"
  "--profile $P ontology list"
  "--profile $P project list"
  "--profile $P resource list --type FOUNDRY_DATASET --folder-rid $SHARED"
  "--profile $P ontology action-type-list $ONT"
  "--profile $P search $SEARCH --limit 100"
  "--profile $P resource-role list $SHARED"
  "--profile $P space list"
  "--profile $P project list --space-rid $SPACE"
)
for project in $SPACE_PROJECTS; do
  [[ $project == $SHARED ]] || calls+=("--profile $P resource list --type FOUNDRY_DATASET --folder-rid $project")
done
record() {
  local argv=(--agent --non-interactive "$@")
  local stdout=$($O $argv)
  print -r -- "  $(jq -Rn --arg k "${argv}" '$k'): $(print -r -- $stdout | jq -Rs .),"
}
{
  print -r -- "// Recorded $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/record.sh from $($O --version 2>&1 | head -1). Do not edit."
  print -r -- "export const RECORDED: Record<string, string> = {"
  for c in $calls; do record ${=c}; done
  # A namespace path can hold spaces, so this argv is not word-split.
  record --profile $P search $SEARCH --path-prefix $SPACE_PATH --page-size 100
  print -r -- "}"
} > $out
print "wrote $out ($(wc -c < $out) bytes)"
