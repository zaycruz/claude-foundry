---
name: palantir-foundry-soo-implementation
description: Implement or maintain Foundry SOO ingestion, normalization, quality controls, and published Data-product outputs. Use when approved architecture requires new or changed source-to-output data contracts.
---

# Foundry SOO implementation

Invoke `palantir-foundry-tools` first. Use Code Repositories for all cleanup and transformation. Pipeline Builder is outside this implementation pattern. At the first compute, processing-mode, quality, monitoring, test, or recovery decision, load [execution and quality rules](references/execution-and-quality.md). Apply those rules throughout implementation.

## Preconditions

Require an approved `foundry-handoff-v1`, Solution Designer identifier, project topology, source owners, and isolated development target. Block work when a required source, credential, or target is unavailable.

## Maintenance fast path

For a bounded change in an existing implementation, inspect only the affected pipeline, contract, dependency, and test seam. Make the smallest reversible change. Complete when the requested artifact exists, focused tests pass, and affected Foundry outputs pass read-back. Apply architecture, publication, installation, approval, promotion, and first-build gates only when the task changes those lifecycle stages.

## Product structure

Create one Datasource project for each logical source. Create one Code Repository for each logical source. Give each project separate physical `/raw` and `/clean` datasets. Use `/processed` only for necessary file-to-tabular conversion.

Create a separate Transform project and Code Repository. Import only approved clean datasets. Put stable downstream contracts in `/data/output`. Create `/data/transformed` only for a reusable contract, material computation, or genuine intermediate boundary. The output datasets are the Data-product boundary.

## Implementation

1. **Ground the change.** Load current official documentation for the applicable Foundry features. Search for existing resources, schedules, Checks, lineage, and dependencies. Inspect source schemas and statistics. Select a development branch, proposal, or isolated target before mutation. Follow the tool skill for dependency-impact analysis. Follow the tool skill for Orthanc gaps.

2. **Land each source.** Create or select its Foundry-native connection. Record batch or streaming mode. For batch mode, record snapshot or incremental sync. Capture cadence, changes and deletes, late corrections, cursor or checkpoint, replay, and transaction behavior. Land source-faithful data in `/raw`. Preserve source identifiers and ingestion metadata. Verify the first transaction and schema.

3. **Build raw-to-clean pipelines.** Materialize a separate clean dataset for each required raw dataset. Keep records traceable to their source. Standardize names and types. Handle missing, malformed, duplicate, and invalid values explicitly. Preserve a source key when it is valid. Otherwise, justify a surrogate or composite key. If neither key applies, record `no_key` with downstream limitations. Document every source-to-clean mapping. Keep business rules out of this stage.

4. **Build clean-to-output pipelines.** Implement approved joins, aggregations, relationship normalization, rules, and metrics in the Transform repository. Materialize only justified intermediates. Materialize each stable consumer contract as its own `/data/output` dataset. Document every clean-to-output mapping and intermediate justification.

5. **Make execution and quality explicit.** For every pipeline, select a compute engine. Test the selected compute engine. For every transform, select full rebuild or incremental processing. Test the selected processing semantics. Add meaningful Data Expectations and named Checks at relevant contract boundaries. Apply `FAIL` to invalidating violations. Apply `WARN` to diagnostics. Monitor every pipeline with role-appropriate, nonredundant health checks. Assign alert and recovery owners. Add unit tests and a recovery test for each material pipeline.

6. **Prove the development build.** Run repository CI and actual development dataset builds. Verify all `FAIL` Checks. Give each failed `WARN` an owner and accepted disposition. Read back schemas, transactions, lineage, results, schedules, and health-check state. Exercise incremental updates, deletes or corrections, retry, idempotency, and full rebuild when applicable. Compare the resources with Solution Designer.

7. **Document and publish.** Add `README` and `CHANGELOG` to every repository. Document purpose, mappings, inputs, outputs, keys, builds, schedules, Checks, engines, processing modes, monitoring, and recovery. Save lineage resources under `/documentation`. Save durable Notepad guidance under `/documentation`. Update Solution Designer. Create the Data-product draft in the approved Foundry DevOps store. Declare only stable `/data/output` datasets as Outputs. Classify detected dependencies as Inputs. Set the approved semantic version. Set the approved installation mode. Package the product before any downstream product. Publish the product before any downstream product.

8. **Install and promote.** Development-install the published version into the approved isolated target. Read back output datasets, schemas, identifiers, Inputs, dependencies, and version. Record product and installation identifiers for downstream SuperRepo `env.yml`. If tools lack a DevOps operation, use the approved human-in-the-loop interface. Perform read-back after you use that interface. Obtain the required approval. Promote through the maturity-appropriate target path. Confirm alert and recovery ownership before you enable production schedules. Enable production schedules only after that confirmation. Monitor the first target build to a terminal state.

Return one implementation record containing the decisions, mappings, owners, evidence, identifiers, approvals, promotion state, and tool provenance produced above. Mark an unused tool not applicable. Preserve architecture and project permission decisions. Route access-control implementation and verification to governance. Do not make access control an SOO gate.

## Completion gate

Complete the stage only when every source lands verified raw data; every required raw dataset has a keyed or explicitly `no_key` clean contract; every stable output and justified intermediate exists; CI, development builds, required tests, `FAIL` Checks, monitoring, and recovery evidence pass; failed `WARN` Checks have owned dispositions; documentation and Solution Designer are current; and the published Data product passes development-install read-back. Required approval, promotion, and first-build evidence must match the engagement maturity.

Invoke `palantir-foundry-ontology-implementation` after this gate passes when an Ontology seam applies. Otherwise, invoke `palantir-foundry-noo-implementation` when an operational layer applies.
