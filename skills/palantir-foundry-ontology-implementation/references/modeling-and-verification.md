# Ontology modeling and verification rules

Load this reference when defining or testing Ontology resources.

## Ownership and datasource matrix

Create one row for each directly used resource. Record its identifier, API name, kind, and ownership. Record its datasource mechanism and backing Data-product Output or external dependency. Record its expected and generated Marketplace Input/Output classification. Record its environment Input mapping and test evidence.

An import remains externally owned and must produce an expected Input. Owned code must produce an expected Output. Block deployment on a mismatch. Functions belong in the TypeScript Functions component; the Ontology component contains only the Function-backed Action definition.

## Object Types and datasources

Define each Object Type's display and plural names, description, stable API name, primary key, and title property. Define its properties, datasource, Links, Interfaces, Actions, and Functions. Verify each definition.

For a dataset datasource, use the Ontology-as-code placeholder that Marketplace maps during installation. Align SOO columns with property API names. Use another mapping only when current Maker documentation supports it. Record the alternative mapping. Verify the dataset Input, environment mapping, schema, nullability, primary-key presence/non-nullness/uniqueness, and branch or version behavior.

For a stream, restricted view, direct, derived, edit-only, empty, or other mechanism, verify current Maker support. Record its exact contract. Classify each non-dataset resource by its actual mechanism.

## Links, Interfaces, and Actions

Choose a supported Link mechanism. For one-to-one and one-to-many Links, define the applicable foreign-key relationship. Test the relationship. Include `manyForeignKeyProperty` when Maker requires it. For many-to-many Links, use a supported join, empty/editable datasource, or intermediary object. A generic dataset mapping is not a valid substitute. Verify directional API names, cardinality, orphan behavior, key compatibility, and traversal both ways.

Use an Interface when multiple Object Types implement a shared workflow contract. Verify shared required properties and implementation compatibility.

For each Action, define its actor, inputs, validation, and object and Link edits. Define its Function-backed logic, submission criteria, failures, side effects, notifications, and permissions. Verify each definition. Test allowed, denied, invalid, boundary, retry, idempotency, edit-batch, and partial-failure cases when applicable.

## API names and imports

Treat API names as compatibility contracts. Search before assignment. Preserve existing names. Verify generated OSDK names and exact source-to-installed names. Apply the approved namespace and Marketplace preservation controls.

Run `foundry import ontology` for each directly used existing entity that current tooling supports. The entity must be referenced through generated bindings by a SuperRepo component. Commit generated OSDK types and import locks. Imports stay external dependencies and Inputs; they never transfer definition ownership or become Outputs. Import transitive resources only when directly referenced or tool-required.

## Preview fixtures and verification

The embedded preview Ontology has no enrollment data. Create deterministic seed `.mts` fixtures or invoke create Actions for local objects and Links. Verify unique keys and required non-null properties. Define reset and restart behavior. Keep fixtures separate from deployed data and secrets.

Run repository-defined checks for Ontology type-check/compilation; Function units; OSDK mocks; fixture loading; key collision/nulls; property type/nullability drift; Link cardinality/orphans/direction/traversal; Interface compatibility; Action authorization/validation/edit-batch/retry/idempotency/partial failure; OSDK API-name assertions; bundle contents; installation Input mappings; and installed resource read-back.

Preview evidence is provisional. Require development-installation tests in Foundry before promotion.
