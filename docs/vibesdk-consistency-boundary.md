# Isolated VibeSDK workspace consistency investigation

Status: **not proven; do not deploy the isolated candidate to the protected VibeSDK Worker.** Production runtime mutations remain disabled, and `app.buildcustom.ai` remains unattached.

Source inspected: public `cloudflare/vibesdk` at `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`. VibeSDK source is not part of the BuildCustom repository. The isolated investigation checkout was under `/tmp/vibesdk-consistency`; it is not a production artifact or a reviewed deployment candidate.

## Executable-baseline gate

A fresh, unmodified checkout of public upstream `main` was made at `/tmp/vibesdk-baseline`, revision `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`. Its intended dependency manager is Bun (`bun.lock`, SHA-256 `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`), and `package.json` requires Node >=22. The local tools are Bun 1.3.6 and Node 22.22.0. **This checkout is a candidate, not a proven copy of the production source.**

The protected Worker version `8522e70c-27f4-4ef3-a46a-80edbd308490` was uploaded via Wrangler. Its version metadata does not identify a Git commit. The downloaded production and migration-staging bundles have the same recorded ETag, which proves bundle equality between those Workers, not source-revision provenance. The staging migration used database migrations from the above public commit, but that does not establish which source commit built the Worker. The downloaded bundle has module paths but no embedded Git SHA. Therefore the **exact production source revision remains unverified**.

The missing source-to-bundle link is a **production compatibility gate**, not a reason to claim the isolated public checkout is unusable. Current public upstream `main` still points to this same commit; no later upstream fix was found on `main`. The candidate's `SpaceDO.rollbackToCommit`, Think rollback/state handling, HTTP/RPC deploy paths and child-turn cancellation all match the observed defect shape, but this does **not** establish production source identity.

The unmodified candidate was installed using `bun install --frozen-lockfile` in both the repository root and its separately locked `sdk/` package. Both lockfiles remained unchanged. Results:

| Unmodified candidate check | Result |
| --- | --- |
| Repository TypeScript | passed |
| Repository existing tests | 40 files passed; 474 tests passed, 1 skipped |
| Repository build | passed; chunk-size warning only |
| Nested SDK build | passed |
| Nested SDK unit tests | 40 passed |
| Live SDK integration tests | **blocked**, not passed: its test module throws during collection without `VIBESDK_API_KEY`; no isolated test key was supplied and the test defaults to an external service |

Only test files/configuration were added to the isolated checkout after these baseline checks; **no VibeSDK implementation was changed**. `space/test/durable-object-composition.regression.test.ts` runs against actual `SpaceDO` methods and the test Worker’s SQL backend. On the unmodified candidate, it reports 2 expected failures and 2 passes:

| Regression | Baseline classification | Evidence/limit |
| --- | --- | --- |
| Failed restore commit must not report success | **REPRODUCES** | Expected rejection after injected commit failure; rollback instead resolved successfully and called deploy |
| Concurrent restore/edit must not lose edit | **REPRODUCES** | Barrier forced edit during restore; final file was `new` instead of `edited` |
| Concurrent restore/read must not expose a mixed tree | **DOES NOT REPRODUCE in this harness** | The exercised SQL-backed read returned a coherent old or new pair; this does not establish coverage of all read paths or Artifacts backend |
| HTTP/RPC deploy parity | **CANNOT FULLY TEST here** | Both returned failure without a LOADER binding; successful materialization and distinct error conditions were not compared |
| Think stale files, reconnect and next edit | **CANNOT TEST in pinned local harness** | Real Think import fails because pinned Vitest/Miniflare lacks the `cloudflare:workers` named `exports` binding; switching test-only dates cannot exceed its runtime ceiling |
| Think cancellation fence and persistence failure | **CANNOT TEST in pinned local harness** | Same missing runtime binding; no child-turn assertions ran |

A test-only real-Think Worker/DO harness was attempted. Pinned Vitest/Miniflare refused its import before test collection. A local-only Wrangler alternative could not bundle VibeSDK's `?raw` Markdown skill imports without the repository's Vite pipeline; it was stopped without contacting or modifying Cloudflare. These are **harness failures**, not passing or failing Think regressions.

The central ThinkAgent stale-file defect has therefore **not** been reproduced by an executable regression against the candidate. Per the owner’s sequence, **do not write another fix or deploy to isolated Cloudflare yet**. First make the real Think/SpaceDO test harness executable, then run the central B → A → read/edit/reconnect test against this unmodified checkout. Separately, recover a build manifest, source revision annotation, or reproducible artifact comparison before any protected-Worker deployment.

## Disposable real-Cloudflare baseline attempt

The owner subsequently authorized a narrower reproduction-only test on disposable Cloudflare infrastructure before any fix. A separate test-only Worker imported the unmodified candidate's `CodeGeneratorAgent`, `ThinkAgent`, and `SpaceDO` classes, with a test subclass of the host agent and fixed-name RPC endpoints. The deployed source checkout remained at `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`; no tracked VibeSDK source, package, or lockfile was changed. A dry-run reported exactly three Durable Object bindings and no D1, KV, R2, dispatch, Artifacts, service, container, route, AI, browser, or production binding.

The Worker was named `vibesdk-restore-repro-20260923`. Its final test-only version was `f7fe7b27-60ed-44dc-b442-db32bc52b9fc` (initial version `d2ea4a52-332d-40f7-add6-27e2d382cfcb`). Cloudflare created these **new, test-only** Durable Object namespaces:

| Binding/class | Namespace ID |
| --- | --- |
| `CodeGenObject` / `RestoreReproCodeGeneratorAgent` | `7960e463f39c4634a97cc8efa26b73a2` |
| `SPACE_DO` / `SpaceDO` | `1978864521c14dc8b51906908a83443e` |
| `THINK_DO` / `ThinkAgent` | `b7f2b8a13b5841b0a588c83c8fbfa8fb` |

The test adapter bypassed normal application initialization (which needs D1/model configuration), wrote markers through actual SpaceDO RPCs, seeded the host file projection with `FileManager.recordFileChanges`, and invoked the real `ThinkCodingBehavior.rollbackToCommit`. **This is not proof of a full generated ThinkAgent lifecycle**: the child ThinkAgent never ran a chat/edit turn, the file map's B state was injected as test setup rather than generated by an agent, and no authenticated BuildCustom-style HTTP read was exercised.

On the second isolated run, commit A was `0c2d24b25b12213419364c067e0f33dc4b91f0b5`, commit B was `c15c6f819ada22a34b86136bab3a628bb18f36d5`, and the recorded pre-restore authoritative reads were `THINK_RESTORE_TEST_B` in `/index.html` and the B-only `/removed.txt`. After the actual behavior's restore call, SpaceDO read **B** in `/index.html` and reported `/removed.txt` missing; the host `generatedFilesMap` still read **B**. A separate request using the same fixed agent name again read B from both. The branch log had a new rollback commit `0a022cd4469daa497af928d55d074daa1cdbda9c` above B. A diagnostic `gitCheckout(A)` followed by `readFile` also read B; because the same overlay is involved, this does **not** independently prove the committed A blob contained B. `getDeployment('main')` returned `No deployment found for branch "main"`. An earlier run similarly returned B after restore (A `37780eab94ae718c30f51090ba36c7802311b58d`, B `9e6081210d831aa9174c1acfcfb432b48d3abed3`).

**Classification:** The isolated Worker and real SpaceDO/host DO RPCs started successfully, but this minimal setup did not establish a successful A → B → restore A or deployment/preview. It therefore cannot reproduce the central *SpaceDO = A while ThinkAgent = B* regression or prove the next edit starts from stale B. The result could reflect restore behavior, the local-commit/overlay seeding method, or missing full deployment prerequisites; no root cause was established. Forced commit failure, concurrent restore/read/edit, child cancellation/reconnect, next edit, authenticated adapter reads, and HTTP/RPC deploy parity were **untested** in this Cloudflare attempt. A same-agent fresh HTTP request confirmed persisted host B and SpaceDO B, not a real WebSocket reconnect state.

Per the owner's stop rule, no consistency fix or further canary was attempted. Because the test Worker exposed a short-lived public test endpoint, it and its three new DO namespaces were deleted after evidence capture; Cloudflare confirmed the Worker no longer exists and no matching namespaces remain. No protected Worker, namespace, control-plane gate, or `app.buildcustom.ai` route was changed. The remaining prerequisite is a safely isolated **full** unmodified candidate lifecycle with independently verified A/B commit contents and a successful authoritative restore before testing ThinkAgent hydration or editing.

## Normal-application isolated attempt

The owner then authorized a fully initialized, disposable VibeSDK test using normal registration, API-key exchange, agent creation, WebSocket transport, and Think generation. The unchanged public candidate remained `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`, with its pinned compatibility date and dependencies. A separate test-only Wrangler config pointed the candidate's **normal `worker/index.ts`** at fresh resources, with no production binding, route, domain, account-wide Cloudflare token in the Worker, or application-source change. Cloudflare denied creation of a separate Artifacts namespace (feature gate 10004), so this attempt used VibeSDK's normal SQL-backed SpaceDO option rather than sharing the protected Artifacts backend.

| Disposable resource | Identity |
| --- | --- |
| Worker | `vibesdk-real-restore-20260923`; last secret-change version `56df7a4d-4c82-4cb4-b3cc-91df21d49ab2` |
| D1 with candidate migrations | `vibesdk-real-restore-20260923-db`, `de53d7bd-903a-4805-a442-3be1b59e3c74` |
| KV | `vibesdk-real-restore-20260923-kv`, `0d5006d4993a4ffe86a4d0d507b87774` |
| R2 templates bucket | `vibesdk-real-restore-20260923-templates` (unused on the Think path) |
| Dispatch namespace | `vibesdk-real-restore-20260923-dispatch` (no customer Worker published) |
| AI Gateway | `vibesdk-real-restore-20260923` |
| Container application | `vibesdk-real-restore-20260923-userappsandboxservice`, `a03f395e-7b16-4366-a01d-2f63cb899254`; uniquely tagged image `64ab60ba` |
| Host, rate limiter, sandbox, secrets DO namespaces | `b5331372b700448cbff677529e38d59b`, `59c8fae509ca4d37b50bf95916d5ebcb`, `0380b8bc4c3540df9377c47fa3468775`, `b27775ded5c843c8b96a0707fc23e8eb` |
| SpaceDO, ThinkAgent namespaces | `80dcaed0a77c49638b981eb672726cfc`, `20fd320e7e2147798b5ac167639f651e` |

The test Worker passed the normal health endpoint. Two disposable test users registered using the normal CSRF-protected authentication API and created isolated API keys. The first SDK attempt incorrectly used `AgenticClient`, which requests VibeSDK's **legacy `agentic` behavior**, not the current Think behavior: template catalog lookup failed, and SDK retries consumed that user's three app-creation slots. No agent was created in that attempt. For the actual Think test, the general VibeSDK client explicitly requested `behaviorType: "think"` with retries disabled, matching the normal browser app feature. It created agent `41146538-41a9-4c19-b09d-52d634835cdd`, connected by the normal ticketed WebSocket, and reached the real child ThinkAgent chat RPC. The model call for `google-ai-studio/gemini-3.6-flash` returned **HTTP 400 Bad Request**. The transport emitted an error and then `generation_complete`; that event did not mean generation succeeded. Normal authenticated reconnect showed **zero files** and no `restore-marker.txt` or `RESTORE_REAL_A`.

**Hard gate and classification: NOT REPRODUCED (initial generation blocked).** No committed A blob/hash exists; B, the pre-restore A/B SpaceDO tree, normal restore, post-restore SpaceDO state, Think-versus-Space comparison, authenticated BuildCustom adapter reads, and next edit were **not attempted**. A WebSocket reconnect worked but returned zero files. The gateway's exact 400 cause was not established. No SpaceDO restore defect or ThinkAgent stale-state defect is proved by this attempt. Do not infer success from the `generation_complete` frame. The required next prerequisite remains successful **real Think generation** followed by independently verified committed A and B before any restore.

After stopping at the A gate, the public test Worker, all six test DO namespaces, D1, KV, R2, dispatch namespace, AI Gateway, container application, and its uniquely tagged image were deleted. Cloudflare confirmed no test-named DO namespaces, Worker, D1, KV, R2, dispatch namespace, gateway, container application, or image remain. The protected Worker and control-plane versions, runtime mutation gate, and `app.buildcustom.ai` attachment were not changed.

## Normal-generation configuration review (no new deployment)

The next investigation was deliberately restricted to Cloudflare's [VibeSDK setup guide](https://github.com/cloudflare/vibesdk/blob/main/docs/setup.md), [AI Gateway authentication](https://developers.cloudflare.com/ai-gateway/configuration/authentication/), and [OpenAI-compatible gateway routing](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/). VibeSDK setup selects a provider key (Google AI Studio is recommended), configures AI Gateway, and automatically sets `CLOUDFLARE_AI_GATEWAY_TOKEN` to an API token when that gateway option is chosen. Cloudflare documents separate `Authorization` (provider key) and `cf-aig-authorization` (gateway token) headers for requests with a provider key. AI Gateway Run tokens are **account-scoped**, not restricted to one gateway.

Read-only settings and secret-name inspection confirmed that the protected `buildcustom-vibesdk-staging` Worker has both `GOOGLE_AI_STUDIO_API_KEY` and `CLOUDFLARE_API_TOKEN`, plus `JWT_SECRET`, `AI`, `DB`, `VibecoderStore`, `TEMPLATES_BUCKET`, `DISPATCHER`, `LOADER`, container/Sandbox, SpaceDO, ThinkAgent, host and secrets DO bindings, rate limiters, `nodejs_compat`, and compatibility date `2026-05-23`. It does **not** have a separate `CLOUDFLARE_AI_GATEWAY_TOKEN` binding; the candidate's token resolution accepts the account-token fallback. These settings do not establish its exact source commit or Think model identifier. The prior disposable Worker had isolated counterparts for its normal data, dispatch, container, DO, gateway, JWT, and provider-key bindings, and worked for authentication and Think transport, but **deliberately lacked both gateway and account API tokens**; Artifacts namespace provisioning was refused and normal SQL-backed SpaceDO was used.

In the unmodified candidate, Think resolves `google-ai-studio/gemini-3.6-flash`. Without either gateway/API token, its `useStoredKeys` flag becomes true even if `GOOGLE_AI_STUDIO_API_KEY` exists; the Think fetch then strips the provider `Authorization` header. The old isolated gateway had no stored provider key configured. This is a concrete mismatch with the intended provider-key-plus-gateway-token path and a plausible explanation for the failed inference, **not proof of the exact 400 origin**. The only captured error from the deleted gateway was `AI_APICallError: Bad Request` (HTTP 400 at the model request), without a provider/gateway-specific code or response body. The gateway and its logs were deleted before this review. Do not attribute that 400 definitively to Google, AI Gateway, or malformed model construction.

Cloudflare's token-management API returned `9109 Unauthorized` for a read-only permission-group lookup using the available connection. A new gateway-only Run token cannot be assumed available; Cloudflare explicitly states Run tokens grant access to **every** gateway in the account, including those with stored provider keys. Placing the protected account token or any other production credential in a new disposable Worker would violate isolation. No token or test infrastructure was created in this review. **Hard stop: BASELINE A NOT PROVEN.** No new model call, generation, `index.html`, workspace persistence, authenticated file read, reconnect, or A commit/hash was obtained; no configuration or VibeSDK source/dependency was changed.

The earlier `generation_complete` after `error` is explained by the candidate's base generation wrapper: it broadcasts an error on failure, then unconditionally emits `generation_complete` in `finally` and marks app status `completed`. The Think behavior separately broadcasts the error from a failed chat turn. BuildCustom must not treat the completion signal or status alone as evidence of successful generation; it must also handle the error event and confirm persisted file content. This was read-only protocol analysis, not a protocol fix.

## Operation map

| Operation | Entry point | Reads from | Writes to | Current synchronization | Materialization |
| --- | --- | --- | --- | --- | --- |
| Generation and conversational edit | ThinkAgent chat and Space workspace tools; `worker/agents/core/behaviors/think.ts` | SpaceDO file RPCs and Think conversation | SpaceDO overlay; mirrored Think `generatedFilesMap` | Think turn state is separate from SpaceDO; host `generationPromise` is in-memory | SpaceDO deploy reads branch/overlay |
| Direct file read/write/edit/delete | `space/src/space/durable-object.ts` RPC methods | SpaceDO backend and overlay | SpaceDO overlay and whiteouts | Independent awaited RPCs in upstream source | Reads hydrate individual files |
| File listing and Think hydration | SpaceDO `readDir`/`glob`; Think state over `agent_connected`; BuildCustom adapter `files`/`fileContent` | SpaceDO for tools; Think `generatedFilesMap` for BuildCustom file APIs | Think state and adapter session cache | Reconnect reads Think state, not an authoritative post-restore SpaceDO snapshot | Whole-tree SpaceDO operations call `materializeAll` |
| Revision and commit | SpaceDO `gitCommitLocal`/`gitCommit` and branch Git RPCs | SpaceDO Git, overlay and Artifacts backend | Git branch and checkpoint | Some backend pushes occur asynchronously | Checkpoint and Git tree |
| Turn and release restore | BuildCustom turn/release APIs share `rollback_to_commit`; Think behavior calls SpaceDO `rollbackToCommit` | Historical SpaceDO commit | SpaceDO tree, new forward commit, preview; Think state currently **not refreshed** | Upstream restore awaits multiple operations without a shared read/write boundary | SpaceDO deploy from restored branch |
| Preview, HTTP deploy, RPC deploy | Think preview/deploy, SpaceDO `fetch(?cmd=deploy)`, SpaceDO `deploy` | SpaceDO workspace/Git | Deployment metadata and generated preview | HTTP and RPC use different materialization/checkpoint/push paths upstream | HTTP command handler vs RPC `materializeAll` + checkpoint + deploy |
| Reconnect | VibeSDK `agent_connected`, BuildCustom authenticated session | Persisted Think state | Local client file cache | No authoritative SpaceDO recheck before returning files | None |
| Cancellation | Think host `cancelCurrentInference` and `stop_generation` | Host in-memory generation state | Host terminal state | Child ThinkAgent chat can continue without an abort/fence RPC; reset can lose host ownership | Partial SpaceDO writes may remain |

SpaceDO is the only authoritative workspace. Think `generatedFilesMap` is an editor/API projection, not a second authoritative repository. The existing `FileManager.syncGeneratedFilesMapFromGit()` reads legacy agent-local Git rather than the SpaceDO branch and is not a valid restore refresh.

## Bypasses and failed isolated review

- Upstream restore reports deployment completion without rehydrating Think files; BuildCustom reads the stale Think projection.
- SpaceDO file, Git, bundle/export and HTTP reads can interleave with restore's multi-await checkout/reconciliation unless they use the same native consistency boundary as workspace writes.
- HTTP deploy and RPC deploy do not share all materialization, checkpoint, push and result semantics.
- An isolated FIFO/snapshot candidate was **not accepted**. Its commit-error catch could report a restored snapshot while branch commit or deployment failed. It did not fully fence an active child ThinkAgent turn across cancellation, reconnect and host reset; it also emitted the wrong state message and left background Git/checkpoint work outside the FIFO.
- The checkout lacked VibeSDK dependencies, so neither VibeSDK typecheck nor integration tests were completed. No disposable staging runtime deployment or deterministic A → B → restore A → edit C test was performed. Source inspection and a passing `git diff --check` are not acceptance evidence.

## Required isolated proof before requesting production approval

1. Fail closed on every restore/commit/deploy/persistence error; recover branch checkout on failure. Verify restored HEAD/tree and deployed commit before announcing success.
2. Make consistency-sensitive SpaceDO reads and writes observe one native serialized boundary, including backend push/checkpoint effects and HTTP/RPC deploy parity.
3. Fence or cancel an already-running child ThinkAgent turn before restore, including after reconnect/reset. Replace the entire Think file projection from the authoritative SpaceDO result, persist it without swallowing errors, and emit the existing correct state event.
4. Install/test VibeSDK in a genuinely isolated environment. Exercise real SpaceDO methods and both HTTP/RPC deploy paths under forced concurrent restore+read/edit/deploy/reconnect/cancellation.
5. Use a disposable isolated project to verify Revision A (`RESTORE_TEST_A`) → B (`RESTORE_TEST_B`) → restore A → A-dependent edit → C. Compare SpaceDO hashes, Think state, authenticated reads, preview, HTTP/RPC deploys and reconnect. Exercise both turn and release restore entry points.
6. Obtain independent architecture review of the tested candidate. **Stop before any protected VibeSDK Worker deployment** and present the requested resource/version/rollback plan for owner approval.