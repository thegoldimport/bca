# Read-only VibeSDK production compatibility review

Status: **STOP before production deployment. PATH B: recover the protected build source more precisely.** Review performed against the protected Cloudflare Worker metadata and downloaded bundle, the frozen isolated candidate, and the recorded production runtime observations. No production or staging Worker, data, agent, domain, route, secret, or runtime gate was changed.

## Frozen isolated patch

- Public candidate base: `cloudflare/vibesdk` commit `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`. Isolated checkout at `vibesdk-candidate/`; the public Git commit does **not** establish production source identity.
- Exact four-file unified diff: [`vibesdk-frozen-consistency.patch`](vibesdk-frozen-consistency.patch), SHA-256 `5df8c562a250005431ff3d3a0e8c7e3f276a5d1ec05ed97185f5405aebaa0bb1`. `git apply --check` succeeds against the pinned base without applying it. The patch contains only the following differences relative to that base:

| Category | File | Candidate SHA-256 |
| --- | --- | --- |
| Production SpaceDO logic | `space/src/space/durable-object.ts` | `6a17898d3cf7906c66f971a78aaa3c08fba7bbde3c1f9fa587b24299e24e3a0` |
| Production Think logic | `worker/agents/core/behaviors/think.ts` | `8d6016243e50ef52a64f54618e1410dba3692fbe5a2c3348a6b68b24cca84609` |
| SpaceDO regression tests | `space/test/restore-authoritative.regression.test.ts` | `682501e6c930f6e737470cda3f87f7359c8156ec2cb5ab08563af80b284cdf85` |
| Think regression tests | `worker/agents/core/think-stale-state.regression.test.ts` | `87c1588d9f7c5eb1655068d6df313e6af68577b8b1c782ef54581efbb11dec6f` |

The tracked base-to-candidate comparison found **no other changed or added files**. Root `bun.lock` matched the base (SHA-256 `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`); nested `sdk/bun.lock` also matched (SHA-256 `c77cf81924b12195c5081bf295679c8eb459d64b7b6602e19d08be1ca1e07ffa`). No package manifest, dependency, Wrangler configuration, class name, binding, or migration was changed by this patch. This is a **source patch for the candidate**, not a deployable production build.

## Protected artifact and provenance

Read-only Cloudflare deployment metadata confirmed `buildcustom-vibesdk-staging` (the historically named **production** Worker) serves version `8522e70c-27f4-4ef3-a46a-80edbd308490` at **100%**. Version 18 was uploaded with Wrangler on 2026-09-18; source is `wrangler`, annotation is `workers/triggered_by: version_upload`, compatibility date is `2026-05-23`, flag is `nodejs_compat`, and migration tag is `v6`. Its script ETag is `6f562ac07f0b3d55648838023d7ee9836c2209c6ddc56feff7386a01a2d5501f`.

The current deployment of the separate `buildcustom-vibesdk-migration-staging` Worker uses version `e8a7042e-8b17-4d6b-ac1a-f02e77c3511f` at 100%; its script ETag is **identical**. Its latest version was triggered by a secret change, has migration tag `v1`, and uses separate staging resource bindings. Equality of script ETags proves the script artifact matches, **not** that either resource configuration or source checkout is identical.

The protected version's exported classes include `CodeGeneratorAgent`, `DORateLimitStore`, `SpaceDO`, `ThinkAgent`, `UserAppSandboxService`, and `UserSecretsStore`. Binding inspection confirms the existing `SPACE_DO` (`8da59df6a1224ce0b5be40147718c001`), `THINK_DO` (`76cfd082b3754a548948cce0029e9846`), four other DO bindings, D1 `DB` (`9b8637f3-be5b-461b-8627-b09b03cea180`), KV `VibecoderStore` (`ce7e7b0ba56343e7b50556b3cabfb53e`), R2 `TEMPLATES_BUCKET`, dispatch `DISPATCHER`, `Sandbox`, `LOADER` worker loader, `AI`, assets, browser, rate limiters, and secret **names**. No normal `service` binding is listed; the loader is a `worker_loader` binding. The bundle has no exposed source map part or inline map pointer, no visible repository commit annotation, and no match for the pinned public SHA. The repo's deployment workflows, local build/dry-run outputs, Wrangler metadata, and recorded production history yielded no chain from this version to a Git commit, lockfile, or reproducible build manifest. The external Worker's upload did not create a Replit deployment/source record.

**Provenance: EXACT SOURCE STILL UNKNOWN.** The strongest artifact evidence is the shared script ETag plus direct inspection of the protected deployed JavaScript. Neither an ETag, matching module paths, a Wrangler upload timestamp, nor a matching staging migration identifies the source revision or dependency lock used to build it.

The production control-plane deployment was separately confirmed still at version `a7e0b81b-c017-4fab-a753-380ccf5b9332` (100%) with `RUNTIME_OPERATIONS_ENABLED=false`. `app.buildcustom.ai` remains unattached per the protected configuration; this review made no route or domain changes.

## Touched-path structural comparison

**SpaceDO.** The protected bundle implements `rollbackToCommit(branch, commitHash)` with branch history lookup (`git.log` depth 1000), checkout of the target, file capture through the overlay, checkout of the branch, removal of obsolete overlay files, rewrite of target overlay files, `gitCommit` inside an empty catch, and then `deploy(branch)`. Its bundled `stageWorkdir` uses `statusMatrix` and skips `111`, the same mechanism that missed a same-size rapid rewrite in the unmodified candidate. Bundled `gitCommitLocal`, `gitLog`, `glob`, `readFile`, `walkTreeFiles`, `readBlobBytes`, and Artifacts push are present. The isolated patch instead reads target Git blobs, reconciles via the backend FS, verifies the written bytes, stages every target path, verifies the committed tree, checks Artifacts push, then deploys. This is **direct behavioral evidence of the same vulnerable architecture**, not merely a shared function name. The isolated canary proved the correction on the SQL-backed SpaceDO path. The protected metadata has `ARTIFACTS_NAMESPACE` as plain text but **no `ARTIFACTS` or `ENABLE_ARTIFACTS` binding**; this source's mode selector would choose SQL for a fresh object unless pre-existing Artifacts state pins that object to Artifacts. Existing DO storage modes were not queried, so do not claim they are all SQL or Artifacts. The protected source/lock used to build these bundled helpers is unverified.

**ThinkAgent.** The protected bundle's `rollbackToCommit(commitHash)` calls SpaceDO restore, calls `handleDeploySpaceOutput`, then sends a conversation-success frame, without replacing `generatedFilesMap`. The downloaded code accesses `this.state.generatedFilesMap`, and its state wrapper forwards updates to `this.infrastructure.setState`; the deployed and candidate methods use the same branch/commit RPC shape. The patch adds authoritative `glob`/`readFile` retrieval after restore, replaces the existing map through the underlying persistence path before a result frame, refreshes even if a committed restore later fails preview deployment, and no longer sends success after a reported deployment failure. The bundle has the required RPC methods. This supports **the same stale-projection mechanism**; it does not identify the production source revision or validate every existing-agent state variant.

**Portability verdicts:** SpaceDO **C — CANNOT ESTABLISH SAFELY**; ThinkAgent **C — CANNOT ESTABLISH SAFELY**. Both have strong touched-path structural agreement and no concrete contradictory signature, but a clean source-level application, dependency-compatible rebuilt bundle, existing DO backend modes, and old-agent/rollback behavior cannot be certified from the downloaded compiled artifact alone. These are not claims that the fixes are incompatible.

## Durable state and rollback

The frozen diff introduces **no new persistent field or table, DO class name, namespace, migration, D1/KV/Artifacts format, dispatch namespace, binding, or storage service**. SpaceDO still writes Git commits on the existing branch and invokes its existing backend/deploy interface; Think replaces the existing `generatedFilesMap` in the existing state object while spreading all other fields. The prior Worker already reads this map and the same Git objects. The failure path can set the map to `{}`, a shape the prior code accepts, but rolling back at that point would not itself repopulate the view. Thus there is no **patch-introduced schema migration**, but seamless live rollback and restoration of user-visible state after an exceptional failure have **not** been proved.

An agent created before the patch should not need a new identifier, workspace association, conversation format, or SpaceDO identity according to the candidate diff. Existing persisted `generatedFilesMap` entries are read and replaced in the same shape. Still, no protected existing agent has reconnected to a patched version, and the exact persisted state of all production agents is not known. **Existing-agent and actual rollback compatibility remain UNKNOWN**, not an authorization to deploy.

Task #57's protected-runtime observations support the architecture: existing-agent reconnect, file retrieval, Plan Mode, edit, revisions, protected preview, cancellation acknowledgement, native publish, and generated app HTTP 200 worked. The historical restore accepted the requested commit, executed the SpaceDO path, deployed a preview, and returned a matching commit, while the BuildCustom-facing file state stayed pre-restore. Those observations do not prove the authoritative restored tree or the source SHA. Separately, isolated unmodified-candidate tests reproduced a mixed committed restore tree and stale Think file projection; frozen-fix real Cloudflare canaries verified authoritative restore and session/reconnect synchronization. The isolated buildable A → B → restore A run previewed at HTTP 200 at all three gates. None of these canaries modifies or proves parity with production Artifacts storage.

## Decision matrix

| Question | Result | Concise basis |
| --- | --- | --- |
| Exact source provenance | **UNKNOWN** | Wrangler metadata, bundle, history and available build records have no source SHA/lock fingerprint |
| SpaceDO patch portability | **UNKNOWN** | Same vulnerable compiled path; source-level rebuild and pre-existing DO backend modes unproved |
| ThinkAgent patch portability | **UNKNOWN** | Same RPC/state mechanism; live old-agent state and source-level rebuild unproved |
| DO storage/schema compatibility | **PASS** for *patch schema only* | Diff changes no persistent schema, class, migration, namespace or field shape; production data behavior separately unknown |
| Existing-agent compatibility | **UNKNOWN** | Existing state shape is preserved by patch, but pre-patch live agents have not run patched code |
| Old-version rollback compatibility | **UNKNOWN** | Existing map/Git formats remain readable; exceptional empty-map state and live reversion not tested |
| Binding compatibility | **PASS** for binding requirements | Patch adds no bindings; protected artifact exposes required RPC/DO and existing resource bindings |
| Dependency/runtime compatibility | **UNKNOWN** | Candidate locks unchanged; protected build dependency and source fingerprints unavailable |
| Task #57 runtime evidence | **PASS** as supporting observations | Protected flows operated; stale file view observed after historical restore, tree/source not proven |
| Isolated canary evidence | **PASS** for candidate | Both fixes and A/B/restored-A preview verified on isolated SQL-backed SpaceDO; not existing production DOs |

**Recommended PATH B.** Reconstruct the exact protected source-to-bundle lineage, or at minimum a reproducible protected-source artifact and dependency manifest, before constructing a production-compatible candidate. The next step is to locate the September 18 Wrangler upload's original checkout/build manifest (operator/CI records or retained bundle/source-map archive), then compare the touched source and lockfiles against this frozen patch. **Do not perform a protected deployment, production restore/canary, route change, or runtime-gate change as part of that step.**