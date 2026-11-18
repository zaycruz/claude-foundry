#!/bin/sh
# Runs the approval-class tests and saves the yolo hook transcript they print:
# connectivity source secret set --apply and connectivity webhook create --apply
# stop for the operator; webhook list and a plan do not. Synthetic stack, same each run.
set -eu
out=${1:-live-out/approval-class-transcript.json}
mkdir -p "$(dirname "$out")"
claude plugin test 2>&1 | tee "${TMPDIR:-/tmp}/approval-class.log" | grep -E '^\((fail)\)' && exit 1
grep '^APPROVAL_TRANSCRIPT ' "${TMPDIR:-/tmp}/approval-class.log" | sed 's/^APPROVAL_TRANSCRIPT //' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(JSON.parse(s),null,2)+"\n"))' > "$out"
echo "wrote $out"
