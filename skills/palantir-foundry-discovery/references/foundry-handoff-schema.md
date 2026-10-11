# Foundry handoff YAML contract

Use `schema_version: foundry-handoff-v1`.
Use this top-level shape as the authoritative skeleton.
Keep every key, even when its collection is empty.

```yaml
schema_version: foundry-handoff-v1
artifact:
  status: draft
  version: "0.1"
  source_requirements_path: path/to/canonical-ce-requirements.md
  approved_by: null
  approved_at: null
  approval_scope: null
engagement:
  model: client_delivery
  maturity: POC
deliverables:
  primary: application
  supporting: []
outcome:
  form: validation_hypothesis
  statement: ""
  measure: ""
  baseline: null
  target: null
  decision_rule: null
  baseline_plan: null
users: []
workflows: []
business_requirements: []
functional_requirements: []
use_cases: []
acceptance_criteria: []
data_sources: []
existing_foundry_resources: []
integrations: []
foundry_capability_hypotheses: []
documentation_evidence: []
constraints: []
assumptions: []
risks: []
open_decisions: []
provisional_items: []
ontology_seed:
  applicability: not_applicable
  reason: ""
  object_types: []
  link_types: []
  action_types: []
  functions: []
trace: []
```

## Values and records

Use `draft`, `provisional`, or `approved` for `artifact.status`.
When required baseline evidence is missing, add a `provisional_items` record with `status: provisional`. Keep `artifact.status: approved` after approval.
Use `approved` only after the developer or FDE approves the named version.
Supply all approval fields for an approved artifact.

Use `client_delivery` only with `POC`, `pilot`, or `production`.
Use `product_delivery` only with `prototype`, `beta`, or `general_availability`.
Use `data_pipeline`, `ontology`, `application`, or `marketplace_product` for deliverables.

Use `operational_outcome`, `product_outcome`, or `validation_hypothesis` for `outcome.form`.
Require a measurable operational or product outcome for production or general availability.
Require a validation hypothesis and decision rule for a POC or prototype.
Require adoption, behavior, or technical validation measures for a pilot or beta.
Require `baseline_plan` when no required baseline exists. Add the missing baseline to `provisional_items`. Set its status to `provisional`.

Give each record in `business_requirements`, `functional_requirements`, `acceptance_criteria`, `constraints`, `assumptions`, `risks`, `open_decisions`, and `provisional_items` these fields:

```yaml
- id: BR-001
  statement: ""
  status: proposed
  source_ids: []
```

Use `proposed`, `committed`, `rejected`, `blocked`, `provisional`, or `not_applicable` for common record status.
Give records in `users`, `workflows`, `data_sources`, `existing_foundry_resources`, and `integrations` `id`, `name`, `status`, and `source_ids`.
Add type-specific fields only when they affect a downstream decision.

Give each use case `id`, `title`, `statement`, `priority`, `status`, and `source_ids`.
Use `must`, `should`, `could`, or `wont` for priority.
Give each capability hypothesis `id`, `capability`, `rationale`, `status`, `source_ids`, and `evidence_ids`.
Give each documentation evidence record `id`, `tool`, `page_url`, and `claim`.

## Ontology seed boundary

Set `ontology_seed.applicability` to `applicable` only when a committed use case requires an Ontology seam.
Give each candidate `id`, `name`, `api_name_candidate`, `statement`, `ownership`, `status`, `confidence`, `source_ids`, and `backing_source_ids`.
Use `dataset_backed`, `ontology_managed`, or `unresolved` for ownership.
Use `high`, `medium`, or `low` for confidence.
Add `cardinality` to Link Type candidates.
Add `actor_ids` to Action Type candidates.
Add `input_ids` to Function candidates. Add `output_ids` to Function candidates.
Treat every entry as a candidate rather than an approved Ontology definition.
Keep all candidate lists empty when applicability is `not_applicable`.
Give the reason for that boundary decision.

## Trace and validation

Give each trace edge `from_id`, `to_id`, and `relationship`.
Use `supports`, `satisfies`, `depends_on`, `derives_from`, `validates`, or `blocks` for the relationship.
Trace every committed requirement, use case, acceptance criterion, capability hypothesis, and applicable Ontology candidate.

Require successful YAML parsing. Require all top-level keys and record fields. Require valid enums and globally unique stable identifiers. Require resolved references and complete trace coverage.
Require approval metadata to match status.
Require `source_requirements_path` to identify the single canonical CE Markdown artifact.
Require the YAML and Markdown to agree.
