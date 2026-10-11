# Common verification

Load this reference for both client-facing and backend-only NOO applications.

## Function and dependency checks

Keep supported TypeScript v2 Functions in SuperRepo. Define input, output, validation, error, timeout, retry, and idempotency contracts. Test each contract. Test Function behavior, Action behavior, edit behavior, authorization, and failures.

Treat Ontology API names as compatibility contracts. Verify restriction and operation coverage. Verify exact source-to-installed API-name mappings. Verify the approved namespace and generated types when used. Verify parameter remapping and the applicable Marketplace preservation control. Recheck restriction dependencies after Ontology changes.

## External API boundary

Treat batch or sync ingestion from an external REST API as an SOO Data Connection source. Keep an interactive external API call in NOO when an approved Action or Function uses a configured external source. Do not model the external source itself as the application backend.

## Foundry-native exceptions

Evaluate Workshop, Automate, AIP Logic, and Notepad from committed use cases. Use a component outside SuperRepo only when current SuperRepo coverage requires it. Record capability evidence, owner, resource identifier, dependency, test, and Solution Designer node.

## Local versus installed evidence

SuperRepo local preview uses an embedded Ontology approximation and local seed data. Record whether `platformApiProxy` is required. Review its allowed paths and methods. Proxy access is local-preview behavior, not deployed-product configuration.

Keep local-preview and installed-enrollment results separate. Installed tests must exercise real Ontology behavior when used, application restrictions, exact API names, the selected Developer Console authorization model, and the representative end-to-end workflow.

## Artifact and installation checks

Use the shared [SuperRepo and Marketplace lifecycle](../../palantir-foundry-tools/references/superrepo-marketplace-lifecycle.md) for component, product, store, bundle, installation, and upgrade mechanics.

Before promotion, verify `foundry.yml` components, environment inputs, the project-local Foundry CLI command surface, Marketplace store artifact, semantic version, Product Inputs and Outputs, and explicit bundle evidence. Confirm successful development installation rather than inferring installation from deployment.

Verify the selected Developer Console application type and its authorization configuration. Verify resource and operation restrictions. Verify exact installed API names and parameter remapping. Verify one representative installed workflow. For client-facing work, verify the website domain and assets. For backend-only work, verify credentials and service-user permissions.

Verify upgrade, downgrade, secret rotation when applicable, and recovery paths.

