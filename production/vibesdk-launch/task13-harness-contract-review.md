# Owner-scoped acceptance harness contract review

**Overall status: BLOCKED for full validation; the confirmed harness defects are fixed locally.** The required owner-authenticated healthy-project comparison could not be performed without creating or recovering a session. No product code, observability code, or deployment was changed. No fixture, coding request, Project 7 retry, or Publish was run.

## Scope and source provenance

- The live control-plane deployment still serves version `0e01f7dc-51c4-4736-9873-ea431abc823c` at 100%. Cloudflare returned its active `worker.js` module (SHA-256 `bb15915ab8aa778693403473454edab780bfd7d8e0368535e071f98400ec44e3`). Its native status, revision, and owner route implementations match the pertinent tracked `cloudflare/worker.ts` and `cloudflare/staging/think-runtime.ts` contracts. No complete source-tree byte parity for the control plane is claimed.
- The live customer editor shell returned HTTP 200 and `/assets/index-C9J3WLc3.js` returned HTTP 200; the served JavaScript SHA-256 `4ff1dad08fc7ac43f62b18eca6494f0f40fcad311968f1e5cb3afd2a709c2709` **exactly matches** `dist/public/assets/index-C9J3WLc3.js`. Native conversation-state, runtime-status, and revision markers exist in the served asset. The UI behavior described below is based on the matched source and asset, not an interactive browser test.
- Existing runtime instrumentation version `f4488693-4424-46a3-9834-30b214645449` remains accepted and unchanged. No deployment was requested or performed.

## Project 7 read-only reconciliation

| Question | Evidence |
| --- | --- |
| User, project, owner | Existing fixture session `GET /api/auth/me` returned 200 for owner `595efefa-7003-48bb-8843-49ae74310c62`. Scoped D1 SELECT confirmed this user exists and owns **Project 7**; owner `GET /api/projects/7` returned 200, `status: ready`. |
| Agent and mapping | Product detail and scoped D1 `runtime_project_links` agree on agent `914d67b0-7ad9-482e-8825-01a93e272ad3`, `runtime_provider: stock-think`, initialization `ready`. The product detail's owner was checked against the authenticated owner. Owner status also returned `connected: true`, after the control plane's stock owner-connect check. A separate runtime D1 lookup was unavailable through the local account query ID and is not claimed as evidence. |
| Customer coding requests | **0**, as recorded in the original one-shot checkpoint. Native owner turns returned HTTP 200 with **zero** turns. |
| Current generation | Owner `GET /api/projects/7/runtime/status`: HTTP 200, `nativeThink: true`, `runtimeStatus: ready`, `connected: true`, `state.shouldBeGenerating: false`, `state.generation.status: idle`, `files: 1`. |
| Product and runtime revision | Product D1 has no independent commit/revision column for this new project's native flow. Owner `GET /api/projects/7/runtime/revision`: HTTP 200, root `{branch, commitHash}` pair with a branch and commit `4fff0e499127983e10e571f723bd7a045469c485`. This Git-backed owner endpoint is the authoritative customer revision. |
| SpaceDO state | Scoped Cloudflare account SQL query/v2 for **this mapped agent only** returned HTTP 200, outer success, `rows_written: 0`, workspace and deployments tables present. Before the owner GETs, the workspace table contained nine file rows, including one Git HEAD and one `.think/space.json` seed marker. A subsequent SELECT again found one HEAD and one seed. No protected KV was queried. |
| Workspace/files | Owner `/runtime/files`: HTTP 200, one committed path, `.think/space.json`. This new agent **was seeded before its first customer coding request**. The first-use seed is best-effort in the runtime source; a different new project may legitimately return `{branch:null,commitHash:null}` before a coding turn. |
| Preview/release | Owner status has no preview or deployment URL; scoped D1 shows no preview/deployment link, zero published releases, zero legacy builder turns. No preview was created or requested during this investigation. |

No POST to the product, no WebSocket suggestion, and no AI request was made. Authenticated customer GET routes can perform internal identity upsert/reconciliation or lazy SpaceDO initialization on a cold object; they are not a guarantee of zero incidental storage writes. The object already had a seeded workspace and Git HEAD before these GETs. We did not call a preview endpoint or issue a repair/initialization operation.

## Exact old harness expectation versus observed contract

The original `scripts/continuous-coding-observability-fixture.mjs` setup first created the project once, then polled `identifyAgent` (at most 20 attempts, three seconds apart). Its owner GET and scoped D1 query required HTTP 200, the same project/owner, and both project and link `ready`. It then concurrently called owner `GET /runtime/status` and `GET /runtime/turns`, and called Cloudflare account SQL **POST** `/workers/durable_objects/namespaces/<SpaceDO namespace>/query/v2` with a SELECT for the mapped agent's Git HEAD/ref files. Requests used the preexisting launch auth-cookie session; GETs carried the product origin. The account SQL used the existing Cloudflare token, not a customer session. Individual requests had 60-second timeouts.

The first stop was **`assert.equal(report.initialSnapshot.status.idleNoGeneration, true)`** in `agent-identification`. The original `statusSummary` required `configured === true`, `provider === "vibesdk"`, and `agentId === mappedAgentId` **in the status response**. The current deployed native status response contains none of those three fields. It instead says `nativeThink: true`, `runtimeStatus: ready`, `connected: true`, and the idle generation state. Project identity belongs to the separate owner-bound project/link check. The checkpoint had `idleNoGeneration: false`, despite `shouldBeGenerating: false`, `generation.status: idle`, and `connected: true`.

A second independent false negative would have stopped setup next: the original direct SpaceDO SQL parser required every nested query result to contain `success === true`. The live Cloudflare query/v2 result has **no nested `success` property**, but has valid `columns`, `rows`, no error, and `meta.rows_written: 0`. Its HTTP status was 200 with outer success. The parser threw, and the snapshot caught and labeled it `spaceGitReadState: READ_FAILED`. That label did **not** mean SpaceDO was unavailable. Repeating the scoped read with the correct metadata check established HEAD and seed files. A third stale expectation, `state.lastDeployedCommit`, is absent from native status; the authoritative owner revision endpoint returns root `{branch,commitHash}`, not a nested revision or a status-derived hash.

### SpaceDO failure classification

- Caller: original `ownerSnapshot` → `readOwnAgentGitHead` → Cloudflare account query/v2, HTTP **POST** with SELECT only, scoped to Project 7's owner-verified agent.
- Expected by old harness: nested query `success: true`, zero writes, HEAD and ref rows.
- Actual: HTTP 200, outer `success: true`; nested `success` **omitted**, no nested error, `rows_written: 0`, valid columns/rows. Workspace, HEAD, and seed exist.
- Reached persisted SpaceDO SQLite: **YES**, the scoped query returned table and file metadata. This does not imply a runtime RPC was invoked by that account-level SQL API.
- Was workspace initialization expected: best-effort seed normally occurs during agent creation and did occur here. Current customer Git GETs may initialize a cold DO as an incidental runtime behavior, so a harness must not call them *to force* a workspace baseline.
- Classification: **HARNESS ASSUMPTION FAILURE**, not a proven product or Cloudflare failure. The first false idle result is also a harness response-contract failure.

## Current customer product and UI contract

- Owner-scoped `GET /api/projects/:id` selects by authenticated user and project ID and exposes `id`, `userId`, `agentId`, `status`, `runtimeStatus`, and URLs. The runtime link is independently owner checked. This GET may reconcile a pending link; its method alone does not guarantee no internal write.
- Native ready `GET /runtime/status` returns `nativeThink`, `runtimeStatus`, `connected`, `files`, `state.shouldBeGenerating`, `state.generation.status`, `previewUrl`, `deploymentUrl`. It does **not** return the legacy configured/provider/agent-ID triplet. Native `GET /runtime/revision` returns root `{branch:string|null,commitHash:string|null}`; `GET /runtime/files` returns an array of committed paths; `GET /runtime/turns` returns `{turns:[...]}`. All are owner scoped. Cold SpaceDO-backed reads may call `ensureInit()`.
- The current UI receives launch-auth cookies on same-origin requests; it does not pass a user ID for authority. Project creation returns ready or initializing. The dashboard hands a starter prompt to the editor only on ready; detail/editor handle pending readiness. The native editor gates on `nativeThink && runtimeStatus === "ready"`, opens an idle conversation-state WebSocket, and reads revision and turns before a user suggestion. It only sends the suggestion after an agent-connected frame says `shouldBeGenerating === false`; it never auto-retries. It does **not** require direct SpaceDO SQL or a non-null pre-turn commit. It later requires a changed stable Git revision, valid turn, files, and preview before completion.
- Native previews are **POST `/runtime/previews`** and can deploy an ephemeral sandbox. This investigation did not call them. A preview is not required before the first coding request.

## Harness-only correction

Changed only `scripts/continuous-coding-observability-fixture.mjs`; added pure contract helpers in `scripts/lib/task13-owner-contracts.mjs` and offline tests in `scripts/task13-owner-contracts.test.mjs`. No product, runtime, control, gateway, UI, observability, or deployment files were changed.

- Establish owner/project/agent identity from **both** the authenticated product detail and scoped D1 link, fail closed on mismatched owner or agent, missing project/link, conflicting initialization state, or mapping drift. A genuinely pending initialization may still wait, without repeating agent creation.
- Use the supported native status fields for idle. A stale legacy status, non-native provider, missing fields, active generation, non-ready link, or unverified mapping cannot pass.
- Use owner revision `{branch,commitHash}` as the baseline. Valid null/null is a **known fresh, uncommitted** baseline, not a broken project. A valid branch plus commit represents an established head; missing/malformed/conflicting fields or HTTP errors fail. Re-read the branch and hash before any browser request; reject a change. No direct SpaceDO SQL is required for preflight. The separate forensic evidence action remains explicitly read-only.
- Before a fresh first request, require zero native turns, no existing product release, no preview/deployment URL, and the same ready agent link. A new seed commit is **not** mistaken for a previous customer turn.
- Correct the optional nested-success interpretation for any later, separately authorized Cloudflare query/v2 forensic read; explicit nested error/failure or nonzero rows written still fails closed.
- Offline verification: **8 focused cases PASS** covering fresh null revision, seeded/established revision, active generation, owner mismatch, missing project/link, conflicting release/preview, malformed and stale status/revision, and Cloudflare nested errors/writes. The harness `self-test` PASS; `node --check` and `git diff --check` PASS. **Neither setup nor run was executed.**

## Healthy established project comparison: blocked

**Project 2** was selected as the sole safe candidate. Prior accepted evidence identifies a committed revision `e4dce7b936ff4c85a381c4282ece2224b5c0e957`; its idle-WebSocket criterion was unresolved, so that behavior is **not** treated as accepted. The previous Project 2 owner browser profiles are absent, and no verified, existing owner-authenticated Project 2 session is available. Creating a login/session to obtain one would conflict with this investigation's no-mutation instruction. We did **not** send owner GETs for Project 2 using Project 7's credentials, read its private workspace through an operator shortcut, or claim an owner-side healthy comparison. The established idle case is covered only by a local contract test and earlier committed-revision evidence.

## Verdict and stop condition

- Confirmed root cause of **Project 7's pre-request stop:** stale native status-field assumptions; independently, a too-strict Cloudflare SQL result parser and obsolete baseline source. **High confidence**, from its checkpoint, live owner GETs, scoped SQL metadata, and active control/UI bundles.
- Real product regression: **not established**. Project 7's current owner paths respond normally, but coding, continuation, preflight/deploy, and multi-turn completion were not exercised.
- No Project 5 read or touch. No Project 6 retry. No Project 7 coding request. No new fixture. No runtime deployment. No observability change.
- **Exact next recommended step:** review the local harness-only diff and provide a verified, already-existing owner-authenticated session for Project 2, or separately authorize creating one, if the healthy-project comparison is still required. Only then decide whether a different new one-shot fixture can be authorized. Do not reuse Project 7.