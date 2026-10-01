# Private launch foundation (accepted for private use)

Cloudflare account: `03ef1e6e42498920987f07059e107538`. No BuildCustom public domain, route, marketing site, old product D1, or Replit deployment has been changed.

## Pinned build

- Stock `cloudflare/vibesdk`: `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`
- Stock `bun.lock` SHA-256: `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`
- First patch: `production/patches/task4b-immutable-runtime.patch`, SHA-256 `49e57d3e4ae4eaef5ad0a43a10d62b3421fdbab501a15bdd4d5f74dd31e6b91b`
- Second, separately approved patch: `production/patches/task6a-logout-revocation.patch`, SHA-256 `cba391d6ed751ee5ad81bf44b4be896bf94528270e5326b2b16fdbbddf5f3573`; applies cleanly after Task 4B.
- Dry-run Worker bundle SHA-256: original Task 4B `fc879ba5378e71b123c1c641d9de62b1e578b41a52c5d8533118d331da9af5e3`; hardened Task 6A `88dbbfe09652d0307ac58fbffcc5d6beb8f875fa519ba49efe7f1ef8c109882b`.
- Immutable vector: `550e8400-e29b-41d4-a716-446655440000` + `e7520d4a88db2e5c794a1dbf8668a1236eab35f7` = `bc-r-27f06beab314dec1b904ee4675f28f90140f97dc0ceb9cab11c4ca69` (verified).
- Typecheck and build passed; tests after hardened Task 6A: 516 passed, one skipped (45 test files).

## New resources only

| Purpose | Name | ID |
| --- | --- | --- |
| Product D1 | `buildcustom-product-launch-db` | `ca820baf-6973-4318-ac52-529d56293bb6` |
| Runtime D1 | `buildcustom-vibesdk-launch-db` | `716c6600-8c60-408a-9446-3779979d5316` |
| Runtime KV | `buildcustom-vibesdk-launch-kv` | `80e8a38752dd4012875a189b05b6a148` |
| Template R2 bucket | `buildcustom-vibesdk-launch-templates` | bucket name |
| Dispatch namespace | `buildcustom-vibesdk-launch-dispatch` | `a73a11e6-f9fb-4331-8ba7-e8320b4804ff` |
| AI Gateway | `buildcustom-vibesdk-launch-ai` | gateway ID/name |
| Empty route KV | `buildcustom-app-routes-launch` | `248ac5b6821a475794a7fe3d2b0c3718` |
| Container application | `buildcustom-vibesdk-launch-userappsandboxservice` | `a03833f0-ec87-44db-a7f0-77076ca4888c` |
| CodeGenObject DO | `CodeGeneratorAgent` | `a9c65da411c946569c6d6939190cf03e` |
| Sandbox DO | `UserAppSandboxService` | `9a4a4f1f70314713b4e5ddfda7a69f03` |
| DORateLimitStore DO | `DORateLimitStore` | `d156c0b8d76148d8a3ab0d4622bf1bde` |
| UserSecretsStore DO | `UserSecretsStore` | `37c9221368634c12b04f74655e927e8e` |
| THINK_DO | `ThinkAgent` | `5d1e8716e75e4e1884458127f83c7f1c` |
| SPACE_DO | `SpaceDO` | `bd1438931f1e489b89439e66b385837e` |

Product D1 migrations 0001–0005 applied: 17 application tables, plus Cloudflare's internal `_cf_KV` and `d1_migrations`; users, projects, releases, claims and runtime links all zero; foreign keys clean. Runtime D1 has nine stock migrations and, after the hardened auth retest, seven disposable users, two apps, eleven sessions (two revoked); foreign keys clean. The second app is an unprompted ownership-test agent; only the first agent received a generation prompt. Route KV remains empty.

Templates source: `cloudflare/vibesdk-templates` commit `7ea201fafdef44f5dcc5bc05f03b36e3198cebe5`; catalog SHA-256 `db6e3dc43aba7fc7556eb81f1aca32225ac0f6f5c0e983ba717a40661612b8bf`. The seven catalog entries are `c-code-react-runner`, `minimal-js`, `reveal-presentation-pro`, `vite-cf-DO-KV-runner`, `vite-cf-DO-runner`, `vite-cf-DO-v2-runner`, `vite-cfagents-runner`. Eight remote objects (catalog plus seven ZIPs) were read back byte-identical; all ZIPs passed integrity checks. The template generator's optional lockfile refresh for an **uncatalogued** Next.js definition was blocked by the package firewall; no pinned dependency was changed.

Worker `buildcustom-vibesdk-launch` is at the isolated canary `https://buildcustom-vibesdk-launch.thegoldimport.workers.dev`, with no BuildCustom public route. Initial version was `cd3a89b3-f8de-4ad8-b027-da85bb1c0ccc`; current hardened Task 6A version is `699e38f7-4622-4932-a0a2-264e1f97d5a4` (100%). Launch-Worker secrets retained by name are `CLOUDFLARE_AI_GATEWAY_TOKEN`, `CLOUDFLARE_API_TOKEN`, and `JWT_SECRET`; the non-secret `CLOUDFLARE_ACCOUNT_ID` is a config variable after redeployment. The initial generated JWT secret failed stock password-complexity validation and was replaced on this isolated Worker only, without displaying it. Health, frontend, and CSRF return HTTP 200. Gateway authentication is enabled, `byok_only=false`, and there are no provider-key configurations. Nineteen successful Google/Gemini Gateway requests cost $0.11140365 in the acceptance snapshot; no failed requests or wholesale 429 pattern.

## Private acceptance outcome

Task 6A fixes an upstream stock mismatch: login/register set an access-token cookie, but logout attempted to revoke only a nonexistent `sessionId` cookie. The separately approved patch validates JWT subject against the stored session owner, verifies the authenticated route-context session owner, revokes only that session, and confirms D1 reports it revoked before expiring auth cookies. Missing/mismatched/no-op rows fail closed without clearing cookies. Live old-cookie reuse failed, `/api/auth/check` returned unauthenticated, fresh login worked, and another session for the same user plus a second user's session stayed valid. D1 showed exactly one revoked session for each of the two logged-out acceptance users. Two-way owner isolation and owner-ticket rejection passed with two agents; only the first received a generation prompt.

Agent `796479f1-e4db-4c26-83ce-6a29a704edd6` committed the marker `BUILDCUSTOM_PROD_RUNTIME_OK` at revision `735705d3cbcbb0c066803a605e1582488ca8c1c2`. Owner-bound private Git read, 38 persisted conversation messages, reconnect, and browser-rendered stock preview (HTTP 200, marker visible, asset loaded, no page errors) passed. A file-event-only harness check incorrectly stopped early, but authoritative Git and preview showed that the **same single generation** succeeded; no repeat generation was sent. One owner-authorized `target:"platform"` deployment produced `bc-r-cffdb5ce7e2a8953cabfd35df97a90057931e6797364d1d47043ac43` in only the new dispatch namespace, with `has_assets=true`; the new route KV still has zero keys.

Two early auth attempts and a CSRF-rejected ownership setup left three additional disposable identities with lost, never-logged credentials; one further auth-only identity was used to retest the hardened Worker. These are counted in the seven runtime users and were not deleted. Protected temporary owner/session checkpoints under `/tmp` have mode 0600 and contain short-lived cookies, not passwords. Do not paste or publish their contents. The full 40-point report and exact next-task assessment are in `production/vibesdk-launch/task6-acceptance-report.md`. **Task 6 private foundation: ACCEPTED.** No public cutover, old resource changes, or Replit deployment occurred.

## Task 8D registration-only gate

The original pinned stock commit, Task 4B patch, and Task 6A patch above remain unchanged. Task 8D is the separate, repo-relative `production/patches/task8d-registration-gate.patch` (SHA-256 `c71153f96265fc3f1cc433dfe0d21f7092d4abce491d5d5200f7fd37ff6c72cc`), verified against a fresh stock+4B+6A checkout. The isolated runtime source is reproduced by applying these three patches in order; the source checkout itself is excluded from Git. At Task 8D acceptance the launch config set `REGISTRATION_ENABLED=false` independently of email login; the current tracked launch config is now `true`, as recorded below.

Task 8D deployed only to `buildcustom-vibesdk-launch`, version `6ff58ba1-83f5-4951-a3b6-022160ea61c5` (100%). Dry-run Worker bundle SHA-256: `fe0a4f18d3747be1f37c15911a561077b8b4d3681553ee6f43bcb7740259ba02`. Typecheck, build, focused auth tests and the full suite (525 passed, one skipped) succeeded. The direct runtime registration endpoint returned HTTP 403 `REGISTRATION_DISABLED`; provider capabilities reported email login enabled and registration disabled. No new tester was created. See `task8d-acceptance-report.md` for the outstanding private bootstrap and authenticated acceptance blocker.

## Reproducible current runtime source baseline (Task 9 + preview validation)

The pinned upstream commit, stock `bun.lock` SHA-256, and Task 4B/6A/8D patches remain unchanged. Password recovery is the additional, runtime-only patch `production/patches/task9-password-recovery.patch` (SHA-256 `a662e094f9343c4484165c2fbf93ee0d99480348ee49c2c01cb325e3f0007677`). Its source archaeology is BuildCustom commit `d096e4914383a2b1c1676e0d520fab6252a27999`, with the Email binding type adjustment from `829ddf1785ce6c347b5bd4807d1c621264b25cb7`; unrelated control-plane/UI changes from those commits are not included. The patch adds public CSRF/origin-protected forgot/reset endpoints, a non-enumerating reset-request response, rate-limited hashed one-time tokens, Cloudflare EMAIL delivery, and an atomic password update/session revocation. It includes focused service tests. Registration is independently controlled and currently enabled in the tracked launch config; that config declares `EMAIL` with sender `security@buildcustom.ai`.

Preview capability validation is the subsequent runtime-only patch `production/patches/preview-capability-validation.patch` (SHA-256 `0c7a8bdc378cf338e2fb65cca522320eea6dc575cd5857338db249b0e0c62118`). It exports a private service-binding validator that reuses the preview dispatch token and revocation checks without applying the dispatch rate limit or invoking generated-app code; focused validator tests are included.

Reproduce from the stock source without the ignored `runtime-source/` tree:

```sh
git clone https://github.com/cloudflare/vibesdk.git /tmp/vibesdk-source
cd /tmp/vibesdk-source
git checkout --detach 9da158d82c597a0e8f4bf033cdccd1053fb6fb15
git apply /path/to/production/patches/task4b-immutable-runtime.patch
git apply /path/to/production/patches/task6a-logout-revocation.patch
git apply /path/to/production/patches/task8d-registration-gate.patch
git apply /path/to/production/patches/task9-password-recovery.patch
git apply /path/to/production/patches/preview-capability-validation.patch
git apply /path/to/production/patches/continuous-coding-lifecycle.patch
git apply /path/to/production/patches/accepted-auth-source-provenance.patch
git apply /path/to/production/patches/continuous-coding-type-provenance.patch
cp /path/to/production/vibesdk-launch/wrangler.jsonc ./wrangler.jsonc
bun install --frozen-lockfile
bun run test -- worker/database/services/AuthService.password-reset.test.ts worker/database/services/SessionService.password-reset.test.ts worker/database/services/AuthService.test.ts worker/utils/envs.test.ts worker/api/controllers/auth/controller.logout.test.ts worker/api/controllers/auth/controller.test.ts worker/services/deployer/immutable-script-put.test.ts worker/services/deployer/platform-deployment-identity.test.ts worker/services/deployer/think-user-deploy.test.ts worker/agents/core/websocket.test.ts worker/services/deployer/api/cloudflare-api.test.ts worker/api/handlers/space-preview.test.ts
bun run typecheck
bun run build
```

Local checks against that reconstruction passed: 68 focused tests across eleven files, `bun run typecheck`, and `bun run build` with the launch config copied into the source root. The generated `dist/buildcustom_vibesdk_launch/wrangler.json` retained `REGISTRATION_ENABLED=true` and `EMAIL` with `security@buildcustom.ai`. The locked `bun.lock` hash remained `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`; pre-existing dependencies from the ignored runtime tree were used only as a local test/build cache after confirming the matching lock hash. They are not part of the recipe or source baseline.

## Continuous coding lifecycle release and production acceptance

### Accepted auth source provenance

Apply `production/patches/accepted-auth-source-provenance.patch` after the lifecycle patch. SHA-256: `a24db885294ac5d37122ceb5c1ef23667d7976e2b605908242a933bea8eb1ea3`.

This dedicated correction retains previously accepted/tested auth behavior that the earlier release inputs omitted. The registration schema-error boundary is evidenced by `scripts/task12l-inactive-runtime-candidate.mjs`, its candidate/regression artifacts, and the successful `task12m-precheck-2026-09-29T12-59-12-452Z.json` source/binding checks. Password-recovery/CSRF controller tests originate in the accepted password-recovery source at BuildCustom commit `d096e4914383a2b1c1676e0d520fab6252a27999`. Additional registration tests cover those accepted error contracts.

The patch captures the five previously reported differences exactly, including nonfunctional auth-service/session comments and environment-declaration formatting, so the canonical source remains the previously tested checkout. It introduces no new auth behavior, lifecycle changes, dependency changes, or normalization. The pinned upstream commit and accepted `bun.lock` hash above remain unchanged. The complete order is Task 4B, Task 6A, registration gate, password recovery, preview capability validation, continuous coding lifecycle, accepted auth source provenance, then continuous coding type provenance.

A full tracked-source comparison additionally identified an omitted browser-capture declaration file. Apply `production/patches/continuous-coding-type-provenance.patch` last (SHA-256 `1170a9e284f1cdd4e7854e6ee8fe0c164f00d1d36c6fb9e4bd744312f78e4101`). It retains the already-tested optional final URL/truncation fields and structural Page URL method exactly, with no emitted runtime behavior. Neither original lifecycle logic nor its original patch/hash changes. This final type-only provenance input completes the eight-patch reconstruction order.

The separate `production/patches/continuous-coding-lifecycle.patch` applies after the five accepted patches above. SHA-256: `3fe4d720abd59991574d5462a2b7340f1b65ada01beb3475a453c4dbdfab057e`. Its applicability was checked against the pinned upstream revision plus those five patches in an isolated temporary checkout. It preserves the original patches and lockfile.

This candidate implements durable customer-operation state, bounded native Think chat continuations, structured completion intent/evidence, read-only working-tree preflight, revision-bound preview verification, and continuation-aware context/transcript presentation. The ignored runtime checkout contains the implementation; the tracked patch is its durable release input. Evidence and limitations are recorded in `continuous-coding-lifecycle-evidence.md`.

After the authorized provenance correction, reconstruction from the pinned upstream source and all eight patches matched all 853 compared canonical source paths exactly. The lock hash was unchanged. The reconstructed candidate passed 163 tests across 23 runtime test files, `bun run typecheck`, and `bun run build`; the focused BuildCustom regression batch passed 127 tests. See `continuous-coding-release-operation.json` and `continuous-coding-production-report.md`.

Operation limits remain configurable through the existing `ThinkAgentConfig.operationLimits` and optional `THINK_OPERATION_MAX_*` host variables. The authorized production values are `THINK_OPERATION_MAX_CONTINUATIONS=4` and `THINK_OPERATION_MAX_ELAPSED_MS=900000`, with Think `maxSteps=25` unchanged: one original turn plus at most four continuations, five total turns. Other built-in fallbacks were not redesigned or calibrated in this authorization.

The runtime alone was deployed at 100% as version `122e2da3-5617-49cc-92ca-5c5723e30af3`, deployment `6cf030ed-a130-495b-825d-9fc09c79f706`. All seven uploaded module hashes and the retained bindings/assets/containers were verified before activation. Control plane and both gateways were unchanged. The immediately previous accepted runtime remains available for the prepared exact-version rollback. Complete post-deploy non-generation smoke passed.

**Production continuation acceptance is BLOCKED, not PASS.** The single disposable fixture sent exactly one customer coding request. Its native stream recorded an error after one Think turn and 12 tool outputs, with zero internal continuations. The owner runtime became idle, HEAD stayed unchanged, pending module edits persisted, and no preview or production Publish occurred. There was no `finish_task` or accepted COMPLETE result. The underlying native error and its causal relationship to the candidate are unresolved; conditional rollback was not invoked on missing optional telemetry or an unproven cause. Project 5 has not been read or touched; original edit1 was not resent; edit2 was not started.

`bun audit --json` reports high advisories in locked production imports, including Hono 4.12.19, Drizzle ORM 0.44.7, React Router 7.15.1, nanoid 5.1.11, and ws 8.20.1; the Vite/Cloudflare build graph also includes high-advisory Browserslist 4.28.2 and Undici 7.24.8. Vitest 3.2.4 is reported critical but is a dev/test-only dependency, not a serving dependency. No dependency was upgraded in this runtime-preparation task; these findings require separate triage before a public launch.

For version `122e2da3-5617-49cc-92ca-5c5723e30af3`, exact reconstructed-source parity and seven-module uploaded-byte parity were verified as part of this release. This does not retrospectively establish the source identity of earlier Worker versions, nor does source/build parity establish passing live continuation acceptance.