---
name: palantir-foundry-noo-implementation
description: Implement or maintain a Foundry operational application, workflow, service, or daemon. Use when an approved design requires client-facing SuperRepo delivery, backend-only authorization, or Foundry-native NOO components.
---

# Foundry NOO implementation

Invoke `palantir-foundry-tools` first. Put every supported pro-code Ontology definition in SuperRepo. Put each TypeScript v2 Function in SuperRepo. Put each frontend component in SuperRepo.

## Preconditions

Require approved requirements, architecture, project setup, Solution Designer, applicable SOO and Ontology stages, user journeys or service contracts, and an isolated development target.

Select the branch before enforcing technical prerequisites:

- **Client-facing:** Require SuperRepo, the required Ontology, OSDK, and Developer Console. Load [client-facing-application.md](references/client-facing-application.md).
- **Backend-only:** Require the repository, runtime, Developer Console, and only the APIs that the service uses. Require SuperRepo, Ontology, or OSDK only when used. Load [backend-only-application.md](references/backend-only-application.md).

Load [common-verification.md](references/common-verification.md) for either branch. Use the shared [SuperRepo and Marketplace lifecycle](../palantir-foundry-tools/references/superrepo-marketplace-lifecycle.md). Apply it to common component, product, store, bundle, install, and upgrade mechanics.

## Maintenance fast path

For a bounded change in an existing implementation, inspect only the affected application or service seam and its direct dependencies. Make the smallest reversible change. Complete when the requested artifact exists, focused tests pass, and affected installed behavior passes read-back when a Foundry resource changed. Apply architecture, Solution Designer, bundle, install, approval, and promotion gates only when the task changes those lifecycle stages.

## Branch invariants

Use one client-facing Developer Console application for each installed client-facing `APP` product. TypeScript v2 Functions are server-side logic. Their use does not make the application a Backend service. Use one Developer Console Backend service application only for a non-user-facing service or daemon.

Route batch or sync ingestion from an external API to an SOO Data Connection. Keep an interactive external API call in NOO when an approved Action or Function uses a configured external source. The external source is not the application backend.

Use Workshop, Automate, AIP Logic, or Notepad outside SuperRepo only when current component coverage requires a Foundry-native exception. Record capability evidence, resource identifier, owner, dependency, test, and Solution Designer node.

## Workflow

1. **Ground.** Load current official documentation for SuperRepo, OSDK, TypeScript v2 Functions, Developer Console application types, authorization, restrictions, hosting, preview, and Marketplace installation. Search existing applications, Functions, Ontology entities, Automations, and Workshop resources. Inspect installed API names, types, restrictions, and dependencies. Use `orthanc dependency` before each supported mutation. Finish this stage when the evidence identifies the supported command surface. The evidence must also identify existing resources.

2. **Select.** Choose the client-facing branch for a frontend that uses OSDK and Functions. Choose the backend-only branch only for a service or daemon without a user-facing client. Record the application type, runtime, hosting, authorization, and rejected branch. Finish when one boundary is unambiguous.

3. **Reconcile.** For client-facing work, align `ontology.mts`, import locks, owned definitions, and generated OSDK bindings. Cover every direct query, traversal, Action, and Function dependency. For backend-only work, inspect only consumed Foundry and external APIs, SDKs, resources, and restrictions. Finish when direct dependency coverage passes.

4. **Implement.** Build supported Functions in SuperRepo. Define input, output, validation, error, timeout, retry, and idempotency contracts. Connect Functions to Actions and workflows. Follow the selected branch reference. Apply its requirements for the interface or service runtime, authorization, secrets, and tests. Finish when branch tests pass.

5. **Verify locally.** Apply the common verification reference. Run lint, accessibility checks when applicable, unit tests, integration tests, production builds, and local preview. Treat embedded local preview as an approximation, not installed evidence. Finish when local checks pass and limitations are recorded.

6. **Bundle and install.** Follow the shared lifecycle reference. Create the Marketplace store artifact. Create the explicit bundle. Do not treat deployment as implicit bundling. Install the artifact in the development target. Monitor the installation to a terminal state. Finish when artifact, semantic version, command evidence, and successful installation are recorded.

7. **Verify installed behavior.** Test the selected Developer Console application, authorization, and restrictions. Test exact source-to-installed API-name mappings and parameter remapping. Test Marketplace Inputs and Outputs. Test the end-to-end workflow. Keep installed-enrollment results separate from local-preview results. Finish when the installed smoke test passes.

8. **Document and promote.** Update `README`, `CHANGELOG`, Notepad documentation, and Solution Designer. Record dependencies, Functions, application type, restrictions, environment inputs, tests, recovery, and secret rotation when applicable. Obtain approval. Promote to the engagement target. Monitor its first smoke test.

## Implementation ledger

Return one ledger with dependency coverage, imports, Functions, application branch, Developer Console type and authorization, native exceptions, local and installed tests, Marketplace artifact and installation evidence, exact API-name and parameter assertions, documentation, approval, promotion, recovery, and Palantir tool evidence.

## Completion gate

Complete the stage only when every applicable gate passes: selected-branch dependency coverage; Function unit and Action integration tests; frontend or backend-only deliverable; correct Developer Console type; least-privilege authorization and secret controls; native-exception ownership and tests; distinct local and installed tests; production build; explicit bundle; successful development installation; exact API-name and parameter verification; installed end-to-end smoke test; current documentation, Solution Designer, approval, promotion, and recovery evidence.
