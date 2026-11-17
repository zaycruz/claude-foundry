# Changelog

## 0.6.1 (2026-11-17)

Parity with Orthanc 0.7.7 and orthanc-source main (operator_approval_scope).

- The guard reads `operator_approval` and `operator_approval_scope` from
  Orthanc's agent manifest (orthanc-source CONTRACTS.md, OA1-OA10):
  - `{when_all_flags: [...]}` asks when every listed flag is given (any case,
    `--flag=value`, any order). `--yes` alone is not the marked change.
  - Scope `always` asks in every mode, yolo included (branch protection off or
    weakened, project policies).
  - Scope `work-branch` runs in yolo when the branch positional is a global
    branch RID, and asks in other modes (`global-branch roles set`,
    `remove-resources`, `remove-repo`).
  - Orthanc 0.7.7 as released lists the markers but no scopes, so there every
    marker is `always` and asks in yolo too, as the contract says.
  - Scope `{work_branch_flag, flag_aliases}` runs in yolo only when that flag
    (or an alias) names one global branch RID.
  - A marker or scope the guard cannot read is `always`; an unreadable
    `operator_approval` asks on every call.
  - A read-only command with a marker is not let through as a read, in
    `orthanc_cli` or Bash.
- Release tags (`repository tag create --apply`): in yolo a tag runs without
  asking only on a global branch (`--branch` or `--foundry-branch-rid`); a tag
  with no branch publishes on main and asks. Two branch flags are refused.
- `repository pull-request approve` is a promotion and is refused, unless it
  names `--reject` or `--withdraw`.
- The palantir-foundry-tools policy names the Orthanc 0.7.7 commands
  (`table get`/`preview`/`freshness`, `connectivity explore`, `ontology
  action-outcomes`, `repository pull-request approve`/`approval`).
- The marketplace entry has a description; six tests had `env.set` stubs of
  the wrong type.

## 0.6.0

- yolo asks only for a write on main (PR #6).
