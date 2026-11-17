#!/usr/bin/env bash
# Live check for orthanc-0hzh: one real Claude Code session, this checkout's
# plugin, and a stand-in orthanc that is replaced mid-session. orthanc_help
# must list the new binary's group, and say which version it came from, without
# a restart.
#
#   scripts/live-manifest-reload.sh [out-dir]
#
# Touches no Foundry stack: the stand-in answers every command itself. Writes
# <out-dir>/live-manifest-reload.txt (the evidence) and .jsonl (the session's
# stream). Exits 1 when the check fails. Needs `claude` logged in and jq.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
out=${1:-$repo/live-out}
mkdir -p "$out"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/bin" "$work/next"

# standin <file> <version> <groups...>: a shell script that answers like orthanc
# in agent mode, with two read-only commands per group.
standin() {
  local file=$1 version=$2
  shift 2
  local commands='' group
  for group in "$@"; do
    commands+="{\"path\":\"$group list\",\"kind\":\"read-only\",\"args\":[]},{\"path\":\"$group status\",\"kind\":\"read-only\",\"args\":[]},"
  done
  cat >"$file" <<EOF
#!/bin/sh
envelope() { printf '{"schema_version":"foundry-agent-v1","data":%s,"errors":[],"meta":{},"warnings":[],"artifacts":[],"pagination":null}\n' "\$1"; }
while [ \$# -gt 0 ]; do
  case "\$1" in
    --agent|--non-interactive) shift ;;
    --profile) shift 2 ;;
    *) break ;;
  esac
done
for word in "\$@"; do [ "\$word" = --help ] && { echo "usage of \$* (stand-in $version)"; exit 0; }; done
case "\$*" in
  agent-manifest) envelope '{"commands":[${commands%,}]}' ;;
  version|--version) envelope '{"version":"$version"}' ;;
  "configure list") envelope '{"profiles":[{"name":"standin","host":"standin.invalid","is_default":true,"status":"ok"}]}' ;;
  *) envelope '{"standin":"$version"}' ;;
esac
EOF
  chmod +x "$file"
}

standin "$work/bin/orthanc" 0.0.1-standin configure ontology
standin "$work/next/orthanc" 0.0.2-standin configure ontology livecheck
# The way install.sh replaces a release: a new file moved over the old path.
printf '#!/bin/sh\ncp "%s/next/orthanc" "%s/bin/orthanc.new" && mv "%s/bin/orthanc.new" "%s/bin/orthanc" && echo swapped\n' \
  "$work" "$work" "$work" "$work" >"$work/swap.sh"

prompt="Do exactly these three steps, one tool call each, in this order, and nothing else.
1. Call mcp__foundry__orthanc_help with no arguments.
2. Run this Bash command: sh $work/swap.sh
3. Call mcp__foundry__orthanc_help with no arguments.
Then reply with only the first line of the third result."

ORTHANC_BIN="$work/bin/orthanc" claude -p "$prompt" \
  --plugin-dir "$repo" \
  --settings '{"enabledPlugins":{"foundry@claude-foundry":false}}' \
  --model "${LIVE_MODEL:-claude-haiku-5-5}" \
  --allowedTools "mcp__foundry__orthanc_help" "Bash(sh $work/swap.sh)" \
  --output-format stream-json --verbose >"$out/live-manifest-reload.jsonl"

# The orthanc_help results, in order.
results() {
  jq -r --slurp '
    [.[] | select(.type == "assistant") | .message.content[]? | select(.type == "tool_use" and .name == "mcp__foundry__orthanc_help") | .id] as $ids
    | [.[] | select(.type == "user") | .message.content[]? | select(.type == "tool_result" and (.tool_use_id as $id | $ids | index($id)))
       | (.content | if type == "array" then map(.text // "") | join("") else . end)]
    | .[]  | @json' "$out/live-manifest-reload.jsonl"
}
mapfile -t helps < <(results)
first=$(jq -r . <<<"${helps[0]:-\"\"}")
third=$(jq -r . <<<"${helps[1]:-\"\"}")

ok=true
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; ok=false; fi; }
{
  echo "orthanc-0hzh live check, $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "claude: $(claude --version 2>/dev/null | head -1)"
  commit=$(git -C "$repo" rev-parse --short HEAD 2>/dev/null || echo 'not a git checkout')
  dirty=$(git -C "$repo" diff --quiet 2>/dev/null || echo '+dirty')
  echo "plugin: $commit$dirty, version $(jq -r .version "$repo/.claude-plugin/plugin.json")"
  echo
  check "two orthanc_help results"                       '[ ${#helps[@]} -eq 2 ]'
  check "before the swap: no livecheck group"           '! grep -q livecheck <<<"$first"'
  check "after the swap: livecheck listed, no restart"  'grep -q "livecheck (2)" <<<"$third"'
  check "after the swap: first line names old then new" 'head -1 <<<"$third" | grep -q "from 0.0.1-standin to 0.0.2-standin"'
  echo
  echo "--- orthanc_help, step 1 ---"; echo "$first"
  echo; echo "--- orthanc_help, step 3 ---"; echo "$third"
} >"$out/live-manifest-reload.txt"
cat "$out/live-manifest-reload.txt"
$ok
