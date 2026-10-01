# Project 8: existing revision verification and read-only diagnosis

## Overall status: APP EDIT PASS

| Classification | Result |
|---|---|
| GENERATED APP EDIT | **PASS** |
| EDIT + PRIVATE PREVIEW REDEPLOY | **PASS**, for the already-deployed revision |
| OPERATION COMPLETION LIFECYCLE | **FAIL**: native COMPLETE was not established |

The application works. The operation stopped at its cumulative credit budget before its third Think pass could make a provider request. Authentication loss was a separate, later failure whose exact cause remains unproven. No repair, retry, new instruction, or deployment was performed.

All timestamps below are UTC on October 1, 2026.

## Project 8

- **Owner recovered:** yes, through the normal production login UI, using the stored authorized credential. Same owner `379ce699-b905-43cc-b5ba-f40bb42ded20`; no account creation, ownership change, session injection, or authentication bypass.
- **Agent:** unchanged, `c9b4c828-07d1-41aa-a6bb-2c858b29c09e`.
- **Revision:** `020de27f52eb0273554e1004cb12eb9f2977aa7a`, confirmed again through the authenticated owner revision endpoint.
- **Previous revision:** `04395b156f7e43346a240be3d824eef8104b7697` remains the parent, according to the retained Git evidence.
- **Preview:** HTTP 200; normal private editor preview rendered the CRM.
- **Seeded leads:** 12 before and after regression. Original lead IDs and core fields were compared after a normal reload and were unchanged.
- **Backend API:** collection/detail GETs 200; note POST 201; temporary lead POST 201, PUT 200, DELETE 200.
- **Production releases:** empty. Publish was not used.

## New feature

| Check | Result |
|---|---|
| Click an existing lead | PASS: used Eleanor Vance's actual name button |
| Details experience | PASS: drawer opened |
| Correct data | PASS: name, company, email, selected status, source, estimated value, created date |
| Created date | PASS: displayed Sep 28, 2026 |
| Notes section | PASS |
| Add one note | PASS: exactly one submission; HTTP 201 |
| Note appears | PASS |
| Persistence | PASS: normal reload, reopen, and detail GET confirmed exactly one matching note |
| Activity Timeline | PASS: note event rendered after reopen |
| Activity ordering | PASS: temporary lead's creation and three update events rendered newest first |
| Design consistency | PASS: existing navy styling and drawer presentation |
| Feature result | **PASS** |

The one retained note is:

> Project 8 verification note: existing revision persistence check.

It was submitted to lead 1 at 20:04:22 and remained visible after reopening. No second note was submitted.

## Concise regression

| Check | Result |
|---|---|
| Dashboard | PASS |
| Summary cards | PASS: total leads, qualified leads, pipeline value, won revenue |
| Existing leads | PASS: 12 accessible and preserved |
| Search | PASS: Eleanor search selected the correct single lead; clearing restored all 12 |
| Sorting | PASS: lead-name ascending and descending |
| Status filtering | PASS: Qualified returned three leads, all with Qualified selected |
| Add Lead | PASS: exactly one temporary lead created |
| Edit Lead | PASS: temporary lead's company, value, and status changed and displayed |
| Delete Lead | PASS: normal confirmation; removed from UI and persisted collection |
| Five newest leads | PASS: five expected seeded leads rendered |
| Backend requests | PASS |
| Malformed preview URLs | None observed in the scoped verification requests |
| Generated-app API CORS | No failures observed; note and CRUD requests, including preflights, succeeded |
| Actionable generated-app console errors | None captured |
| Regression result | **PASS** |

Only `Project 8 Regression Test Lead` was created, as lead 13. It was created once, edited once, and deleted once. A normal reload confirmed its absence and the original 12 leads.

Cloudflare `/cdn-cgi/rum` telemetry emitted sandbox-origin CORS messages. These were recorded separately: they were not generated-app API failures.

Three observer-only issues were corrected without changing the application or repeating a mutation: a noninteractive table-cell click, a Puppeteer viewport reset, and an incorrect expectation that CRUD must trigger another collection GET. The final collection was verified through a normal customer reload.

## Think pass 3: why it started

The two completed passes each reached the 25-step per-pass cap. They did not call `finish_task`. A commit and a successful preview deployment do not independently establish the structured native COMPLETE state.

At the end of pass 2, the retained diagnostics showed:

- lifecycle `RUNNING`;
- progress had advanced;
- continuation count 1, within the configured budget of 4;
- completed pass count 2;
- model calls 50 and tool calls 48.

At 19:40:47.500, the driver chose `CONTINUE`. It reserved continuation 2 and opened pass 3. This was an internal continuation of the same customer operation, not another customer instruction.

**Missing completion evidence:** a successful `finish_task`/COMPLETE outcome and its required completion-validation evidence. Native agent browser verification was not established. The continuation was generic continued task/completion work; no provider step ran in pass 3, so there is no retained third-pass plan establishing whether its next action would have been verification, acknowledgement, or further editing. The driver did not need another deployment to recognize that the existing deployment existed.

## Think pass 3: failure boundary and resource cause

| Time | Retained event |
|---|---|
| 19:40:43.151 | Existing preview deployment recorded |
| 19:40:47.473 | Pass 2 response hook: stream completed, lifecycle RUNNING |
| 19:40:47.500 | Driver chose CONTINUE |
| 19:40:47.519 | Host started pass 3, continuation count 2 |
| 19:40:47.538 | Native chat RPC started |
| 19:40:47.543 | RPC callback started, request `690fbbfe-cb29-440b-843c-3b22e25ad095` |
| 19:40:47.615 | Third stream opened; `beforeStep` for its first step started |
| **19:40:47.656** | **Model-resource reservation threw; lifecycle became INCOMPLETE_RESOURCE_LIMIT; native stream became error** |
| 19:40:47.695 | Terminal operation persistence returned |
| 19:40:47.713 | RPC `onError` callback recorded |
| 19:40:47.731 | Host chat RPC resolved |
| 19:40:47.755 | Driver chose STOP with INCOMPLETE_RESOURCE_LIMIT |

### Active limits and accounting

The live Think configuration projected from `think_config` contained only the continuation and elapsed overrides. The active deployed runtime bundle supplies the remaining defaults.

| Parameter | Value |
|---|---|
| Steps per Think pass | 25 |
| Maximum internal continuations | 4 |
| Maximum total Think passes | 5: initial plus four continuations |
| Model-call ceiling | 650 |
| Tool-call ceiling | 1,300 |
| Elapsed ceiling | 900,000 ms / 15 minutes |
| **Cumulative operation-credit ceiling** | **100** |
| **Credit reservation per model call** | **2** |
| Model calls before failure | 50 |
| Tool calls before failure | 48 |
| Continuation count at failure | 2 |

**Cause: cumulative `credit_limit`.** Fifty model reservations consumed `50 × 2 = 100`. The first reservation in pass 3 would require `102 > 100`. The credit guard throws before the provider invocation.

This attribution is based on the retained counters, the live configuration projection, and the matching active deployed code. The original exception message/reason string itself was not retained. Its stack was retained: active `index.js:392532` throws the resource-limit error, called by the model reservation at `index.js:393135`. The exact source checks model count, then cumulative credits, then available metered credits. Thus cumulative credits select the failure here before the available-balance check.

The model-call, tool-call, elapsed, and continuation ceilings were not exhausted. The native edit-stream window was approximately 218 seconds, well below 900 seconds.

These are internal per-operation accounting credits. This finding does **not** establish exhaustion of the provider balance, Cloudflare Gateway balance, or the owner's overall monthly balance.

### RPC, stream, provider, and recovery classification

- **Provider request reached:** no model request for pass 3; failure occurred in the pre-provider `beforeStep` reservation.
- **RPC:** started, error callback invoked, then chat RPC resolved. Callback-delivered stream failure is not necessarily an RPC rejection.
- **Stream:** persisted status `error`, one start chunk, zero completed step markers, zero third-pass tools.
- **Stream forwarding:** host error callback ran; delivery/handling of that error by the specific customer editor socket is not proven by the retained browser frames.
- **Diagnostic context caveat:** some pre-step records still carry the prior pass's request/tool IDs, including `deploy_space`. Those fields are stale context, not evidence that pass 3 executed a deployment tool. Turn/continuation counters and the native stream journal establish the third-pass boundary.
- **Operation state before:** RUNNING.
- **Last retained terminal lifecycle/persistence state:** INCOMPLETE_RESOURCE_LIMIT.
- **Counter caveat:** `completedPassCount` became 3 after the errored RPC resolved. This counts resolved chat passes, not three successful generations. Actual edit passes remain `[25, 25, 0]`.
- **Fiber/recovery state:** scoped native SQL snapshots had no Fiber rows, run snapshots, queued callbacks, or submission rows. No pending Fiber recovery was established.
- **WebSockets:** scoped diagnostics contain clean close-code-1000 events and owner-authorized observer connections around the incident. These do not prove which event belongs to the customer's generation socket or explain the resource guard.
- **Classification:** native cumulative-resource-limit termination before provider execution; not a demonstrated provider outage, context overflow, or RPC transport failure.

The active runtime was `f4488693-4424-46a3-9834-30b214645449`, activated at 14:11:18.296, before this operation. The active bundle was downloaded read-only and its stack locations matched. No new runtime version was uploaded or activated.

## Authentication 401: separate timeline

- **Endpoints established by retained production request events:** `GET /api/projects/8/runtime/status` and `GET /api/projects/8/runtime/revision` returned 401.
- **Failed request timestamps:** status request event 19:40:49.953; revision request event 19:40:49.963. These are request-event timestamps, not a claim that the observer received the responses at those instants.
- **Observer receipt:** generic `Owner GET 401` at 19:40:50.080. The original observer concurrently requested status, revision, and turns and did not retain the URL in its exception, so its exact first rejected Promise cannot be identified from that exception.
- **Cookie present:** a Cookie header was present on the failed status and revision requests. Before normal login recovery, browser metadata showed an unexpired `accessToken` cookie. Redacted request logs do not establish the exact token or session ID sent.
- **Server sessions present:** the owner's registration and earlier-login sessions remain present in the live runtime D1, along with the new normal-login session.
- **Revoked:** the retained sessions have `is_revoked = 0`, no revocation time, and no revocation reason.
- **Expired:** the earlier sessions' expiry dates were after the incident, not at 19:40.
- **Account status:** active, not suspended, not locked, not deleted; `password_changed_at` null.
- **Logout:** not established; no revocation evidence identifying logout.
- **Password reset:** no reset-token rows; no password-change evidence.
- **Browser helper replaced/lost credential:** not established. The inspected second-edit observer contains no cookie clearing, cookie injection, logout, or password-reset action. Cookie presence alone does not prove a valid access token was sent.
- **Owner session valid server-side:** the session-row lifecycle gates remained valid. The old JWT's signature, contents, hash match, and actual transmission were not established from retained credential-free evidence.
- **Exact cause:** unresolved. The control plane did not resolve a signed-in runtime identity. Missing/incorrect access-token transmission versus rejected JWT/session validation cannot be distinguished safely from the retained records.
- **Relationship to Think failure:** no causal link established. Native resource termination occurred first, 2.424 seconds before the observer recorded 401, and its proven cumulative-credit guard does not require that later browser authentication failure.

The normal login succeeded at 19:59:49 for the same owner. No recovery/reset flow or authentication implementation change was used.

## RECOVERING / VERIFYING

### What blocked reconciliation

The client does not accept stream end, an idle flag, or a commit by themselves. It checks stable idle state, changed revision, files, correlated prompt/assistant history, preview, and a final revision/status agreement.

When owner reads returned 401, the client could not perform those checks. Its recovery path catches verification failures and polls rather than resending. The source has a ten-minute recovery window; the retained early RECOVERING display is not proof that its timeout never executes.

The native lifecycle had already terminated as INCOMPLETE_RESOURCE_LIMIT. Existing owner status exposes coarse idle state, but no owner route exposes the private Think operation/lifecycle getters. Therefore the browser could see idle/saved work without seeing the native terminal reason.

### Expected and observed transitions

- **Native expected transition at this guard:** RUNNING to INCOMPLETE_RESOURCE_LIMIT, with error callback and driver STOP.
- **Native actual transition:** retained diagnostics establish that transition.
- **Client expected error handling:** an `error` frame should fail the current turn; socket interruption/reopen instead invokes read-only recovery checks.
- **Client observed then:** RECOVERING / VERIFYING while identity was unavailable and owner reads failed.
- **Client observed after normal recovery:** by 20:23:34 the editor input was enabled and its saved recovery baseline was absent. Read-only client-state inspection at 20:24:46 showed phase `idle`, not recovering.
- **Completion:** no native finish_task/COMPLETE was established. Enabled input and idle client state must not be relabeled native success.
- **Direct current persisted KV:** not read. The last retained terminal persistence is established through production diagnostics; protected `_cf_KV` was not queried or bypassed, and no new inspection endpoint was added.

### Contribution and confidence

| Area | Classification |
|---|---|
| Native continuation | **Established, high confidence:** cumulative operation-credit guard stopped pass 3 |
| Authentication | **Failure established; exact cause insufficiently evidenced** |
| Controller reconciliation | **Auth blocked the owner read checks; terminal-reason visibility gap exists** |
| UI | **Recovery state observed initially, no longer stuck at final observation; permanent UI-state bug not independently established** |
| Native COMPLETE | **Not established** |

The initial operation's final completion/verification could not finish, although its generated edit and preview deployment were valid. The independent 401 prevented customer-side verification at that time. Normal supported session recovery later allowed functional app verification and restored an idle editor, but did not supply the missing native completion evidence.

## Safety receipt

- **NEW AI REQUESTS: 0**
- **PRODUCTION SOURCE / RUNTIME / CONTROL-PLANE / AUTH IMPLEMENTATION / UI / OBSERVABILITY / CONFIGURATION CHANGES: 0**
- **NEW DEPLOYMENTS: 0**
- **PRODUCTION PUBLISH: NO**
- **PROJECT 9: NOT CREATED**
- **PROJECT 5: UNTOUCHED**
- **Project 8 reset or repair: NO**
- **Think retry/resend: NO**
- **Operator SQL rows written: 0**
- Authorized customer actions only: normal same-owner login; one retained note; one temporary lead created, edited, and deleted.
- Same owner browser left open. No browser was closed or killed.

## Retained evidence

Stored under `production/vibesdk-launch/`:

- `project8-existing-revision-verification.json`: app, note, regression, mutation counts, original-seed comparison, revision and release checks.
- `project8-existing-revision-native-state-metadata.json`: scoped native stream/Fiber/run/queue metadata, zero SQL writes.
- `project8-existing-revision-config-submissions.json`: safe live Think limit projection and submission-table result.
- `project8-existing-revision-scoped-log-evidence.json`: sanitized same-agent/owner production diagnostics.
- `project8-existing-revision-auth-d1-evidence.json`: owner-scoped session/account/reset/attempt metadata, without tokens/hashes.
- `project8-existing-revision-auth-trace-evidence.json`: failed status/revision request metadata and Cookie-header presence.
- `project8-existing-revision-final-controller-observation.json`: final same-owner auth, status, revision, history metadata, and read-only client-state observation.
- `project8-existing-revision-active-runtime-proof.json`: deployed bundle hash, limit/cost values, and source/stack attribution.
- Relevant screenshots: `screenshots/project8-existing-revision-timeline.jpg`, `screenshots/project8-existing-revision-crud-timeline.jpg`, `screenshots/project8-existing-revision-regression-final.jpg`, and `screenshots/project8-existing-revision-final-controller.jpg`.

The independent unauthenticated screenshot tool rendered the normal login page. Signed-in application verification used the legitimate recovered owner browser and interactive tests, not that anonymous capture.

**Stopped. No fix or retry performed.**