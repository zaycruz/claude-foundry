---
name: palantir-foundry-tools
description: Select and govern tools for any Palantir Foundry task. Use before documentation research, resource inspection, mutation, SuperRepo lifecycle work, deployment, or dependency analysis.
---

# Foundry tool selection

Apply this order to every Foundry task. Keep each gate fail-closed.

## Tool roles

Orthanc is the only path for Foundry work. `orthanc_help` discovers its command surface; `orthanc_cli` runs a command in agent mode and returns a `foundry-agent-v1` envelope. Do not call Foundry REST APIs, and do not reach for another CLI when Orthanc has the command. A Palantir MCP server, if one is connected, is a read-only source of official documentation. The official `foundry` CLI is used only for SuperRepo lifecycle work that Orthanc does not cover.

## Decision flow

1. **Classify the task.** For bounded maintenance, inspect the target and its local instructions. Use lifecycle workflows only when the task changes those lifecycle stages.
2. **Act through Orthanc.** Discover the command with `orthanc_help`, then run it with `orthanc_cli`. Writes are plan-first: read the plan, then apply.
3. **Resolve concrete uncertainty.** Read documentation only when an operation is unknown, a tool reports an error, or a high-risk irreversible change needs current platform evidence. Start with one targeted search and one page.
4. **Make the smallest reversible change.** Do not duplicate delegated investigation. Do not expand a bounded task into discovery or architecture work.
5. **Read back and verify.** Run the narrowest check that proves the requested outcome. Load the [execution policy](references/execution-policy.md) when its mutation or gap rules apply. AI FDE-loop work (`orthanc ai-fde`) is not delegated to a subagent; report it to the operator. Load [SuperRepo and Marketplace lifecycle](references/superrepo-marketplace-lifecycle.md) only for build, bundle, install, or promotion work.

## Orthanc gaps

When Orthanc cannot do a step, stop that step. Record the command you needed and the fail-closed error, and report it as an Orthanc gap. Do not build a workaround through REST or another tool.

## Evidence discipline

Label claims as:

- **Platform behavior**: supported by current official Palantir documentation.
- **FDE bundle policy**: a requirement stricter than the platform default.
- **Inference**: evidence-based but not a documented invariant.
- **Orthanc behavior**: supported by `orthanc_help`, the agent manifest, or an envelope you received.

Record beta, preview, enrollment, permission, and component-coverage constraints.

## Availability gates

- If Orthanc is unavailable or the profile has no working credentials, block Foundry reads, mutations, and completion. Tell the operator to run `/onboard`.
- If `foundry` is unavailable during SuperRepo work, block SuperRepo implementation and deployment.

## Completion record

Return the requested outcome, changed files or resource identifiers, focused verification, and concrete blockers. Include documentation, dependency-impact, lifecycle, and gap evidence only when the task used them.
