---
name: palantir-foundry-ontology-implementation
description: Implement or maintain the Foundry Ontology seam with SuperRepo Ontology-as-code, imports, modeling, Functions, and Marketplace mappings. Use when approved data and ownership contracts require Ontology changes.
---

# Foundry Ontology implementation

Invoke `palantir-foundry-tools` first. Use SuperRepo for each supported Ontology-as-code and Function component.

## Preconditions

Require an approved Ontology seed, Solution Designer, architecture, project topology, SuperRepo enrollment, and isolated target. For dataset-backed resources, require a published and development-installed Data-product version. Block work without a working Orthanc profile. Block completion without one. Block implementation when a required Output, key decision, Maker capability, or target Ontology is unavailable.

## Maintenance fast path

For a bounded change in an existing implementation, inspect only the affected model, dependency, and test seam. Make the smallest reversible change. Complete when the requested artifact exists, focused repository tests pass, and Foundry read-back passes when a Foundry resource changed. Apply architecture, Solution Designer, bundle, install, approval, and promotion gates only when the task changes those lifecycle stages.

## Process

1. **Ground and reconcile.** Load the [modeling and verification rules](references/modeling-and-verification.md). Load current official guidance for Ontology, Functions, testing, imports, Maker, preview, bundling, and deployment. Search existing Ontology resources and Functions. Inspect SOO schemas, keys, lineage, API names, and dependencies. Trace each seed candidate to a committed workflow and requirement. Reject speculation. Resolve each candidate as an external import or SuperRepo-owned resource. Select its supported datasource. Approve stable namespaced API names. Update Solution Designer. Check dependencies before mutation. Record partial `orthanc dependency` coverage before mutation.

2. **Import dependencies.** Before the first import, bundle, or install operation, load the [SuperRepo Marketplace lifecycle](../palantir-foundry-tools/references/superrepo-marketplace-lifecycle.md). Follow its mechanics. Import every directly used existing entity supported by current tooling. Commit generated types and import locks. Keep imports externally owned. Classify imports as Marketplace Inputs. An import does not transfer ownership or define an Output.

3. **Fix ownership and mappings.** Give every directly used resource an approved ownership/datasource matrix row. Map imported entities and backing datasets to expected Inputs. Map code-defined owned entities to expected Outputs. Record environment mappings. Block deployment when expected and generated product metadata differ.

4. **Implement the model.** Declare the `ONTOLOGY` component in `foundry.yml`. Define every owned supported Ontology entity in `ontology.mts`. Include Object Types, properties, Link Types, Action Types, Interfaces, and other entities. Use `ontology.mts` as their sole source of truth. Back each dataset Object Type with its approved SOO Output and Marketplace Input. Define Maker dataset placeholders and datasource mechanisms. Align property API names with SOO columns unless a documented supported mapping applies. Keep imported resources external.

5. **Implement behavior.** Select a supported Link mechanism for each cardinality. Define Action references in `ontology.mts`. Put TypeScript v2 Function implementations in the Functions component. Prefer direct object and Link edits when sufficient. Define validation, side effects, permissions, failure, retry, and idempotency behavior. Use AIP Logic or Automate only as documented native-component exceptions.

6. **Create deterministic preview fixtures.** Add seed `.mts` fixtures or create Actions for representative objects and Links. Verify keys, required properties, cardinalities, and reset behavior. Separate fixtures from deployed data and secrets.

7. **Verify locally.** Run repository-defined type-check, build, test, and preview commands. Verify Objects, Links, Interfaces, Actions, Functions, workflows, and OSDK API names against the embedded Ontology. Mark preview evidence provisional.

8. **Bundle and install.** Build an explicit Marketplace artifact per the lifecycle reference. Reconcile generated Inputs and Outputs with the matrix. Configure `env.yml` Input mappings. Install the artifact into the development target. Monitor the installation.

9. **Read back.** Verify installed mappings, schemas, keys, nullability, Links, Interfaces, API names, resources, locks, and OSDK behavior. Run installed Action, Function, traversal, workflow, and read-back tests. Block promotion on any ownership or mapping mismatch.

10. **Document and promote.** Update `README`, `CHANGELOG`, Notepad, and Solution Designer. Include ownership, imports, datasources, environment mappings, API names, Functions, Actions, tests, and overwrite behavior. Obtain branch or proposal approval before maturity-appropriate promotion.

## Implementation ledger

Return one ledger covering seed disposition; ownership/datasource rows; imports and locks; owned code; Functions; API names; dataset and Link mechanisms; fixtures and evidence; artifact; Inputs, Outputs, and `env.yml` mappings; installed read-back; documentation; approval; promotion; and tool evidence.

## Completion gate

Complete only when every supported direct dependency is imported and external; every owned supported entity is in `ontology.mts`; every matrix row is approved; expected and generated Inputs/Outputs match; mappings, keys, properties, Links, Interfaces, Actions, Functions, and API names pass concrete tests; deterministic fixtures pass provisional preview tests; explicit bundling and development installation succeed; installed resources, mappings, OSDK behavior, and workflows pass read-back; and documentation, Solution Designer, approval, promotion, and overwrite warnings are current.

Invoke `palantir-foundry-noo-implementation` after this gate passes when NOO applies.
