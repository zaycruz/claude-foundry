# SuperRepo and Marketplace lifecycle

Use this policy for every SuperRepo development, bundle, deployment, or installation operation.

## Authority and preflight

The official project-local `foundry` CLI is the authority for SuperRepo creation, local preview, Ontology imports, supported component development, repository builds, Marketplace bundling, validation, deployment configuration, upload, installation, and job monitoring.

1. Run the project-local `foundry --help` before choosing commands.
2. Use the project-local CLI version and repository templates.
3. Check current MCP documentation for the selected lifecycle operation.
4. Confirm beta enrollment and component coverage before implementation.

Use only commands that project-local help and current MCP documentation expose. These commands can include `foundry install`, `foundry build`, `foundry validate`, or explicit OSDK generation.

## Bundle rules

Select the bundle form from current project-local help and official documentation:

- Current public documentation uses `foundry bundle --project-version <SEMVER>` for a single-product artifact.
- Current public documentation uses `foundry bundle product` followed by `foundry bundle store` for a multi-product artifact.

Treat these spellings as documentation evidence, not a substitute for local help. Require an explicit store artifact before deployment. Do not infer that `foundry deploy` creates a bundle.

## Deployment and installation

Use only lifecycle commands exposed by the project-local CLI and supported by current MCP documentation. Configure deployment against the explicit store artifact. Upload that artifact when the upload step is available. Install it with the supported command when installation is available. Monitor the resulting job when monitoring is available. Read back the installed product or deployment state. Run the applicable validation or smoke test.

No other tool can replace an official SuperRepo build, bundle, deployment, or installation command. If the official CLI is unavailable, or enrollment or component coverage is insufficient, block SuperRepo implementation and deployment. Record the blocking constraint instead of improvising an alternate path.
