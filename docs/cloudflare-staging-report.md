# Cloudflare staging evidence report

Status: implementation and staging verification are in progress. The control plane is deployed, but the simplified architecture and full acceptance test have not yet passed.

## Safety gates
- [x] `buildcustom.ai`, marketing Pages, DNS, and `app.buildcustom.ai` unchanged
- [x] Existing gateway, production route KV, generated Workers, SaaS hostnames, and customer DNS unchanged
- [x] Staging runtime uses isolated D1, KV, R2, and dispatch namespace resources
- [ ] Any Workers publishing credential is attached only to trusted server-side platform code, never to browsers, generated applications, user-controlled code, logs, or responses
- [x] Owner accepted the normal same-account, server-side Workers for Platforms credential model; namespace-level token isolation is not required

## Compatibility
- SDK bundle / Worker Node compatibility: control-plane Worker and the copied VibeSDK Worker both deploy with `nodejs_compat`; the isolated runtime health endpoint responds successfully.
- Runtime authentication / realtime: passed using a staging-only identity and API key. The canonical migrations from Cloudflare's public `cloudflare/vibesdk` repository at commit `9da158d82c597a0e8f4bf033cdccd1053fb6fb15` were applied only to the isolated VibeSDK D1 database.
- Runtime templates: passed after generating the canonical `cloudflare/vibesdk-templates` catalog at commit `7ea201fafdef44f5dcc5bc05f03b36e3198cebe5` and uploading it only to the isolated staging R2 bucket.
- Runtime build: passed on staging-created agent `c1d23656-cbe1-4d31-a646-b5a65be19913`; generation completed with three files and no runtime error.
- Runtime preview: passed with a protected tokenized preview. A request without its access token was denied as expected.
- Runtime cancellation: passed on staging-created agent `c6bc7d2a-0af9-49a5-ae60-17b24c1b8740`; generation reached `stopped`.
- Runtime publish: implementation and staging verification are pending under the owner's accepted same-account server-side credential model. VibeSDK's supported platform path requires account credentials for dispatch upload; the credential must remain server-side and staging target checks must be enforced by the adapter.
- Workflow/project Durable Object simplification: completed for the active Worker path. The current VibeSDK reconnect-by-`agent_id` protocol is the durable boundary; historical Workflow/DO source remains only for audit and is no longer bound or invoked.
- Durable Object serialization / stale lease recovery: no duplicate project coordinator is active. The prior lease implementation remains historical and its tests are retained for audit context.

## Data and authentication
- Authoritative source: confirmed Replit development database. Project 2 (`Test1`) owns the persisted VibeSDK agent, `taskflow---task-management-dashboard`, hosted slug `test1`, and the live Buyer Magnets apex, redirect, and app-hostname mappings.
- Export manifest:
- D1 row-count / FK verification:
- Session, revocation, Origin, and ownership tests: secure opaque hashed sessions, HttpOnly cookie, logout revocation, exact Origin validation, and project ownership checks implemented.

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
- Control-plane Worker version: `36bb8ea4-7fb6-4c27-8831-caf1311ec3b1`

The control plane serves the existing frontend, rejects missing or foreign Origins for state changes, stores opaque session hashes in D1, and keeps the imported production agent mapping read-only. Login and runtime operations are deliberately disabled until the remaining acceptance gates pass, so copied credentials and incomplete runtime operations are not internet-accessible. The authoritative snapshot imported 38 rows. Verification found 2 users, 2 projects, 1 runtime link, 3 domain claims, 5 releases, 3 builder turns, 1 imported agent, and zero foreign-key violations.

## Current implementation gates
1. Attach only the minimum server-side VibeSDK API key needed for staging and verify it is absent from browser bundles, generated applications, logs, and responses.
2. Run the live authenticated control-plane acceptance flow: project creation/agent claim, plan/build/edit, files, preview, cancellation, revision/restore, and supported publish.
3. Verify the staged deployment target and dispatch namespace with a staging-created application; no production resource may change.
4. GitHub synchronization remains blocked because the configured GitHub credential was rejected. Local history remains ahead of `origin/main`; no history was rewritten.

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
Record each owner-approved acceptance check with timestamp, environment, and redacted evidence. Do not include passwords, hashes, tokens, or unnecessary personal information.