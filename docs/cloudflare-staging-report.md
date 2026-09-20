# Cloudflare staging evidence report

Status: blocked at the isolated VibeSDK data/bootstrap gate. The control plane is deployed, but the full acceptance test has not passed.

## Safety gates
- [x] `buildcustom.ai`, marketing Pages, DNS, and `app.buildcustom.ai` unchanged
- [x] Existing gateway, production route KV, generated Workers, SaaS hostnames, and customer DNS unchanged
- [x] Staging runtime has no production Cloudflare mutation credential and uses isolated D1, KV, R2, Durable Objects, and dispatch namespace

## Compatibility
- SDK bundle / Worker Node compatibility: control-plane Worker and the copied VibeSDK Worker both deploy with `nodejs_compat`; the isolated runtime health endpoint responds successfully.
- Runtime authentication / realtime: blocked. The VibeSDK bundle does not include/apply its D1 schema migrations to a fresh database. API-key exchange therefore cannot authenticate in the isolated clone, and no production VibeSDK data or credential was copied.
- Workflow retry and cancellation: async operation state and cancellation endpoints are implemented; deployed runtime verification remains pending.
- Durable Object serialization / stale lease recovery: persisted per-project leases, conflicts, alarms, and expiry are implemented and covered by unit tests.

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

## Unresolved gates
1. Obtain the canonical VibeSDK D1 migration set and apply it to `buildcustom-vibesdk-migration-staging-db`.
2. Create a staging-only VibeSDK API key in that isolated database and rerun SDK authentication, WebSocket, cancellation, Workflow, retry/idempotency, build, preview, restore, and staging publish checks.
3. Port the remaining Express project/files/settings routes to the Cloudflare Worker. The current deployed Worker implements sessions and asynchronous operation endpoints, but the full dashboard API is not yet available.
4. GitHub synchronization remains blocked because the configured GitHub credential was rejected twice. Local history remains 86 commits ahead of `origin/main`; no history was rewritten.

## R2 decision
The largest current control-plane binary field is a 93,443-byte preview image. It is safe for the present small D1 staging copy, so no control-plane R2 bucket was created. The R2 bucket listed above belongs only to the isolated VibeSDK template/runtime clone.

## Production attachment plan
After all staging checks pass and the owner separately approves production: deploy the reviewed artifact with production bindings, perform a final verified data copy, attach only `app.buildcustom.ai` to the production control-plane Worker, verify login/project/runtime/publish flows through that hostname, and then run the Replit-independence test. `buildcustom.ai`, its Pages site, `*.apps.buildcustom.ai`, the gateway, SaaS hostnames, and customer DNS remain unchanged.

## Replit-independence test
With production approval and rollback readiness: disable Replit application traffic and database access without deleting either; verify login, dashboard, projects, files, plan/build, previews, revisions, restore, publish, managed subdomains, Buyer Magnets hostnames, durable state, and restart recovery through Cloudflare; observe before deciding whether Replit can be retired.

## Acceptance
Record each owner-approved acceptance check with timestamp, environment, and redacted evidence. Do not include passwords, hashes, tokens, or unnecessary personal information.