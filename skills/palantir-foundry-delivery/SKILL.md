---
name: palantir-foundry-delivery
description: Chain, resume, or assess a multi-stage Foundry delivery. Use when work spans multiple lifecycle stages, when resuming an engagement, or when an upstream change can invalidate downstream evidence.
---

# Foundry delivery workflow

Invoke `palantir-foundry-tools` first. Use this skill only for cross-stage orchestration. For isolated maintenance, invoke a stage skill directly when its prerequisites hold.

## Process

1. Load the approved handoff, Solution Designer identifier, product versions, stage ledgers, and delivery state.
2. Create or validate `foundry-delivery-state.yaml` with [references/delivery-state-schema.md](references/delivery-state-schema.md).
3. Determine whether Setup, SOO, Ontology, and NOO apply.
4. Require a reason and approver for each `not_applicable` stage.
5. Verify completed gates from artifact identifiers and installed-state evidence.
6. Mark stale gates `invalidated` when an approved upstream contract changes.
7. Select the first applicable stage with `not_started`, `blocked`, or `invalidated` status.
8. Invoke its stage skill. Treat that skill's completion gate as authoritative.
9. Record the resulting status and evidence without copying the stage ledger.
10. Continue until every applicable stage is complete or one stage is blocked.

## Stage routes

- No approved handoff: invoke `palantir-foundry-discovery`.
- Approved handoff without approved architecture: invoke `palantir-foundry-architecture`.
- Approved architecture without required topology: invoke `palantir-foundry-project-setup`.
- Applicable Data-product work: invoke `palantir-foundry-soo-implementation`.
- Applicable Ontology seam: invoke `palantir-foundry-ontology-implementation`.
- Applicable operational application or workflow: invoke `palantir-foundry-noo-implementation`.

Skip a stage only when its state is `not_applicable` with a reason and approver. Permit direct SOO, Ontology, or NOO entry for maintenance after prerequisite validation.

## Invalidation rules

- Invalidate Architecture and affected downstream stages when the approved outcome, use case, constraint, or maturity changes.
- Invalidate Setup and affected implementation stages when project, product, ownership, permission, or release boundaries change.
- Invalidate consuming Ontology and NOO gates when a Data-product Output schema, key, identifier, or version changes.
- Invalidate consuming NOO gates when an Ontology API name, ownership rule, Action, Function, Interface, mapping, or product version changes.
- Invalidate NOO installation evidence when authorization, restriction, environment mapping, hosting, or application type changes.

Preserve unaffected completed stages. Never convert local-preview success into installed-enrollment completion.

## Completion gate

Complete the delivery workflow only when every applicable stage is complete, no stage is invalidated, all required installed-state evidence resolves to the approved versions, and all external dependencies required for the target maturity have an owner and disposition.
