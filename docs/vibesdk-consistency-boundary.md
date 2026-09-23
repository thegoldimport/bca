# Isolated VibeSDK workspace consistency investigation

Status: **not proven; do not deploy the isolated candidate to the protected VibeSDK Worker.** Production runtime mutations remain disabled, and `app.buildcustom.ai` remains unattached.

Source inspected: public `cloudflare/vibesdk` at `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`. VibeSDK source is not part of the BuildCustom repository. The isolated investigation checkout was under `/tmp/vibesdk-consistency`; it is not a production artifact or a reviewed deployment candidate.

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