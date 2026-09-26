# Task 6 private production-runtime acceptance

**Result: ACCEPTED for the private clean foundation only.** This is not approval for public domains, customer traffic, product-control-plane deployment, or cutover. Evidence was collected on September 26, 2026. All account IDs and resource IDs below identify the newly isolated Cloudflare launch resources; no credential values are recorded.

## Resources and baseline

| Purpose | Name | ID |
| --- | --- | --- |
| Cloudflare account | launch account | `03ef1e6e42498920987f07059e107538` |
| Product D1 | `buildcustom-product-launch-db` | `ca820baf-6973-4318-ac52-529d56293bb6` |
| Runtime D1 | `buildcustom-vibesdk-launch-db` | `716c6600-8c60-408a-9446-3779979d5316` |
| Runtime KV | `buildcustom-vibesdk-launch-kv` | `80e8a38752dd4012875a189b05b6a148` |
| Template R2 | `buildcustom-vibesdk-launch-templates` | bucket name |
| Dispatch namespace | `buildcustom-vibesdk-launch-dispatch` | `a73a11e6-f9fb-4331-8ba7-e8320b4804ff` |
| AI Gateway | `buildcustom-vibesdk-launch-ai` | gateway name |
| Empty product-route KV | `buildcustom-app-routes-launch` | `248ac5b6821a475794a7fe3d2b0c3718` |
| Container application | `buildcustom-vibesdk-launch-userappsandboxservice` | `a03833f0-ec87-44db-a7f0-77076ca4888c` |
| CodeGenObject DO | `CodeGeneratorAgent` | `a9c65da411c946569c6d6939190cf03e` |
| Sandbox DO | `UserAppSandboxService` | `9a4a4f1f70314713b4e5ddfda7a69f03` |
| Rate-limit DO | `DORateLimitStore` | `d156c0b8d76148d8a3ab0d4622bf1bde` |
| User-secrets DO | `UserSecretsStore` | `37c9221368634c12b04f74655e927e8e` |
| THINK_DO | `ThinkAgent` | `5d1e8716e75e4e1884458127f83c7f1c` |
| SPACE_DO | `SpaceDO` | `bd1438931f1e489b89439e66b385837e` |
| Launch Worker | `buildcustom-vibesdk-launch` | version `699e38f7-4622-4932-a0a2-264e1f97d5a4` (100%) |

## Requested acceptance report

1. **Resources created:** the isolated resources in the table above, one launch Worker at `https://buildcustom-vibesdk-launch.thegoldimport.workers.dev`, and one private immutable dispatch script. No BuildCustom public route was created.
2. **Exact names and IDs:** in the table above; the private script is `bc-r-cffdb5ce7e2a8953cabfd35df97a90057931e6797364d1d47043ac43`.
3. **Product D1:** migrations 0001–0005, 17 application tables plus `_cf_KV` and `d1_migrations`, zero users, projects, runtime releases, native publish claims, and runtime links; foreign-key check clean. No historical product rows copied.
4. **Runtime D1:** nine stock migrations; foreign-key check clean. After the final hardened-auth retest: seven disposable users, two agents/apps, eleven sessions with two revoked. Two agents were necessary to check ownership in both directions; only one received a generation request.
5. **Templates:** source `cloudflare/vibesdk-templates` commit `7ea201fafdef44f5dcc5bc05f03b36e3198cebe5`; catalog SHA-256 `db6e3dc43aba7fc7556eb81f1aca32225ac0f6f5c0e983ba717a40661612b8bf`; catalog plus seven ZIPs read back byte-identical and passed ZIP integrity checks. The seven definitions are listed in `manifest.md`.
6. **Stock runtime source:** `cloudflare/vibesdk` commit `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`; stock `bun.lock` SHA-256 `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`.
7. **Task 4B patch:** unchanged `production/patches/task4b-immutable-runtime.patch`, SHA-256 `49e57d3e4ae4eaef5ad0a43a10d62b3421fdbab501a15bdd4d5f74dd31e6b91b`. No historical restore patch was changed. Task 6A is a separate second patch.
8. **Immutable identity vector:** UUID `550e8400-e29b-41d4-a716-446655440000` plus revision `e7520d4a88db2e5c794a1dbf8668a1236eab35f7` yields `bc-r-27f06beab314dec1b904ee4675f28f90140f97dc0ceb9cab11c4ca69`; verified.
9. **Deployed Worker:** `buildcustom-vibesdk-launch` hardened version `699e38f7-4622-4932-a0a2-264e1f97d5a4`, serving 100%. Dry-run Task 6A bundle SHA-256 `88dbbfe09652d0307ac58fbffcc5d6beb8f875fa519ba49efe7f1ef8c109882b`.
10. **Bindings by name:** `CF_VERSION_METADATA`, `ASSETS`, `API_RATE_LIMITER`, `AUTH_RATE_LIMITER`, `AI`, `BROWSER`, `DISPATCHER`, `DB`, `CodeGenObject`, `Sandbox`, `DORateLimitStore`, `UserSecretsStore`, `THINK_DO`, `SPACE_DO`, `LOADER`, `TEMPLATES_BUCKET`, and `VibecoderStore`, plus launch-only configuration variables in `production/vibesdk-launch/wrangler.jsonc`. The isolated container application binding remains present.
11. **Secret names only:** `CLOUDFLARE_AI_GATEWAY_TOKEN`, `CLOUDFLARE_API_TOKEN`, `JWT_SECRET`; the account ID is now a non-secret config variable. Neither the old provisioning token nor the lab Gateway token was installed as a launch-Worker secret.
12. **AI Gateway:** `buildcustom-vibesdk-launch-ai`, authentication enabled, `byok_only=false`, zero provider-key configurations. The runtime uses the stock authenticated `/compat` path; the launch Worker has no direct Google provider secret.
13. **Unified Billing / wholesale path:** Cloudflare documents Unified Billing fallback for third-party requests without provider credentials when `byok_only=false`. That is this Gateway's configuration, and 19 Google AI Studio/Gemini requests succeeded with recorded cost and no BYOK configuration or provider Authorization header. The log API does not expose a per-request invoice-rail field, so this is configuration-plus-success evidence rather than an invoice settlement statement.
14. **AI usage:** 19 successful Gateway requests, zero failed requests or authentication errors, provider `google-ai-studio`, model `google/gemini-3.6-flash`, aggregate recorded cost **$0.11140365**. No wholesale 429 pattern was observed. Only one user suggestion/generation was sent.
15. **Authentication:** health, frontend and CSRF HTTP 200; disposable registration, login, authenticated profile and `/api/auth/check`, logout, old-token denial and fresh login passed. The hardened Worker was retested after redeployment using a new auth-only identity; its D1 rows show three sessions, exactly one revoked. The original test owner's D1 rows also showed exactly one revoked session.
16. **Two-user isolation:** User B cannot connect to User A's agent or mint its ticket; User A cannot connect to User B's ownership-test agent or mint its ticket. Both directions returned HTTP 403, even with a browser-supplied `userId` substitution; each owner's own connect/ticket succeeded.
17. **Generated disposable agent:** `796479f1-e4db-4c26-83ce-6a29a704edd6`, owned by disposable User A `6ebf2e61-a22f-4998-9996-cf3f5eb31858`. Unprompted ownership-test agent: `856c28ee-53d8-4a6e-a7f2-1e92e180e14e`.
18. **Generation:** one suggestion produced a tiny Vite React app with exact marker `BUILDCUSTOM_PROD_RUNTIME_OK`; no second generation request was sent. The original stream harness stopped at an early, non-authoritative event, but persisted files and the rendered preview proved that same generation succeeded.
19. **Committed revision:** `735705d3cbcbb0c066803a605e1582488ca8c1c2`, current `main` HEAD and the agent's `lastDeployedCommit`; owner-bound private Git and agent reconnect agree.
20. **Authoritative files:** private Git commit contains `.think/space.json`, `index.html`, `package.json`, `public/app.js`, `public/index.html`, `src/App.jsx`, `src/index.css`, `src/index.ts`, `src/main.jsx`, `vite.config.js`, and `wrangler.json`. The exact marker occurs in `public/app.js` and `src/App.jsx`. No separate file store was created.
21. **Preview:** stock owner-authorized `/space/<agent>/preview/main/` returned HTTP 200. Headless Chromium rendered `BUILDCUSTOM_PROD_RUNTIME_OK`; the required local `app.js` loaded; zero failed requests and zero page-level errors.
22. **Private immutable deployment:** a single owner-authorized WebSocket deploy message specified `target:"platform"`, `immutableRelease:true`, and `expectedRevision:735705d3cbcbb0c066803a605e1582488ca8c1c2`. The runtime completed it with deployment/script ID `bc-r-cffdb5ce7e2a8953cabfd35df97a90057931e6797364d1d47043ac43`, matching SHA-256 of `<agentId>:<revision>` truncated to 56 hex characters.
23. **Dispatch namespace:** Cloudflare script-detail API finds that exact script only in `buildcustom-vibesdk-launch-dispatch`; queries of the other five account namespaces found no matching script. Its metadata reports `has_assets=true`, `has_modules=true`, and a fetch handler. One deploy request was sent; no retry or second upload was initiated by the acceptance harness.
24. **Clean route KV:** `buildcustom-app-routes-launch` contains zero keys after deployment. No public gateway is attached to it.
25. **Old state:** no legacy users, projects, product records, dispatch namespaces, or old runtime resource was used as new product state. Product D1 remains empty.
26. **Public infrastructure:** no BuildCustom public domain, app route, DNS, custom hostname, marketing site, or existing gateway association was changed. The new script has no public mapping.
27. **Old product D1:** untouched; all writes were scoped to the new launch Worker/resources and new runtime acceptance identities.
28. **Replit independence:** the serving runtime, AI Gateway, preview, and private deployment ran on the new Cloudflare resources. Replit was used as an operator/test client, not as a runtime dependency or deployment target; the Replit deployment was not changed.
29. **Approved deviations:** Task 6A is a second, separately authorized patch, hardened before final acceptance to reject subject/session-owner mismatch and silent no-op revocation. An initially generated JWT secret was replaced on the isolated Worker after stock complexity validation failed. The account ID shifted from a temporary secret binding to the config variable on redeploy. Three failed/interrupted setup attempts left extra disposable identities without saved credentials; a further auth-only identity was used for the final retest. None were deleted. A second, unprompted agent was needed for live bidirectional owner isolation. The optional lockfile refresh for an uncatalogued Next.js template was blocked by the package firewall; the pinned catalog was unaffected.
30. **Blockers:** the stock logout defect was fixed under Task 6A. Artifacts REST returned HTTP 503 in this isolated environment, so the owner-bound stock private Git path provided authoritative revision/file reads. The first generation harness's file-event assertion was a false negative and was revised to mark its stream evidence as non-authoritative. No remaining blocker prevents this **private** acceptance; public control-plane productionization is separate.
31. **Private clean foundation:** **ACCEPTED** against the requirements above. This does not authorize public cutover.
32. **Next single implementation task:** build and privately verify a clean BuildCustom control-plane candidate against these launch resources, **without** repointing any public route or deploying the current public control plane. Specific minimum scope is below.

## Task 6A logout patch evidence

33. **Root cause and classification:** pinned upstream VibeSDK's `AuthController.logout` (`worker/api/controllers/auth/controller.ts`) called `extractSessionId` (`worker/utils/authUtils.ts`) for a `sessionId` cookie that `setSecureAuthCookies` never sets during registration/login. It then returned success and cleared the access-token cookie without revoking the D1-backed session. This is a stock source contract defect, not an isolated deployment configuration issue and not an intentional global-logout policy. `AuthService.validateTokenAndGetUser` checks D1 session revocation; `/api/auth/check` uses that middleware.
34. **Changed files/functions:** `worker/api/controllers/auth/controller.ts` (`AuthController.logout`) verifies the authenticated route-context session belongs to its user, performs owner-scoped `SessionService.revokeUserSession`, and checks the row is revoked before clearing cookies; missing/mismatched/no-op sessions return non-200 without cookie clearing. `worker/database/services/AuthService.ts` (`validateTokenAndGetUser`) now rejects a JWT whose subject does not own its D1 session. `worker/utils/authUtils.ts` (`createSecureCookie`) emits `Max-Age=0` for a zero-age clear. Added `worker/api/controllers/auth/controller.logout.test.ts` (five focused regression tests) and extended `worker/database/services/AuthService.test.ts` (one subject-binding regression). Legitimate registration/login/check behavior, session schema, global revoke, and historical restore were not changed.
35. **Patch:** normalized, repo-relative unified diff at `production/patches/task6a-logout-revocation.patch`; SHA-256 `cba391d6ed751ee5ad81bf44b4be896bf94528270e5326b2b16fdbbddf5f3573`. Application to pinned stock plus Task 4B was checked and yielded byte-identical auth files; `git diff --check` passed.
36. **Tests:** focused auth/security tests passed, full suite **516 passed, one skipped** across 45 files; typecheck and Vite/Worker build passed. The original accepted stock-plus-Task-4B suite had 510 passing tests and one skipped.
37. **Exact old session:** the original harness and the hardened live retest each cloned the actual pre-logout cookies before sending logout. Reusing those cookies returned unauthenticated from `/api/auth/check` and HTTP 401/403 from authenticated profile. The hardened retest also asserted `Max-Age=0` on a live logout response. D1 for the retest identity showed three sessions, exactly one revoked; the original owner's D1 rows likewise showed one revoked session.
38. **Fresh login:** both live tests logged the same user in again and passed `/api/auth/check`; the original run also passed authenticated profile and verified a distinct new session ID. Each revoked old cookie remained rejected after the new login.
39. **Independent sessions:** a second same-user session and a different user's session both remained authenticated after logout in the original and hardened live tests. No global logout was introduced.
40. **Public infrastructure:** Task 6A redeployed **only** `buildcustom-vibesdk-launch` (final version `699e38f7-4622-4932-a0a2-264e1f97d5a4`); no staging/lab/legacy Worker, public domain, public route, old database, or Replit deployment was changed.

## Exact next implementation task, not started

**Privately productionize the BuildCustom control plane against the accepted launch runtime and clean product state, then verify owner-authorized customer publish end to end without public cutover.**

- Generalize `cloudflare/staging/runtime-identity.ts` from its lab-only auth URL and bind `AUTH_RUNTIME` to `buildcustom-vibesdk-launch`. Keep stock session validation and owner identity; do not restore shared-key `VIBESDK_API_KEY` ownership.
- Update the staging-only runtime/dispatch guard in `cloudflare/staging/boundary.ts` for an explicitly selected **launch** tuple. In a dedicated candidate config based on `wrangler.product-launch.jsonc`, use product D1 `ca820baf-6973-4318-ac52-529d56293bb6`, `AUTH_RUNTIME`, the launch runtime URL, new dispatch namespace, and clean route KV. Do not edit/redeploy the current public config just to switch environment flags.
- Make `cloudflare/worker.ts` authorize normal customer publish by the already owner-scoped project identity, not its current staging `super_admin` gate. Keep registration and runtime-operation gates closed publicly; open only in the private candidate when its checks are ready.
- Prepare a separate **private** generated-app gateway config for `infrastructure/buildcustom-apps-gateway.js` with `ROUTES=buildcustom-app-routes-launch` and `DISPATCHER=buildcustom-vibesdk-launch-dispatch`; test route-record validation and dispatch with a disposable mapping, without touching the current `*.apps.buildcustom.ai` route or gateway binding.
- Keep Browser Rendering on the launch runtime's `BROWSER` binding and verify its intended product use. Validate clean D1 migrations, owner-only project creation/publish, immutable release linkage, gated registration, private gateway behavior, and rollback/failure isolation. A later, separately approved task must handle public cutover.

**Stop here.** No public cutover was performed.