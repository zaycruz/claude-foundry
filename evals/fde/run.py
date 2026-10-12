#!/usr/bin/env python3
"""FDE on vs off: run each task in both arms against a live stack and score it.

    python3 evals/fde/run.py --tasks evals/fde/tasks.local.json --runs 3

Each case is one headless `claude -p` session with this checkout loaded as a
plugin, driven one message per turn (stream-json input injects queued
messages mid-turn, so the driver waits for each result):

    /approval allow-edits, /ontology <name>, [/fde on], <task prompt>, [/fde end]

The task prompt is identical in both arms. After the session the runner reads
the branch state through Orthanc, checks main is unchanged, closes every
global branch the case created, and writes one JSON record per case to
results/<run-id>/. `score.py <run-id>` aggregates them.

Needs `claude` and `orthanc` on PATH and an Orthanc profile for the stack (on
Linux: FOUNDRY_PROFILE_<NAME>_HOST / _TOKEN). Nothing here prints a token.
"""
import argparse
import concurrent.futures
import datetime
import json
import os
import pathlib
import re
import shlex
import subprocess
import tempfile
import time

HERE = pathlib.Path(__file__).resolve().parent
PLUGIN = HERE.parent.parent
BRANCH_RID = re.compile(r"ri\.branch\.\.branch\.[0-9a-f-]{36}")
SUFFIX = (
    "\n\nKeep any local files in {workdir}. Use the foundry tools for Foundry. "
    "When you are done, end your answer with one line: BRANCH_RID=<the global branch RID that holds your changes>."
)
ALLOWED = ["mcp__foundry__orthanc_cli", "mcp__foundry__orthanc_help", "Read", "Edit", "Write"]


def orthanc(args, profile, timeout=180):
    """One Orthanc call in agent mode; returns the envelope (errors included, never raises)."""
    try:
        done = subprocess.run(
            ["orthanc", "--agent", "--non-interactive", "--profile", profile, *args],
            capture_output=True, text=True, timeout=timeout,
        )
        return json.loads(done.stdout or "{}")
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        return {"errors": [{"type": "runner", "message": type(error).__name__}]}


def drive(messages, workdir, out_path, model, timeout):
    """Feeds one message per turn; returns the result event of each turn."""
    env = dict(os.environ, CLAUDE_CODE_ENABLE_FUNCTION_HOOKS="1", FOUNDRY_OTEL=os.environ.get("FOUNDRY_OTEL", "off"))
    cmd = ["claude", "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
           "--plugin-dir", str(PLUGIN), "--allowedTools", *ALLOWED]
    if model:
        cmd += ["--model", model]
    results = []
    deadline = time.monotonic() + timeout
    with open(out_path, "w") as out:
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                cwd=workdir, env=env, text=True)
        try:
            for message in messages:
                proc.stdin.write(json.dumps({"type": "user", "message": {"role": "user", "content": message}}) + "\n")
                proc.stdin.flush()
                result = None
                for line in proc.stdout:
                    out.write(line)
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if event.get("type") == "result":
                        result = event
                        break
                    if time.monotonic() > deadline:
                        break
                results.append(result)
                if result is None:
                    break
        finally:
            proc.stdin.close()
            try:
                proc.wait(timeout=60)
            except subprocess.TimeoutExpired:
                proc.kill()
    return results


def tool_calls(session_path):
    """Every orthanc_cli call in the session with its outcome."""
    calls, pending = [], {}
    for line in open(session_path):
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(event, dict) or not isinstance(event.get("message"), dict):
            continue
        content = event["message"].get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                pending[block["id"]] = {"tool": block.get("name", ""), "input": block.get("input") or {},
                                        "message": event["message"].get("id")}
            elif block.get("type") == "tool_result" and block.get("tool_use_id") in pending:
                call = pending.pop(block["tool_use_id"])
                text = block.get("content")
                text = text if isinstance(text, str) else json.dumps(text)
                call.update(is_error=bool(block.get("is_error")), result=text[:4000])
                calls.append(call)
    return calls


def classify(call):
    command = str(call["input"].get("command", "")).strip()
    args = [str(a) for a in call["input"].get("args") or []]
    text = call["result"]
    # Orthanc errors come back as ordinary results (an envelope with errors); a
    # tool error is the mod refusing the call: branch rule, FDE, or the ladder.
    denied = call["is_error"]
    return {
        "command": command,
        "apply": "--apply" in args,
        "denied": denied,
        "fde_denied": denied and "FDE mode:" in text,
        "ladder_denied": denied and ("declined" in text or "guard:" in text),
        "failed": (not denied) and ('"errors": [\n' in text or '"errors":[{' in text),
        "args": args,
        "branch_rids": sorted(set(BRANCH_RID.findall(" ".join(args)))),
        "created_rid": (BRANCH_RID.findall(text) or [None])[0] if command == "global-branch create" and "--apply" in args else None,
    }


def check(spec, branch, profile):
    """A state check: `orthanc <args> | jq -r '<expr>'`, run without a shell, against expect_equals or expect_contains."""
    if "<BRANCH>" in spec["cmd"] and not branch:
        return {"cmd": spec["cmd"], "ok": False, "why": "no branch"}
    command, _, expr = spec["cmd"].replace("<BRANCH>", branch or "").partition("| jq -r ")
    words = shlex.split(command)
    while words and (words[0] in ("orthanc", "--agent", "--non-interactive") or words[0].endswith("/orthanc")):
        words.pop(0)
    if words[:1] == ["--profile"]:
        words = words[2:]
    envelope = orthanc(words, profile)
    got = subprocess.run(["jq", "-r", shlex.split(expr)[0]], input=json.dumps(envelope), capture_output=True, text=True).stdout.strip()
    if "expect_equals" in spec:
        ok = got == str(spec["expect_equals"]).strip()
    else:
        ok = str(spec["expect_contains"]) in got
    return {"cmd": spec["cmd"], "ok": ok, "got": got[:300]}


def discipline(calls, arm, branch):
    """The curated transcript checks, computed from the recorded calls rather than matched as text."""
    ran = [c for c in calls if not c["denied"] and not c["failed"]]
    ontology_applies = [c for c in ran if c["apply"] and c["command"].startswith("ontology ")]
    def plain(c):
        return (c["command"], tuple(a for a in c["args"] if a != "--apply"))
    planned = []
    unplanned = 0
    for c in ran:
        if not c["apply"]:
            planned.append(plain(c))
        elif c["command"].startswith("ontology ") and plain(c) not in planned:
            unplanned += 1
    return {
        "branch_creates": sum(c["command"] == "global-branch create" and c["apply"] for c in ran),
        "proposal_merge_close": sum(c["command"].startswith(("proposal", "global-proposal")) or c["command"] == "global-branch close" for c in ran),
        # FDE injects --branch itself, so an on-arm apply without it in the args was still pinned.
        "applies_without_branch": 0 if arm == "on" else sum("--branch" not in " ".join(c["args"]) for c in ontology_applies),
        "applies_without_dry_run": unplanned,
    }


def run_case(task, arm, rep, cfg, out_dir):
    case = f"{task['id']}__{arm}__{rep}"
    workdir = tempfile.mkdtemp(prefix=f"fde-eval-{task['id']}-{arm}-")
    prompt = task["prompt"] + SUFFIX.format(workdir=workdir)
    messages = [f"/approval {cfg.approval}", f"/ontology {cfg.ontology_name}"]
    messages += ["/fde on", prompt, "/fde end"] if arm == "on" else [prompt]
    started = time.time()
    results = drive(messages, workdir, out_dir / f"{case}.jsonl", cfg.model, cfg.timeout)
    wall = time.time() - started
    try:
        return score_case(task, arm, rep, cfg, out_dir, case, messages, prompt, results, wall)
    finally:
        # Whatever happened above, no branch this case made stays open: the ones its
        # global-branch create calls returned, and the one /fde on made.
        made = [classify(c)["created_rid"] for c in tool_calls(out_dir / f"{case}.jsonl")]
        if arm == "on" and len(results) > 2 and results[2]:
            made += BRANCH_RID.findall(results[2].get("result") or "")[:1]
        for rid in sorted({r for r in made if r}):
            if '"branch_status": "OPEN"' in json.dumps(orthanc(["global-branch", "get", rid], cfg.profile)):
                orthanc(["global-branch", "close", rid, "--apply", "--yes"], cfg.profile)


def score_case(task, arm, rep, cfg, out_dir, case, messages, prompt, results, wall):
    prompt_result = results[messages.index(prompt)] if len(results) > messages.index(prompt) else None

    calls = [dict(c, **classify(c)) for c in tool_calls(out_dir / f"{case}.jsonl") if c["tool"].endswith("orthanc_cli")]
    created = [c["created_rid"] for c in calls if c["created_rid"]]
    fde_rid = None
    if arm == "on" and len(results) > 2 and results[2]:
        found = BRANCH_RID.findall(results[2].get("result") or "")
        fde_rid = found[0] if found else None
    answer = (prompt_result or {}).get("result") or ""
    claimed = re.findall(r"BRANCH_RID=(ri\.branch\.\.branch\.[0-9a-f-]{36})", answer)
    branch = fde_rid if arm == "on" else (claimed[-1] if claimed else (created[-1] if created else None))

    checks = [check(spec, branch, cfg.profile) for spec in task["checks"] if spec.get("kind") == "state"]
    main = [check(spec, None, cfg.profile) for spec in task.get("main_unchanged_check", []) if spec.get("kind") == "state"]
    success = bool(checks) and all(c["ok"] for c in checks) and all(c["ok"] for c in main)

    closed = []
    for rid in sorted(set(created + ([fde_rid] if fde_rid else []))):
        orthanc(["global-branch", "close", rid, "--apply", "--yes"], cfg.profile)
        state = orthanc(["global-branch", "get", rid], cfg.profile)
        closed.append({"rid": rid, "status": json.dumps(state).split('"branch_status": "')[-1][:6]})

    usage = (prompt_result or {}).get("usage") or {}
    record = {
        "case": case, "task": task["id"], "shape": task.get("shape"), "difficulty": task.get("difficulty"),
        "arm": arm, "rep": rep, "success": success, "checks": checks, "main_unchanged": main,
        "completed": prompt_result is not None and not (prompt_result or {}).get("is_error"),
        "branch": branch, "branches_created": len(set(created)) + (1 if fde_rid else 0), "closed": closed,
        "orthanc_calls": len(calls), "applies": sum(c["apply"] and not c["denied"] for c in calls),
        "dry_runs": sum((not c["apply"]) and c["command"] != "" and not c["denied"] for c in calls),
        "denials": sum(c["denied"] for c in calls), "fde_denials": sum(c["fde_denied"] for c in calls),
        "ladder_denials": sum(c["ladder_denied"] for c in calls),
        "failed_calls": sum(c["failed"] for c in calls),
        "foreign_branch_writes": sum(c["apply"] and not c["denied"] and branch is not None and any(r != branch for r in c["branch_rids"]) for c in calls),
        **discipline(calls, arm, branch),
        "turns": (prompt_result or {}).get("num_turns"), "cost_usd": (prompt_result or {}).get("total_cost_usd"),
        "input_tokens": usage.get("input_tokens"), "output_tokens": usage.get("output_tokens"),
        "cache_read_tokens": usage.get("cache_read_input_tokens"), "wall_s": round(wall, 1),
        "calls": [{k: c[k] for k in ("command", "args", "apply", "denied", "fde_denied", "ladder_denied", "failed")} for c in calls],
    }
    (out_dir / f"{case}.json").write_text(json.dumps(record, indent=2))
    print(f"{case}: success={success} calls={len(calls)} denials={record['denials']} wall={record['wall_s']}s", flush=True)
    return record


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--tasks", default=str(HERE / "tasks.local.json"))
    parser.add_argument("--arms", default="off,on")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--only", default="", help="comma-separated task ids")
    parser.add_argument("--profile", default="zap")
    parser.add_argument("--ontology-name", default="ZaP Ontology")
    parser.add_argument("--model", default="")
    # auto asks the operator about schema changes, and a headless run has none, so
    # it declines them; allow-edits approves branch-scoped edits in both arms alike.
    parser.add_argument("--approval", default="allow-edits")
    parser.add_argument("--concurrency", type=int, default=2)
    parser.add_argument("--timeout", type=int, default=1500, help="seconds per case")
    parser.add_argument("--run-id", default=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    cfg = parser.parse_args()

    tasks = json.load(open(cfg.tasks))
    if cfg.only:
        wanted = set(cfg.only.split(","))
        tasks = [t for t in tasks if t["id"] in wanted]
    out_dir = HERE / "results" / cfg.run_id
    out_dir.mkdir(parents=True, exist_ok=True)
    # Arms interleave per task and rep, so drift in the stack or the model hits both alike.
    cases = [(t, arm, rep) for rep in range(cfg.runs) for t in tasks for arm in cfg.arms.split(",")]
    (out_dir / "run.json").write_text(json.dumps({"run_id": cfg.run_id, "tasks": [t["id"] for t in tasks],
                                                   "arms": cfg.arms, "runs": cfg.runs, "approval": cfg.approval, "model": cfg.model or "default"}, indent=2))
    with concurrent.futures.ThreadPoolExecutor(cfg.concurrency) as pool:
        for future in concurrent.futures.as_completed([pool.submit(run_case, *c, cfg, out_dir) for c in cases]):
            try:
                future.result()
            except Exception as error:  # one broken case must not stop the run
                print(f"case error: {type(error).__name__}: {error}", flush=True)
    print(f"results: {out_dir}\nscore:   python3 {HERE / 'score.py'} {cfg.run_id}")


if __name__ == "__main__":
    main()
