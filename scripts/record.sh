#!/bin/zsh
# Records the real orthanc envelopes the E2E test replays (hooks/fixtures.local.ts).
# Re-run after an orthanc upgrade: ./scripts/record.sh, then claude plugin test.
set -eu
O=${ORTHANC_BIN:-orthanc}
# Your stack: FOUNDRY_E2E_PROFILE, FOUNDRY_E2E_PROJECT (a project RID), FOUNDRY_E2E_ONTOLOGY (an ontology RID).
P=${FOUNDRY_E2E_PROFILE:?set FOUNDRY_E2E_PROFILE}
SHARED=${FOUNDRY_E2E_PROJECT:?set FOUNDRY_E2E_PROJECT}
ONT=${FOUNDRY_E2E_ONTOLOGY:?set FOUNDRY_E2E_ONTOLOGY}
SEARCH=${FOUNDRY_E2E_SEARCH:-a}
out=${0:A:h}/../hooks/fixtures.local.ts
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
)
{
  print -r -- "// Recorded $(date -u +%Y-%m-%dT%H:%M:%SZ) by scripts/record.sh from $($O --version 2>&1 | head -1). Do not edit."
  print -r -- "export const RECORDED: Record<string, string> = {"
  for c in $calls; do
    argv=(--agent --non-interactive ${=c})
    stdout=$($O $argv)
    print -r -- "  $(jq -Rn --arg k "${argv}" '$k'): $(print -r -- $stdout | jq -Rs .),"
  done
  print -r -- "}"
} > $out
print "wrote $out ($(wc -c < $out) bytes)"
