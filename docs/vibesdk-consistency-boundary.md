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