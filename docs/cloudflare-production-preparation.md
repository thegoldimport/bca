# Cloudflare production preparation

Status: **NO-GO for public cutover.** The private production control plane now connects to the existing production VibeSDK Worker through its already-deployed authenticated transport. A Replit-off independence check passed for the tested operations, but the full independence acceptance cannot pass until restore is correct and the complete checklist is rerun. Public cutover remains blocked because a VibeSDK forward restore redeploys the requested commit but leaves `ThinkAgent.state.generatedFilesMap` stale, so BuildCustom file reads do not reflect the restored `SpaceDO` workspace.

## Source and commit

- GitHub `main` is the source of truth.
- Production preparation began from synchronized commit `cdda7b517fae7a2f33d584316513ef7e0474b50b`.
- No force-push or history rewrite was used.

## Production resources created

- Worker: `buildcustom-control-plane-production`
- Canary URL: `https://buildcustom-control-plane-production.thegoldimport.workers.dev`
- Worker version: `a7e0b81b-c017-4fab-a753-380ccf5b9332`
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

## Production runtime transport

The active production VibeSDK Worker and the isolated staging Worker have the same downloaded bundle ETag, `6f562ac07f0b3d55648838023d7ee9836c2209c6ddc56feff7386a01a2d5501f`. The active bundle already contains the authenticated endpoints required by the narrow adapter:

- `POST /api/auth/exchange-api-key`
- `POST /api/agent`
- `GET /api/agent/:agentId/connect`
- `POST /api/ws-ticket`
- ticket-authenticated WebSocket upgrade to the runtime-returned agent URL

No VibeSDK code deployment or runtime binding change was required. A dedicated API-key hash was added to the existing VibeSDK D1 for its existing production owner, and the raw value was stored only as the `VIBESDK_API_KEY` secret on the production control-plane Worker.

- VibeSDK Worker before: `8522e70c-27f4-4ef3-a46a-80edbd308490`
- VibeSDK Worker after: `8522e70c-27f4-4ef3-a46a-80edbd308490`
- VibeSDK version changed: no
- VibeSDK binding/resource identities changed: no

The following production identities were explicitly compared before and after and remained unchanged:

- `THINK_DO`: `76cfd082b3754a548948cce0029e9846`
- `SPACE_DO`: `8da59df6a1224ce0b5be40147718c001`
- `CodeGenObject`: `cd93fba20da04e2aa3e1b95facdcadf4`
- `Sandbox`: `613edd351c9a4015b0e45aa899589612`
- `DORateLimitStore`: `805cbbd68d6c4db2abb929f6e619cdc1`
- `UserSecretsStore`: `8f901d480f884ff18fbc34676418c5ed`
- D1: `9b8637f3-be5b-461b-8627-b09b03cea180`
- KV: `ce7e7b0ba56343e7b50556b3cabfb53e`
- R2: `buildcustom-vibesdk-staging-templates`
- Dispatch namespace: `buildcustom-vibesdk-staging`

## Production runtime canaries

Existing imported workspace:

- Preserved `agent_id` reconnected: passed
- Runtime connection: connected
- Existing files listed: 5
- Existing file retrieved: passed
- Existing turns: 3
- Existing releases: 5
- Stored historical preview: protected but its old credential has expired, HTTP 401

Dedicated mutable canaries:

- Initial generation: passed
- Plan Mode: passed; full workspace hashes were unchanged
- Conversational edit: passed; 2 files changed and a revision was created
- Protected preview: HTTP 200 with credential, HTTP 401 without credential
- Cancellation: `generation_stopped` acknowledged
- Reconnect after cancellation: passed; idle with files available
- Native VibeSDK publish: HTTP 201
- Generated application: HTTP 200

Runtime mutations were disabled again after the canaries. Read-only existing-agent status, files, turns, publishing settings, and releases remain available through the authenticated canary. All POST/PUT/DELETE runtime operations, including turn and release restore, return HTTP 503 while the gate is closed.

## Remaining runtime blocker

VibeSDK accepted a restore to the initial canary commit and `SpaceDO.rollbackToCommit` created a forward restore and redeployed it. The returned commit matched the requested revision and the restored preview was created.

However, the subsequent authenticated reconnect still returned the pre-restore `generatedFilesMap` from `ThinkAgent.state`. The two edited files remained visible through BuildCustom file reads. The runtime protocol has no supported post-rollback state-refresh barrier: `get_conversation_state` produced no fresh `cf_agent_state` after rollback. A temporary control-plane wait for that event was tested, timed out, and was removed before the final deployment.

Do not represent restore as complete until VibeSDK updates or rehydrates `ThinkAgent.state.generatedFilesMap` after `SpaceDO` forward restore, or exposes a documented authoritative refresh operation.

## Existing application and domain regression

- Active VibeSDK health: HTTP 200
- Existing TaskFlow VibeSDK deployment: HTTP 200
- `test1.apps.buildcustom.ai`: HTTP 200
- `buyermagnets.com`: HTTP 200
- `www.buyermagnets.com`: redirects to the root, final HTTP 200
- `app.buyermagnets.com`: HTTP 200
- `buildcustom.ai`: HTTP 200
- `app.buildcustom.ai`: not attached; no cutover was performed
- Existing VibeSDK Worker version and binding identities: unchanged

## Replit-off independence check

The `Start application` Replit workflow was stopped without deleting or changing the Repl, database, files, or backups. While it was stopped, the Cloudflare system passed:

- frontend and static assets
- login session resolution
- dashboard/project listing
- cross-user ownership rejection
- existing-agent reconnect
- files and turn history
- Plan Mode
- conversational edit
- protected preview
- revisions
- native publish
- generated-application HTTP access
- managed-subdomain routing
- existing custom-domain routing
- Cloudflare D1 persistence

Cancellation had already passed before the workflow was stopped but was not repeated during this Replit-off interval. Restore remained failed and therefore could not pass the independence checklist. This is evidence that the tested paths do not require the Replit application runtime, not a completed full independence acceptance.

The production configuration contains no Replit or localhost runtime reference. Assets are in the Worker bundle, data is in Cloudflare D1, and runtime calls use the Cloudflare service binding. The Replit workflow was restored after the test.

## Rollback status

- VibeSDK Worker rollback is not required because its version never changed.
- Production control-plane version before Task 57: `74671dfa-5e96-4b8a-a978-1e02479a6c54`.
- Final gated production control-plane version: `a7e0b81b-c017-4fab-a753-380ccf5b9332`.
- Runtime mutations are closed again in the final control-plane deployment.
- To revoke transport access, mark the dedicated `BuildCustom production control plane` row in the VibeSDK `api_keys` table inactive, then delete the `VIBESDK_API_KEY` secret from `buildcustom-control-plane-production`.
- The only reviewed rollback-safe control-plane target is the final gated version `a7e0b81b-c017-4fab-a753-380ccf5b9332`. The pre-Task-57 version is recorded for history but must not be restored because its older gate did not block every runtime mutation.
- If the final gated version itself must be replaced, revoke the dedicated transport credential or block the canary before deploying any historical version, then return to a version with the corrected deny-by-default gate before restoring access.
- Do not change the VibeSDK Worker, DO namespaces, D1, KV, R2, dispatch namespace, customer Workers, routes, or domains during rollback.

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

1. Correct VibeSDK restore hydration so file reads reflect the restored `SpaceDO` commit after reconnect.
2. Rerun restore and a subsequent edit from the restored workspace.
3. Reconfirm generated-app HTTP 200 and regression checks after the restore fix.
4. Prepare the final `app.buildcustom.ai` route change and removal-based rollback procedure.
5. Obtain explicit owner approval before attaching `app.buildcustom.ai`.