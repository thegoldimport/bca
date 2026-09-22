# Cloudflare production preparation

Status: **NO-GO for public cutover.** The production control plane and authoritative D1 import are available on a private `workers.dev` canary, but runtime operations remain disabled until the existing production VibeSDK Worker has a reviewed, non-disruptive authenticated transport compatible with the narrow adapter.

## Source and commit

- GitHub `main` is the source of truth.
- Production preparation began from synchronized commit `cdda7b517fae7a2f33d584316513ef7e0474b50b`.
- No force-push or history rewrite was used.

## Production resources created

- Worker: `buildcustom-control-plane-production`
- Canary URL: `https://buildcustom-control-plane-production.thegoldimport.workers.dev`
- Worker version: `74671dfa-5e96-4b8a-a978-1e02479a6c54`
- D1: `buildcustom-control-plane-production`
- D1 ID: `43bb3095-0d1e-4a25-97ef-edbd6c5d6df0`

The Worker has no custom route and `app.buildcustom.ai` was not attached.

## Existing resources reused without modification

- Active VibeSDK Worker: `buildcustom-vibesdk-staging` (production despite its historical name)
- Active VibeSDK D1: `buildcustom-vibesdk-staging-db`
- Active VibeSDK KV: `buildcustom-vibesdk-staging-kv`
- Active VibeSDK templates R2 bucket: `buildcustom-vibesdk-staging-templates`
- Active generated-app dispatch namespace: `buildcustom-vibesdk-staging`
- Gateway Worker: `buildcustom-apps-gateway`
- Production route KV: `buildcustom-app-routes`
- Existing generated Workers, custom hostnames, certificates, and customer DNS

## Authoritative data import

The Replit development PostgreSQL database was reconfirmed as authoritative. The Replit database labeled production contains only `users` and `waitlist_entries` and was not used.

Imported row counts:

| Table | Rows |
| --- | ---: |
| users | 2 |
| waitlist_entries | 2 |
| projects | 2 |
| runtime_project_links | 1 |
| runtime_custom_domain_claims | 3 |
| runtime_releases | 5 |
| runtime_builder_turns | 3 |
| blog_posts | 1 |
| autoblogger_settings | 1 |
| seo_settings | 2 |
| site_pages | 1 |
| templates | 15 |

- Total imported rows: 38
- Imported VibeSDK agent mappings marked read-only: 1
- `PRAGMA foreign_key_check`: no violations
- Source export SHA-256: `d0a4a7db0d920604596758b3a7d7ba217fd7ec34df1c606452318f758ffaed8a`

Passwords, hashes, session values, and credentials are not included in this report.

## Canary results

- Frontend assets: HTTP 200
- Hashed cookie session and `/api/auth/me`: HTTP 200
- Canonical camelCase user response: passed
- Project listing: HTTP 200
- Owned project retrieval: HTTP 200
- Cross-user project retrieval: HTTP 404
- Injected `x-user-id`: HTTP 400
- Registration while disabled: HTTP 403
- Runtime status while gate is disabled/unconfigured: HTTP 503
- Temporary canary session: removed after testing
- TypeScript check: passed
- Tests: 74 passed
- Production Worker dry-run/build: passed

## Runtime blocker

The active production VibeSDK Worker responds to `/api/health`, but it does not expose the authenticated transport endpoints proven by the isolated Task #53 runtime. Unknown transport paths fall back to its frontend. Its binding inventory contains `JWT_SECRET` but no `VIBESDK_API_KEY`.

The existing runtime, Durable Object namespaces, workspaces, generated applications, and dispatch infrastructure must not be replaced or modified blindly. Before enabling `RUNTIME_OPERATIONS_ENABLED`, prepare and review an additive transport change that preserves the current Worker bindings and existing Durable Object namespaces, deploy it as a non-serving version where possible, and prove existing agent reconnection before promotion.

## Unchanged protected infrastructure

- `buildcustom.ai` and its marketing site
- `app.buildcustom.ai` DNS and routes
- `*.apps.buildcustom.ai`
- Buyer Magnets hostnames and applications
- Existing gateway and route KV contents
- Existing custom hostnames and certificates
- Existing generated applications
- Replit runtime and database

## Remaining pre-cutover work

1. Add and verify the production VibeSDK authenticated transport without replacing existing workspace state.
2. Provision the matching server-side control-plane credential.
3. Enable runtime operations only after service-binding connectivity passes.
4. Run existing-project reconnect, files, plan, edit, preview, revisions, restore, cancellation, and native publish canaries.
5. Verify generated-app HTTP 200, release metadata, redaction, and browser-bundle credential absence.
6. Complete the Replit runtime-dependency audit and execute the independence test.
7. Prepare the final `app.buildcustom.ai` route change and removal-based rollback procedure.
8. Obtain explicit owner approval before attaching `app.buildcustom.ai`.