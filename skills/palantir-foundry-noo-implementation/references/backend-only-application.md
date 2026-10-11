# Backend-only application

Load this reference only when the delivered application is a non-user-facing service or daemon. A user-facing frontend that calls TypeScript v2 Functions belongs in the client-facing branch.

## Boundary and prerequisites

Require the repository, approved runtime and deployment boundary, Developer Console, and the APIs, SDKs, and resources the service consumes. Require SuperRepo, Ontology, or OSDK only when the service uses them.

Configure one Developer Console Backend service application. Developer Console supplies the authorization client; it does not host the server runtime. Record the runtime owner and deployment owner.

## Authorization and implementation

Configure client credentials or the approved grant. Configure the service-user identity when applicable. Grant explicit data and Action permissions. Grant the requested scopes. Configure organization sharing when applicable. Verify the intersection of identity permissions and application restrictions.

Implement secure token acquisition. Validate the audience and scope. Handle expiry, reacquisition, and revocation. Capture a new client secret once. Store it in the approved secret system. Define rotation and client-update procedures. Redact tokens, secrets, sensitive errors, and data from logs.

Define input, output, validation, error, retry, idempotency, timeout, and rate-limit behavior. Use exact API names and generated types where applicable. Keep confidential client secrets outside all frontend code.

## Verification

Run unit and integration tests in the service runtime. Test positive and negative authorization, insufficient scopes, restriction denial, token expiry, reacquisition, revocation, retries, duplicate requests, timeouts, rate limits, and redaction.

Run installed-development tests against real credentials, permissions, restrictions, exact installed API names, parameter remapping, and the deployed runtime. Exercise one representative end-to-end service workflow. Keep these results separate from mocks or local tests.

Complete this branch only when the approved runtime operates outside Developer Console hosting, the one Backend service application uses least privilege, secret lifecycle and redaction controls pass, positive and negative authorization pass, and installed execution succeeds.
