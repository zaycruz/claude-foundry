// The Bash guard reads only what the shell runs, and only the command word.
//
// In the week to 2026-10-22 the guard refused about 255 shell commands, and
// replayed against 0.5.0 about 190 are still refused, nearly all of them
// misreads: a Python heredoc that edits text naming orthanc, a path such as
// `--bin target/debug/orthanc`, a variable that holds a scratchpad path. Those
// became S1-S8 below. zay, 2026-11-23: "Guard: only a real orthanc invocation
// counts, not the word" — in one session that day the guard refused five
// commands that never ran orthanc: a board command whose --goal text
// mentioned the orthanc CLI, a project named Orthanc, a gh release view
// --json isDraft,assets on the zaycruz/orthanc repo (read as
// `orthanc isdraft,assets`), a python heredoc that only read a JSON file, and
// a grep over a path containing orthanc-source. Since then the guard decides
// "this runs orthanc" from the command word of each simple command (after
// resolving wrappers), never from a substring anywhere in the line: the word
// in a quoted argument, a repo name, a path, a flag value, a heredoc body or a
// JSON payload is data, not a call. It refuses a command word that is Orthanc
// — plain, a path to it, or $ORTHANC_BIN — and, only where it cannot tell, a
// variable as the command word, eval, code fed to a shell or interpreter, or
// the remote command of an ssh.
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
//  S9  A credential command in Bash is told to "run it with orthanc_cli", which
//      refuses it too, so the agent works around a call nothing may run. Bash is
//      the one lane that can feed a secret on stdin, so the check sits ahead of
//      the read short-circuit: an entry Orthanc declares a read is still refused.
//  S10 The word in an argument is read as a call (the 2026-11-23 session): a
//      board --goal that mentions the orthanc CLI, a project named Orthanc,
//      a repo (zaycruz/orthanc) or a path (orthanc-source) as an argument —
//      also one a substitution leaves at a segment's head, as in
//      `gh release view $(cat VERSION) --repo zaycruz/orthanc --json
//      isDraft,assets` — a JSON payload, a heredoc body that only reads a
//      file, or the binary's path as an argument to a wrapper script.
//  K1  Interpreter code that names orthanc and starts a process runs:
//      subprocess, os.system, os.exec*, child_process, Bun.spawn, system(),
//      backticks and qx in Ruby and Perl, awk system() and getline, osascript
//      do shell script. A path to the binary (/opt/bin/orthanc) counts as orthanc.
//  K2  Orthanc as the command word stops being caught, however it is spelled:
//      plain, by absolute or relative path, after env/sudo/timeout/xargs (their
//      flag values resolved), in a pipeline, in $(…), via bash -c, via npx or
//      find -exec, over ssh, or as $ORTHANC_BIN.
//  K3  A variable run as a command whose value runs orthanc, or a loop variable
//      run with an Orthanc command after it, runs.
//  K4  Interpreter code read from a pipe the guard cannot see runs, when the
//      line names orthanc.
//  K5  An F17 or G5-G9 case in foundry.test.ts regresses (that file still runs).
//  K6  The S6 and S7 fixes widen: a whole-word variable or a substitution after
//      the binary, or an interpreter given only other flags, runs.
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
  // Orthanc 0.7.10 marks: `input` for a typed secret, `credential_store` for the
  // store a command writes (`configure configure`) or clears (`auth delete`).
  { path: 'auth store', kind: 'local', input: 'token-on-stdin' },
  { path: 'configure configure', kind: 'local', credentialStore: 'secret-service-or-file', flags: [{ flag: '--token-stdin', takesValue: false }] },
  { path: 'auth delete', kind: 'local', credentialStore: 'secret-service-or-file' },
  // A store-marked entry Orthanc might one day call a read: Bash has no second
  // gate behind the read short-circuit, so it must not reach one.
  { path: 'credential show', kind: 'read-only', credentialStore: 'secret-service-or-file' },
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
  // S10: only a real invocation counts, not the word (the 2026-11-23 session).
  ['S10', 'H=/opt/herdr/bin/herdr-projects; $H add claude-foundry/2 --goal "wire the orthanc CLI into the guard" --kind agent'],
  ['S10', '/opt/herdr/bin/herdr-projects add claude-foundry/2 --goal "Guard: only a real orthanc invocation counts" --desc "the Bash guard reads the command word, not the line"'],
  ['S10', 'cd /home/tester/projects/Orthanc && cargo build --release 2>&1 | tail -5'],
  ['S10', 'ls -la /home/tester/projects/Orthanc && grep -rn TODO /home/tester/projects/Orthanc/src | head -20'],
  ['S10', 'gh release view v0.7.12 --repo zaycruz/orthanc --json isDraft,assets'],
  ['S10', 'gh release view $(cat VERSION) --repo zaycruz/orthanc --json isDraft,assets'],
  ['S10', 'gh repo view zaycruz/orthanc --json name,owner'],
  ['S10', `grep -rn "waits" /home/tester/src/orthanc-source/src | head -20`],
  ['S10', `cd /home/tester/src/orthanc-source && grep -n "wait" src/cli.rs | head -5`],
  ['S10', `python3 - <<'EOF'\nimport json\nsnap = json.load(open('hooks/orthanc-snapshot.json'))\nprint(len(snap['commands']), 'orthanc commands')\nEOF`],
  ['S10', `python3 - <<'EOF'\nimport json, re\nsnap = json.load(open('out/release.json'))\nstart = re.compile(r'^([a-z-]+) ')\ngroups = sorted({m.group(1) for c in snap['commands'] if (m := start.match(c['path']))})\nprint('orthanc', len(snap['commands']), 'commands in', len(groups), 'groups')\nEOF`],
  ['S10', `jq -r '.commands[0].path' hooks/orthanc-snapshot.json`],
  ['S10', `curl -sS --json '{"note":"orthanc dataset create green"}' https://hooks.example.test/x`],
  // The binary's path as an argument to a wrapper script: an argument, not the command word.
  ['S10', 'scripts/e2e/keychain-env.sh tester target/release/orthanc --profile tester dataset create x --apply'],
  ['S10', './run.sh /opt/bin/orthanc proposal merge p'],
  ['S10', './run.sh /opt/bin/orthanc $CMD'],
  ['S10', './run.sh /opt/bin/orthanc "$(cat /tmp/tester/cmd)"'],
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
  // K2: a real invocation, however the command word is spelled.
  ['K2', 'orthanc dataset create x --branch agent-t14 --apply'],
  ['K2', 'orthanc --profile tester dataset create x --apply'],
  ['K2', '~/.local/bin/orthanc dataset create x --apply'],
  ['K2', '/opt/bin/orthanc proposal merge p'],
  ['K2', 'target/debug/orthanc proposal merge p'],
  ['K2', 'env X=1 orthanc dataset create x --apply'],
  ['K2', 'sudo --user tester /opt/bin/orthanc dataset create x --apply'],
  ['K2', 'timeout 60s orthanc proposal merge p'],
  ['K2', 'nice -n 10 orthanc proposal merge p'],
  ['K2', 'echo T | xargs -I{} orthanc dataset create {} --apply'],
  ['K2', 'echo T | xargs -I {} orthanc dataset create {} --apply'],
  ['K2', 'nohup orthanc dataset create x --apply &'],
  ['K2', 'orthanc proposal merge p | tee /tmp/tester/merged.log'],
  ['K2', 'echo "$(orthanc proposal merge p)"'],
  ['K2', "bash -c 'orthanc dataset create x --apply'"],
  ['K2', 'npx --yes orthanc dataset create x'],
  ['K2', 'find . -name x -exec orthanc dataset create {} --branch agent-t14 --apply \\;'],
  ['K2', "ssh box 'orthanc dataset create x --apply'"],
  ['K2', 'ssh box orthanc dataset create x --apply'],
  ['K2', '$ORTHANC_BIN dataset create x --apply'],
  ['K3', 'for b in $(which -a orthanc); do $b proposal merge p; done'],
  ['K3', 'O=/opt/bin/orthanc; $O dataset create x'],
  ['K3', 'B="/opt/bin/orthanc --profile tester"; $B proposal merge p'],
  ['K3', 'X="cd /tmp && orthanc proposal merge p"; bash -c "$X"'],
  ['K4', 'cat job.py | python3 - --target orthanc'],
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

// A bounded generated-input check over command shapes: every way a line can
// name orthanc without running it (heads the agent uses, wrappers in front,
// the word as a path, a repo, a quoted argument, a JSON payload, a flag value)
// passes; every way to spell a real invocation (the command word itself, a
// path to it, $ORTHANC_BIN, wrappers with their flag values resolved, a
// pipeline, a substitution, bash -c, ssh) refuses.
test('S11: a bounded enumeration of command shapes: only the command word refuses', async () => {
  const heads = ['gh', 'grep', 'ls', 'cd', 'cargo', 'tar', 'cp', 'chmod', 'curl', 'jq', 'git', 'python3', 'docker', 'kubectl', 'sed', 'make']
  // Every way a line can name orthanc without running it.
  const names = [
    'orthanc', 'Orthanc', 'zaycruz/orthanc', 'orthanc-source', 'target/debug/orthanc', '~/.local/bin/orthanc',
    '"tie to orthanc v0.7.12"', "'orthanc dataset create x'", '{"note":"orthanc dataset create green"}',
    '--bin=target/debug/orthanc', '$X/orthanc-retry',
  ]
  // Prefixes that resolve away from the command word.
  const wrappers = ['', 'env X=1 ', 'sudo --user tester ', 'timeout 30 ', 'xargs -I {} ', '! ', 'nice -n 10 ']
  for (const head of heads) {
    for (const name of names) {
      for (const wrapper of wrappers) {
        for (const flag of ['', '--opt ']) {
          const line = `${wrapper}${head} ${flag}${name} x`
          expect({ head, name, wrapper, flag, result: bash(line) }).toEqual({ head, name, wrapper, flag, result: null })
        }
      }
    }
  }
  // Every way to spell the command word of a real invocation.
  const spells = ['orthanc', '/opt/bin/orthanc', 'target/release/orthanc', '~/.local/bin/orthanc', '$ORTHANC_BIN']
  const throughs = ['', 'env X=1 ', 'sudo --user tester ', 'timeout 60s ', 'xargs -I {} ', 'nice -n 10 ', 'nohup ', 'setsid ', 'npx --yes ', '! ']
  for (const spell of spells) {
    for (const through of throughs) {
      expect({ spell, through, blocked: blockedEverywhere(`${through}${spell} dataset create x --apply`) }).toEqual({ spell, through, blocked: true })
    }
  }
  for (const shape of [
    'orthanc dataset create x --apply | tee /tmp/tester/created.log',
    'echo y | orthanc dataset create y --apply',
    'echo "$(orthanc dataset create x --apply)"',
    "bash -c 'orthanc dataset create x --apply'",
    "ssh box 'orthanc dataset create x --apply'",
    'O=/opt/bin/orthanc; $O dataset create x --apply',
    'find . -name x -exec /opt/bin/orthanc dataset create {} --branch agent-t14 --apply \\;',
  ]) {
    expect({ shape, blocked: blockedEverywhere(shape) }).toEqual({ shape, blocked: true })
  }
})

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

test('S9: a credential command in Bash is sent to the operator, not to orthanc_cli', () => {
  for (const line of [
    'orthanc auth store tester',
    'orthanc configure configure --host https://x.example.palantirfoundry.com --auth-type token --token-stdin --force',
  ]) {
    const error = classifyCall('Bash', { command: line }, MANIFEST, null)?.error ?? ''
    expect(error).toContain('needs a credential the operator types')
    expect(error).toContain('/auth lists the credential commands')
    expect(error).not.toContain('with orthanc_cli')
  }
  // Clearing a stored credential types no secret: that call keeps the write routing.
  expect(classifyCall('Bash', { command: 'orthanc auth delete tester' }, MANIFEST, null)?.error).toContain("Run 'auth delete' with orthanc_cli")
  // A read verb is not enough: the store mark still refuses, ahead of the short-circuit.
  expect(classifyCall('Bash', { command: 'orthanc credential show' }, MANIFEST, null)?.error).toContain('needs a credential the operator types')
})

// Review of #33: a launcher in command position runs a later word as its program,
// so an Orthanc write after flock, nsenter, unshare or docker exec is still a call.
test('S-launcher: an Orthanc write after a launcher is still caught', () => {
  const manifest = [
    { path: 'ontology object-delete', kind: 'mutation', flags: [{ flag: '--apply', takesValue: false }, { flag: '--branch', takesValue: true }] },
  ] as never
  const write = 'ontology object-delete ri.x --apply'
  for (const line of [
    `flock /tmp/lock orthanc ${write}`,
    `nsenter -t 1 orthanc ${write}`,
    `unshare -r orthanc ${write}`,
    `docker exec c orthanc ${write}`,
    `chroot /srv orthanc ${write}`,
  ]) {
    expect({ line, caught: classifyCall('Bash', { command: line }, manifest, null, [] as never) !== null }).toEqual({ line, caught: true })
  }
  for (const line of ['gh release view v1 --repo zaycruz/orthanc --json isDraft,assets', 'docker run --name orthanc-docs nginx']) {
    expect({ line, caught: classifyCall('Bash', { command: line }, manifest, null, [] as never) !== null }).toEqual({ line, caught: false })
  }
})
