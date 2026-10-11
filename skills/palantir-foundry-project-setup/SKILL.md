---
name: palantir-foundry-project-setup
description: Establish Foundry projects, repositories, stores, product topology, and SuperRepo scaffolding for an approved solution. Use before implementation when ownership, release, installation, or product boundaries must be fixed.
---

# Foundry project setup

Invoke `palantir-foundry-tools` first. Apply its [shared execution policy](../palantir-foundry-tools/references/execution-policy.md). Use this skill only to create topology and scaffolding. Use later implementation stages to build products. Use those stages to bundle, install, and smoke-test products.

## Process

1. **Verify the handoff.** Require an approved architecture and its Solution Designer identifier. Use current MCP documentation to confirm SuperRepo availability, enrollment, and component coverage. Record beta, preview, and unsupported-component constraints. Stop if the approved topology is missing.

2. **Inventory implementation units.** Classify every component as SOO, owned Ontology, imported Ontology, NOO, client-facing application, backend-only service, or Foundry-native exception. Record its owner, permissions, release cadence, installation target, and product boundary.

3. **Choose products.** Default to two linked products:
   - A Data product that outputs stable curated datasets.
   - A downstream SuperRepo product that takes those datasets as Inputs and contains supported owned Ontology resources, TypeScript v2 Functions, and pro-code frontends.

   Split Ontology and application products only when ownership, release, reuse, permissions, or compatibility differ. For every product, record owner, semantic-version policy, installation mode, target, and expected Inputs and Outputs. Use major versions for breaking Output changes. Plan upstream publication before downstream bundling. Plan downstream repackaging after a breaking upstream change. Apply the shared [SuperRepo and Marketplace lifecycle policy](../palantir-foundry-tools/references/superrepo-marketplace-lifecycle.md).

4. **Choose source boundaries.** Use one source project when ownership, permissions, markings, and release cadence align. Split projects when they do not. Use one Marketplace store by default so linked products can be discovered automatically. Use a one-way cross-store link only for a governance or reuse boundary. A product does not require a dedicated project.

5. **Create the scaffold.** Create the approved source projects, Code Repositories, store, and supported SuperRepo components. In each repository, include `README`, durable documentation, and `CHANGELOG`. Include solution-specific source, test, configuration, and deployment folders. Record external product seams and internal module seams. Create environment-input templates that contain neither client secrets nor fixed source-environment identifiers.

6. **Plan Ontology ownership.** Model each directly used existing entity as an imported resource and Marketplace Input. Model each new supported entity as owned in `ontology.mts`. Model it as an expected Output. Give each dataset-backed owned Object Type a Data-product dataset Input. Select a supported Link mechanism for every Link Type. Keep Function implementations in the Functions component. Keep Function-backed Action definitions in the Ontology component.

7. **Plan delivery interfaces.** For a custom frontend, plan an `APP` component plus one installed, client-facing Developer Console application. Keep its supported TypeScript v2 Functions in the same SuperRepo. A frontend that calls Functions remains client-facing; it does not require a Backend service application. Plan one non-user-facing Developer Console Backend service application only when the delivered application is a backend-only service or daemon.

8. **Set the API boundary.** Route batch and synchronization ingestion through an SOO Data Connection. For interactive calls, plan the configured external source. Plan the NOO Function or Action workflow. Defer OAuth, restrictions, API-name preservation, hosting, secrets, and runtime verification to NOO implementation.

9. **Record native exceptions.** Evaluate AIP Logic, Automate, Workshop, and Notepad only from committed use cases. For each component outside current SuperRepo coverage, record why it is native, its owner, resource location, dependency, and implementation-stage test.

10. **Update the design.** Add projects, repositories, store, product graph, Inputs, Outputs, and targets to Solution Designer. Add SuperRepo components, authorization boundaries, environment templates, exceptions, and owners.

## Setup ledger

Return one ledger with the inventory; project, repository, and store maps; product graph; expected Inputs and Outputs; SuperRepo scaffold; owned/imported Ontology plan; application boundaries; API boundary; native exceptions; environment templates; downstream handoffs; Solution Designer identifier; and tool evidence.

## Completion gate

Complete setup only when the approved projects, repositories, store, and scaffold exist and every planned boundary, owner, version, target, dependency, exception, and environment template is explicit and internally consistent. Keep installation, bundling, application smoke tests, and runtime verification outside this gate. Hand off to SOO when it applies. Otherwise, hand off to Ontology when a seam applies. Otherwise, hand off to NOO when an operational layer applies. Stop after setup when no implementation stage applies.
