# Delivery state schema

Keep this file concise. Store identifiers and versions instead of copying stage ledgers.

```yaml
schema_version: foundry-delivery-state-v1
engagement_id: string
handoff:
  path: string
  version: string
solution_designer_id: string
updated_at: RFC-3339 timestamp
stages:
  discovery: {status: complete, evidence_id: string}
  architecture: {status: complete, evidence_id: string}
  setup: {status: not_started, evidence_id: null}
  soo: {status: not_started, evidence_id: null}
  ontology: {status: not_started, evidence_id: null}
  noo: {status: not_started, evidence_id: null}
```

Each stage supports:

- `status`: `not_started`, `in_progress`, `blocked`, `complete`, `invalidated`, or `not_applicable`
- `evidence_id`: Path, RID, product version, installation identifier, or ledger identifier
- `input_versions`: Required approved upstream versions for each completed stage after Discovery
- `reason`: Required for `blocked`, `invalidated`, and `not_applicable`
- `approver`: Required for `not_applicable`
- `completed_at`: Required for `complete`

Reject unknown status values. Reject `complete` without evidence. Reject `not_applicable` without a reason and approver. Reject `complete` after Discovery when `input_versions` omits an applicable upstream artifact or product. Reject `complete` when any recorded upstream version is stale.
