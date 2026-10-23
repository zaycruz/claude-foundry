// The Bash guard reads only what the shell runs.
//
// In the week to 2026-10-22 the guard refused about 255 shell commands, and
// replayed against 0.5.0 about 190 are still refused, nearly all of them
// misreads: a Python heredoc that edits text naming orthanc, a path such as
// `--bin target/debug/orthanc` or `~/.herdr-projects/orthanc`, a variable that
// holds a scratchpad path. zay, 2026-10-22: "i need a yolo mode so the agent
// doesnt need more approval or get blocked". These refusals hit every mode.
//
// Ways this can fail, written before the code:
//  S1  Interpreter code the guard can read (a -c or -e value, a heredoc or
//      here-string fed to it) is refused because it names orthanc, though it
//      starts no process: a text edit, a JSON rewrite, a print.
//  S2  A word ending in /orthanc that is an argument (--bin target/debug/orthanc,
//      --bin=…, find DIR, chmod, codesign) is read as an Orthanc call.
//  S3  A variable run as a command is refused because the line names orthanc
//      somewhere else, though the line set that variable to something else.
//  S4  An assignment whose value only mentions orthanc (a message, a path
//      through an orthanc-source checkout) is refused.
//  S5  A loop over orthanc binaries that only asks each for its version is refused.
//  S6  A path that starts with a variable (`$X/orthanc-retry`) after the binary,
//      as in `shasum target/release/orthanc $X/orthanc-retry`, is read as an
//      Orthanc command built from a variable.
//  S7  An interpreter asked only for its version or help (`node --version`,
//      `python3 -V`) is read as one taking code from stdin, on a line that
//      names orthanc.
//  S8  A local command that only lists or shows (`ai-fde tools list`,
//      `smoke schedule`) is refused as a write.
//  K1  Interpreter code that names orthanc and starts a process runs:
//      subprocess, os.system, os.exec*, child_process, Bun.spawn, system(),
//      backticks and qx in Ruby and Perl, awk system() and getline, osascript
//      do shell script. A path to the binary (/opt/bin/orthanc) counts as orthanc.
//  K2  Orthanc given as an argument to a wrapper script, followed by an Orthanc
//      command (`run.sh /opt/bin/orthanc proposal merge p`), runs.
//  K3  A variable run as a command whose value runs orthanc, or a loop variable
//      run with an Orthanc command after it, runs.
//  K4  Interpreter code read from a pipe the guard cannot see runs, when the
//      line names orthanc.
//  K5  An F17 or G5-G9 case in foundry.test.ts regresses (that file still runs).
//  K6  The S6 and S7 fixes widen: a whole-word variable or a substitution after
//      the binary (`run.sh /opt/bin/orthanc $CMD`), or an interpreter given only
//      other flags (`node --no-warnings` reading a pipe), runs.
//
// Synthetic commands and paths only.
import { expect, test } from 'claude-code/testing'

import { classifyCall, ladderDecision, type ManifestCommand } from './policy'

const MANIFEST: ManifestCommand[] = [
  { path: 'agent-manifest', kind: 'local' },
  { path: 'ontology list', kind: 'read-only' },
  { path: 'functions search', kind: 'read-only' },
  { path: 'dataset create', kind: 'mutation' },
  { path: 'proposal merge', kind: 'mutation' },
  { path: 'sql export', kind: 'read-only' },
  { path: 'ai-fde tools list', kind: 'local' },
  { path: 'smoke schedule', kind: 'local' },
  { path: 'alias add', kind: 'local' },
]
const MODES = ['ask-always', 'allow-edits', 'auto', 'yolo'] as const
const approve = { action: 'approve', reason: 'ok' } as const
const bash = (command: string) => classifyCall('Bash', { command }, MANIFEST, 'agent/x')
const blockedEverywhere = (command: string) => {
  const classified = bash(command)
  return classified !== null && MODES.every(mode => ladderDecision(mode, classified, approve).outcome === 'block')
}

const PASSES: [string, string][] = [
  ['S1', "python3 - <<'EOF'\nimport pathlib\np = pathlib.Path('README.md'); s = p.read_text()\ns = s.replace('run `orthanc dataset create x`', 'run `orthanc dataset create y`')\np.write_text(s)\nEOF"],
  ['S1', "python3 -I - notes.md <<'EOF'\nimport sys\nt = open(sys.argv[1]).read().replace('orthanc 0.4', 'orthanc 0.5')\nopen(sys.argv[1], 'w').write(t)\nEOF"],
  ['S1', `orthanc --agent functions search lesson | python3 -c "import json,sys; d=json.load(sys.stdin)['data']; print('orthanc', len(d))"`],
  ['S1', "cd /home/tester/projects/orthanc-source && python3 - <<'PY'\nimport json\np = 'e2e/cases/misc.json'; d = json.load(open(p))\nd['note'] = 'orthanc dataset create runs in e2e'\njson.dump(d, open(p, 'w'))\nPY"],
  ['S1', `node -e "const fs=require('fs'); fs.writeFileSync('a.md', fs.readFileSync('a.md','utf8').replace('orthanc dataset get','orthanc dataset describe'))"`],
  ['S1', `ruby -e 'puts File.read("a.md").gsub("orthanc 0.4", "orthanc 0.5")'`],
  ['S1', "awk '/orthanc/ {print $2}' notes.md"],
  ['S1', `orthanc --agent agent-manifest > "$TMPDIR/m.json"; python3 -I - "$TMPDIR/m.json" <<'EOF'\nimport json,sys\nd = json.load(open(sys.argv[1]))\nprint(len(d['data']['commands']), 'orthanc commands')\nEOF`],
  ['S1', `M=/home/tester/.claude/memory; python3 -I - "$M/route.md" <<'EOF'\nimport sys, pathlib\np = pathlib.Path(sys.argv[1])\np.write_text(p.read_text().replace('use orthanc sql', 'use orthanc sql export'))\nEOF`],
  ['S2', "python3 scripts/e2e/run.py --check --bin target/debug/orthanc --only '^compute-info$' 2>&1 | tail -15"],
  ['S2', `scripts/e2e/keychain-env.sh tester python3 scripts/e2e/run.py --bin=target/debug/orthanc --only '^setup$' > "$OUT/log.txt"`],
  ['S2', 'cargo test --bin orthanc --no-run 2>&1 | tail -3'],
  ['S2', "find /home/tester/.herdr-projects/orthanc -name 'rules.md' 2>/dev/null | head -3"],
  ['S2', "ls -la target/debug/orthanc | awk '{print $6}'; chmod +x target/release/orthanc && codesign -s - target/release/orthanc"],
  ['S3', 'S=/tmp/tester-hp-orthanc-t-0027/scratchpad; mkdir -p $S/out; $S/run.sh > $S/out/log.txt'],
  ['S3', "H=/opt/herdr/bin/herdr-projects; $H --root /home/tester/.herdr-projects report --activity 'orthanc e2e green'"],
  ['S4', 'MSG="docs: orthanc 0.5 notes"; git commit -m "$MSG"'],
  ['S5', 'for b in $(which -a orthanc) /opt/orthanc-nightly/bin/orthanc; do [ -x "$b" ] && echo "$b: $($b --version)"; done'],
  ['S6', 'X=/tmp/tester/x0030; shasum target/release/orthanc $X/orthanc-retry | cut -c1-12; ls $X/out | head'],
  ['S6', 'cmp /opt/bin/orthanc ${X}/orthanc-old'],
  ['S7', 'command -v orthanc; head -c 300 "$(command -v orthanc 2>/dev/null)" | strings | head -5; node --version'],
  ['S7', 'which orthanc && python3 -V && perl -v | head -2'],
  ['S8', "orthanc --agent ai-fde tools list 2>/dev/null | grep -i -E 'log|build_history' | head"],
  ['S8', 'orthanc smoke schedule'],
]

const REFUSED: [string, string][] = [
  ['K1', "python3 - <<'EOF'\nimport subprocess\nsubprocess.run(['orthanc', 'proposal', 'merge', 'p'])\nEOF"],
  ['K1', `python3 -c "import os; os.system('/opt/bin/orthanc proposal merge p')"`],
  ['K1', "python3 - <<'EOF'\nimport os\nos.execvp('orthanc', ['orthanc', 'proposal', 'merge', 'p'])\nEOF"],
  ['K1', `ruby -e 'system("orthanc proposal merge p")'`],
  ['K1', "ruby -e '`orthanc proposal merge p`'"],
  ['K1', "perl -e 'qx(orthanc proposal merge p)'"],
  ['K1', `awk 'BEGIN { system("orthanc proposal merge p") }'`],
  ['K1', `awk 'BEGIN { "orthanc dataset create x" | getline r }'`],
  ['K1', `osascript -e 'do shell script "orthanc proposal merge p"'`],
  ['K1', `node -e 'require("child_process").execSync("orthanc proposal merge p")'`],
  ['K1', `bun -e 'Bun.spawnSync(["orthanc", "proposal", "merge", "p"])'`],
  ['K2', 'scripts/e2e/keychain-env.sh tester target/release/orthanc --profile tester dataset create x --apply'],
  ['K2', './run.sh /opt/bin/orthanc proposal merge p'],
  ['K2', "find . -name '*.json' -exec /opt/bin/orthanc dataset create {} \\;"],
  ['K3', 'for b in $(which -a orthanc); do $b proposal merge p; done'],
  ['K3', 'O=/opt/bin/orthanc; $O dataset create x'],
  ['K3', 'B="/opt/bin/orthanc --profile tester"; $B proposal merge p'],
  ['K3', 'X="cd /tmp && orthanc proposal merge p"; bash -c "$X"'],
  ['K4', 'cat job.py | python3 - --target orthanc'],
  ['K6', './run.sh /opt/bin/orthanc $CMD'],
  ['K6', './run.sh /opt/bin/orthanc "$(cat /tmp/tester/cmd)"'],
  ['K6', 'echo orthanc; cat job.js | node --no-warnings'],
  ['K6', 'echo orthanc; cat job.py | python3 -v'],
  ['K6', "orthanc alias add mk 'dataset create x'"],
]

for (const [id, command] of PASSES) {
  test(`${id}: passes: ${command.split('\n')[0]!.slice(0, 70)}`, async () => {
    expect({ command, result: bash(command) }).toEqual({ command, result: null })
  })
}

for (const [id, command] of REFUSED) {
  test(`${id}: refused in every mode: ${command.split('\n')[0]!.slice(0, 70)}`, async () => {
    expect({ command, blocked: blockedEverywhere(command) }).toEqual({ command, blocked: true })
  })
}

test('S1 E2E: a Python heredoc that edits text naming orthanc runs through the gate', async ($, on) => {
  on('tool.call', () => ({ result: 'ran' }) as never)
  on('store.get', () => ({ value: undefined }))
  on('store.set', () => ({ value: undefined }))
  on('env.get', (_$, e) => ({ value: e.name === 'HOME' ? '/home/tester' : undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  const ran = (await $.tool.call({ tool: 'Bash', command: PASSES[0]![1] } as never)) as { deny?: string }
  expect(ran.deny).toBe(undefined)
})
