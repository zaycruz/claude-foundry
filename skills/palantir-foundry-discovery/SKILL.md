---
name: palantir-foundry-discovery
description: Create an approved Foundry requirements handoff. Use when no approved handoff exists or existing requirements lack Foundry feasibility, traceability, or an Ontology seed.
---

# Foundry discovery wrapper

Invoke `palantir-foundry-tools` first.
Use this skill before `palantir-foundry-architecture` when the current scope has no approved Foundry handoff.
The developer or FDE answers from evidence already gathered from stakeholders.
Ask one question at a time.
Prefer single-select when one decision must win.
Challenge unsupported assumptions and premature component choices.

## Process

1. Classify the engagement.
   Select `client_delivery` with `POC`, `pilot`, or `production`.
   Select `product_delivery` with `prototype`, `beta`, or `general_availability`.
   Record one primary deliverable and any supporting deliverables.
   Use `data_pipeline`, `ontology`, `application`, or `marketplace_product`.

2. Run the Foundry preflight.
   Identify users, workflows, decisions, actions, data sources, connections, volume, freshness, integrations, deployment, environments, and Marketplace needs.
   Identify reusable datasets, Ontology resources, Functions, applications, and products.
   Use `orthanc_cli` to inspect resources when access exists.
   Give each unknown an owner.
   Complete preflight when every category has evidence or an owned unknown.

3. Call `/ce-brainstorm` with the preflight context and `output:md`.
   Identify the engagement as developer-facing Foundry work.
   Preserve CE interview and right-sizing rules.
   Require behavior, scope, outcomes, and acceptance criteria.
   Stop after the Phase 3 requirements artifact.
   Prevent a `ce-plan` invocation or handoff.
   Keep the CE Markdown file as the single canonical requirements artifact.

4. Enrich that file in place.
   Include engagement, deliverables, outcome, business requirements, functional requirements, prioritized use cases, and acceptance criteria.
   Include feasibility, risks, open decisions, architecture handoff, and Palantir MCP evidence.
   Add data, integration, deployment, Marketplace, component-hypothesis, or Ontology-seed detail only when it changes a downstream decision.
   Mark each required empty section `not_applicable`. Give the reason.

5. Define the outcome for the selected maturity.
   Require a measurable operational or product outcome for production or general availability.
   Require a validation hypothesis and decision rule for a POC or prototype.
   Require adoption, behavior, or technical validation measures for a pilot or beta.
   Add a baseline-measurement plan when no baseline exists.
   Add the missing baseline to `provisional_items`. Mark that baseline record `provisional`.

6. Validate Foundry feasibility.
   Derive capability candidates from committed use cases before checking named platform capabilities.
   Verify each material candidate with current MCP documentation.
   Record preliminary components as hypotheses rather than architecture decisions.
   Record expected SOO, Ontology seam, and NOO scope when applicable.
   Use Solution Designer, Marketplace, SuperRepo, Developer Console, AIP Logic, Automate, Workshop, and Notepad only as a coverage check.
   Record constraints, assumptions, evidence, risks, and open decisions.

7. Create the Ontology seed only when an Ontology seam applies.
   Propose only Object Types, Link Types, Action Types, and Functions required by committed use cases.
   Record ownership, API name candidates, confidence, trace sources, and unresolved questions.
   Treat all entries as candidates for architecture and Ontology implementation.
   Do not generate `ontology.mts`.
   Otherwise, set applicability to `not_applicable`. Give the reason. Leave all candidate lists empty.

8. Write a concise sibling `*-foundry-handoff.yaml` file.
   Follow [references/foundry-handoff-schema.md](references/foundry-handoff-schema.md).
   Point `artifact.source_requirements_path` to the canonical CE file.
   Give every material record a stable identifier.
   Preserve identifiers across revisions.

9. Validate the handoff.
   Approve the handoff only after validation passes.
   Confirm that Markdown and YAML agree.
   Validate required keys, enum values, unique identifiers, trace coverage, and referential integrity.
   Remove capabilities without a current use case.
   Mark missing evidence as `blocked` or `provisional`.
   Record version, approver, approval time, and approval scope.
   Set status to `approved` only after the developer or FDE approves that version.

## Completion gate

Complete discovery only when the canonical Markdown exists, the YAML passes its contract, maturity and deliverables are explicit, the outcome matches maturity, and every committed use case has acceptance criteria.
Require a traced applicable Ontology seed or a justified `not_applicable` seed.
Require no duplicate or dangling identifier.
Require approval metadata for the approved version.
Invoke `palantir-foundry-architecture` after approval.
A provisional baseline can proceed only when architecture retains its measurement plan and provisional status.
