# Client-facing application

Load this reference only for a user-facing SuperRepo application.

## Boundary and prerequisites

Require SuperRepo, the required Ontology, generated OSDK bindings, and Developer Console. Declare the frontend in a SuperRepo `APP` component. Configure one client-facing Developer Console application for each installed client-facing `APP` product.

TypeScript v2 Functions are Foundry server-side logic. A frontend that calls Functions remains a client-facing application. Do not add the Backend service application type merely because Functions exist. Current Developer Console behavior removes Foundry website hosting when client-facing and Backend service types are combined into a confidential client.

## Dependencies and implementation

Keep `ontology.mts` aligned with every directly used Ontology entity. Import every directly used existing entity into SuperRepo. Add each approved owned definition. Regenerate or verify OSDK bindings with the repository-supported workflow.

Implement the approved interface. Implement all material loading, empty, error, unauthorized, and success states. Connect the UI to generated OSDK queries, aggregations, Link traversals, Actions, and TypeScript v2 Functions. Keep domain and Ontology logic outside presentation components. Keep secrets, confidential credentials, and embedded enrollment identifiers out of frontend code.

## Verification

Test approved journeys, feedback, responsive behavior, and accessibility. Verify OSDK operations, Actions, Functions, exact API names, generated types, and authorization failures.

Verify OAuth and resource and operation restrictions. Verify the hosting domain, website assets, Content Security Policy, and application sharing. Verify the redirect URL and client ID. Verify the target Foundry URL and Ontology RID. Verify the required `index.html` metadata and parameter remapping. Confirm that source-environment parameters are absent from the installed product.

Run lint, unit, accessibility, component, integration, production-build, and local-preview tests. Run separate installed-development tests. Test real Ontology behavior, restrictions, exact installed API names, website hosting, and the end-to-end workflow.

Complete this branch only when the frontend is connected, the one client-facing application per installed `APP` product is correct, website hosting works, authorized and unauthorized journeys pass, and installed evidence confirms exact API-name mapping and restrictions.
