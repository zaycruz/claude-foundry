#!/usr/bin/env python3
"""Aggregate an FDE eval run: per arm, per difficulty, and paired per task.

    python3 evals/fde/score.py <run-id>

Writes results/<run-id>/summary.json and prints a table. Success is the
deterministic branch checks plus main unchanged; no model judges anything.
The paired view counts tasks where one arm's success rate beats the other's.
"""
import json
import math
import pathlib
import statistics
import sys

HERE = pathlib.Path(__file__).resolve().parent
METRICS = ["orthanc_calls", "applies", "dry_runs", "denials", "fde_denials", "ladder_denials", "failed_calls", "branches_created",
           "foreign_branch_writes", "branch_creates", "proposal_merge_close", "applies_without_branch",
           "applies_without_dry_run", "turns", "cost_usd", "output_tokens", "wall_s"]


def mean(values):
    values = [v for v in values if isinstance(v, (int, float))]
    return round(statistics.fmean(values), 3) if values else None


def wilson(successes, n, z=1.96):
    if n == 0:
        return None
    p = successes / n
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return [round(centre - half, 3), round(centre + half, 3)]


def summarize(records):
    wins = sum(r["success"] for r in records)
    return {
        "cases": len(records), "success": wins, "success_rate": round(wins / len(records), 3) if records else None,
        "success_ci95": wilson(wins, len(records)),
        "completed_rate": round(sum(r["completed"] for r in records) / len(records), 3) if records else None,
        "main_touched": sum(not all(c["ok"] for c in r["main_unchanged"]) for r in records),
        "unclosed_branches": sum(any(b["status"] != "CLOSED" for b in r["closed"]) for r in records),
        **{f"mean_{m}": mean(r.get(m) for r in records) for m in METRICS},
    }


def main():
    run_dir = HERE / "results" / sys.argv[1]
    records = [json.loads(p.read_text()) for p in sorted(run_dir.glob("*__*__*.json"))]
    arms = sorted({r["arm"] for r in records})
    summary = {"run_id": sys.argv[1], "arms": {}, "by_difficulty": {}, "paired": {}}
    for arm in arms:
        summary["arms"][arm] = summarize([r for r in records if r["arm"] == arm])
        for difficulty in sorted({r["difficulty"] for r in records}):
            summary["by_difficulty"].setdefault(difficulty, {})[arm] = summarize(
                [r for r in records if r["arm"] == arm and r["difficulty"] == difficulty])
    if set(arms) >= {"on", "off"}:
        better = {"on": 0, "off": 0, "tie": 0}
        for task in sorted({r["task"] for r in records}):
            rate = {a: mean([r["success"] for r in records if r["task"] == task and r["arm"] == a]) for a in ("on", "off")}
            better["tie" if rate["on"] == rate["off"] else ("on" if (rate["on"] or 0) > (rate["off"] or 0) else "off")] += 1
            summary["paired"][task] = rate
        summary["paired_wins"] = better
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2))

    rows = ["success_rate", "success_ci95", "completed_rate", "main_touched", "unclosed_branches"] + [f"mean_{m}" for m in METRICS]
    print(f"{'metric':28}" + "".join(f"{a:>18}" for a in arms))
    for row in rows:
        print(f"{row:28}" + "".join(f"{str(summary['arms'][a][row]):>18}" for a in arms))
    for difficulty, by_arm in summary["by_difficulty"].items():
        print(f"{'success ' + difficulty:28}" + "".join(f"{str(by_arm.get(a, {}).get('success_rate')):>18}" for a in arms))
    if "paired_wins" in summary:
        print(f"paired task wins: {summary['paired_wins']}")


if __name__ == "__main__":
    main()
