# Cloudflare staging evidence report

Status: the simplified staging control plane is deployed and the isolated acceptance flow has passed. Open registration is closed, runtime operations remain available to existing staging users, and publishing is restricted to the canonical `super_admin` role after the one-time acceptance publish.

## Safety gates
- [x] `buildcustom.ai`, marketing Pages, DNS, and `app.buildcustom.ai` unchanged
- [x] Existing gateway, production route KV, generated Workers, SaaS hostnames, and customer DNS unchanged
- [x] Staging runtime uses isolated D1, KV, R2, and dispatch namespace resources
- [x] The Workers publishing credential is attached only to the trusted isolated VibeSDK staging Worker, never to the control-plane browser bundle, generated applications, user-controlled code, logs, or responses
- [x] Owner accepted the normal same-account, server-side Workers for Platforms credential model; namespace-level token isolation is not required

## Compatibility
- SDK bundle / Worker Node compatibility: control-plane Worker and the copied VibeSDK Worker both deploy with `nodejs_compat`; the isolated runtime health endpoint responds successfully.
- Runtime authentication / realtime: passed using a staging-only identity and API key. The canonical migrations from Cloudflare's public `cloudflare/vibesdk` repository at commit `9da158d82c597a0e8f4bf033cdccd1053fb6fb15` were applied only to the isolated VibeSDK D1 database.
- Runtime templates: passed after generating the canonical `cloudflare/vibesdk-templates` catalog at commit `7ea201fafdef44f5dcc5bc05f03b36e3198cebe5` and uploading it only to the isolated staging R2 bucket.
- Runtime plan/build/edit: passed through the control plane using a staging-created project. Plan-only runs on an isolated ThinkAgent seeded with a bounded snapshot of the authoritative workspace, returned a complete non-streaming plan, and cannot mutate the project agent. Initial build generated four files, and a follow-up edit changed the existing workspace.
- Runtime preview: passed with a protected tokenized preview. A request without its access token was denied as expected.
- Runtime cancellation: the direct isolated-runtime test reached `stopped`; control-plane stop requests were accepted. The small acceptance app completed too quickly to reproduce a second terminal `stopped` event through concurrent HTTP requests.
- Runtime restore: passed using the revision returned by VibeSDK's live deployment event; the restored workspace reconnected with four files.
- Runtime publish: passed through VibeSDK's supported `deploy` protocol. The published staging route returned HTTP 200 under `/deployed/` on the isolated runtime. The control plane now rejects non-admin publish attempts, validates the returned origin/path, and requires a runtime-issued restorable revision before recording a release.
- Worker-to-Worker transport: the public `workers.dev` call returned Cloudflare 1042 from inside another Worker. The final implementation uses a Cloudflare service binding for authenticated HTTP and WebSocket upgrades, while keeping VibeSDK/ThinkAgent authoritative.
- Workflow/project Durable Object simplification: completed for the active Worker path. The current VibeSDK reconnect-by-`agent_id` protocol is the durable boundary; historical Workflow/DO source remains only for audit and is no longer bound or invoked.
- Durable Object serialization / stale lease recovery: no duplicate project coordinator is active. The prior lease implementation remains historical and its tests are retained for audit context.

## Data and authentication
- Authoritative source: confirmed Replit development database. Project 2 (`Test1`) owns the persisted VibeSDK agent, `taskflow---task-management-dashboard`, hosted slug `test1`, and the live Buyer Magnets apex, redirect, and app-hostname mappings.
- D1 row-count / FK verification: 4 users, 3 projects, 2 runtime links, 9 builder turns, and 6 releases; `PRAGMA foreign_key_check` returned no violations.
- Session, revocation, Origin, and ownership: opaque hashed sessions, HttpOnly cookies, logout revocation, exact Origin validation, nested runtime-route ownership lookup, and browser-supplied identity rejection are implemented. The browser no longer sends the legacy `x-user-id` header and relies only on the secure session cookie. Path and boundary helpers are covered by tests. Live unauthenticated access returned 401, a foreign Origin returned 400, and an injected `x-user-id` identity header returned 400.
- Runtime status is explicitly allowlisted and excludes generated source maps, file-serving tokens, credentials, command history, sandbox identifiers, and raw hydrated agent state.
- Frontend response compatibility: live project, turn-history, and release-history responses use camelCase fields; turn `changedFiles` and `activity` are decoded arrays rather than D1 JSON strings.
- Canonical role check: a temporary hashed staging session confirmed `super_admin` passed the publish role gate to downstream agent validation, while an ordinary user received HTTP 403. The temporary session rows and project were removed immediately.

## Created isolated resources
- D1 `buildcustom-control-plane-staging`
- D1 `buildcustom-vibesdk-migration-staging-db`
- KV `buildcustom-control-plane-staging-routes`
- KV `buildcustom-vibesdk-migration-staging-kv`
- R2 `buildcustom-vibesdk-migration-staging-templates`
- dispatch namespace `buildcustom-vibesdk-migration-staging`

No route, DNS, SaaS hostname, certificate, existing Worker, existing KV namespace, or generated customer application was modified.

## Deployed staging services
- Control plane: `https://buildcustom-control-plane-staging.thegoldimport.workers.dev`
- Isolated VibeSDK clone: `https://buildcustom-vibesdk-migration-staging.thegoldimport.workers.dev`
- Control-plane Worker version: `b1521315-534f-4336-86af-23d9fdd9dffe`

The control plane serves the existing frontend, rejects missing or foreign Origins for state changes, stores opaque session hashes in D1, and keeps imported production agent mappings read-only for every mutation method. Existing staging users can log in and use runtime operations. Open registration is disabled. Publishing is restricted to `super_admin` after the acceptance publish.

## Remaining external gate
GitHub synchronization remains blocked because the configured GitHub credential was rejected. Local history remains ahead of `origin/main`; no history was rewritten.

## Same-account server-side publishing decision
The owner accepted Cloudflare's normal Workers for Platforms model: staging and
production use separate dispatch namespaces in the existing account, and a
trusted server-side VibeSDK deployment path may hold the account-scoped
Workers publishing credential required by Cloudflare. Cloudflare does not
provide namespace- or script-scoped Workers Scripts Write tokens, but that is
no longer a staging acceptance blocker.

VibeSDK's platform publish path performs:

1. `POST /accounts/{account_id}/workers/dispatch/namespaces/{namespace}/scripts/{script_name}/assets-upload-session` when static assets exist.
2. `POST /accounts/{account_id}/workers/assets/upload?base64=true` with the short-lived upload JWT returned by the first call.
3. `PUT /accounts/{account_id}/workers/dispatch/namespaces/{namespace}/scripts/{script_name}` with the Worker module, bindings, assets token, and optional Durable Object migration.

The dispatch script upload and asset-session APIs require `Workers Scripts
Write` (`Workers Scripts Edit` in the API-token permission list). Cloudflare
documents this as an account-scoped permission under
`com.cloudflare.api.account`. The simplified implementation will use the
supported VibeSDK deployment path directly, with server-side secret handling,
staging namespace/script validation, project authorization, and redacted
observability. No generic publish broker is planned.

## R2 decision
The largest current control-plane binary field is a 93,443-byte preview image. It is safe for the present small D1 staging copy, so no control-plane R2 bucket was created. The R2 bucket listed above belongs only to the isolated VibeSDK template/runtime clone.

## Production attachment plan
After all staging checks pass and the owner separately approves production: deploy the reviewed artifact with production bindings, perform a final verified data copy, attach only `app.buildcustom.ai` to the production control-plane Worker, verify login/project/runtime/publish flows through that hostname, and then run the Replit-independence test. `buildcustom.ai`, its Pages site, `*.apps.buildcustom.ai`, the gateway, SaaS hostnames, and customer DNS remain unchanged.

## Replit-independence test
With production approval and rollback readiness: disable Replit application traffic and database access without deleting either; verify login, dashboard, projects, files, plan/build, previews, revisions, restore, publish, managed subdomains, Buyer Magnets hostnames, durable state, and restart recovery through Cloudflare; observe before deciding whether Replit can be retired.

## Acceptance
Accepted in isolated staging on 2026-09-20, with final response-contract and canonical-role verification on 2026-09-22. Evidence covers authentication, ownership boundaries, plan/build/edit, files, protected preview, cancellation command, native publish, published-route reachability, revision restore, D1 integrity, secret placement, browser-bundle leakage, frontend response shapes, and publish-role enforcement. No passwords, session values, API keys, or publishing tokens are recorded here.