# Continuous-coding observability: final report

**Overall status: BLOCKED.** Local safety and regression gates passed, and the minimum runtime-only instrumentation was deployed successfully. The one fresh disposable production fixture stopped at its owner-scoped preflight. No customer coding request was sent. No further fixture, retry, repair, or production Publish was attempted.

## Safety corrections

- Metadata factories, getters, assignments used only for diagnostics, error inspection, formatting, and logging run inside protected best-effort boundaries. Failures drop a diagnostic field or event, not the original callback, result, or exception.
- Original application error identity, callback count, KV write arguments/order, cancellation, and continuation behavior are preserved by the instrumentation. No lifecycle, maxSteps (25), continuation (4), elapsed-time (900000 ms), preflight, deploy_space, authentication, ownership, gateway, or Publish behavior was intentionally changed.
- The diagnostic record accepts only approved identifiers, bounded numbers, booleans, fixed component/event/tool/state/SDK enums, and an exact-allowlisted error name/code. Arbitrary messages, stack headers, prompts, reasoning, arguments, results, generated code, credentials, and WebSocket close reasons are **not logged**.
- Stacks are reduced to at most five verified internal source frames with filename and bounded line/column only. Causes are classification-only, bounded to three levels and safe against circular references or throwing getters. Sink and serialization failures drop the record.
- Adversarial tests passed for throwing factories and getters; logging and JSON failures; circular, nested, and malicious errors; bearer/JWT, short, nested-cause, and stack-header credentials; WebSocket reasons; callback scheduling; and exact original-error identity.

## Diagnostic call-site audit

**38 direct diagnostic/guard calls and 23 uses of the wrapper around existing operation writes** were enumerated in `observability-diagnostic-call-sites.json`. Every diagnostic metadata factory is lazy or runs under the explicit safety guard. No arbitrary free-text field is emitted at any call site. Context values are rechecked against the allowlist at the common sink; producer, getter, serializer, or sink exceptions are swallowed only for diagnostic work.

| Source | Boundaries | Recorded fields, subject to allowlist |
| --- | --- | --- |
| `worker/agents/think/ThinkAgent.ts` | `operation.persistence`, `think.stream-result`, `tool.execution`, `think.onStepFinish`, `tool.execute-and-evidence`, `think.beforeStep` | Agent/user/native request/conversation/operation IDs, operation state and counts, permitted storage key/tool name, tool call ID, step, SDK stage/stream status, finish-reason enum, token counts, safe error classification |
| `worker/agents/think/stream-forwarder.ts` | `rpc.callback`, `stream.forwarding`, `rpc.callback.onDone`, `rpc.callback.onError`, `rpc.callback.onError.delivery` | Request/operation IDs, allowed chunk type/tool name/call ID, safe error classification; never the forwarded JSON or error string |
| `worker/agents/think/finish-task-tool.ts` | `driver.initial-lifecycle`, `driver.recover-pending-chat`, `driver.recovery-decision`, `driver.mark-chat-started`, `driver.chat`, `driver.error-lifecycle`, `driver.mark-chat-resolved`, `driver.post-chat-lifecycle`, `driver.post-chat-operation`, `driver.post-chat-decision`, `driver.onPassEnd` | Operation/conversation IDs, turn/pass/resource counters, state/decision enums, safe error classification |
| `worker/agents/core/behaviors/think.ts` | `host.stub.chat`, `host.pass` | Host IDs, pass counts, prompt-kind/decision enums, safe error classification |
| `worker/agents/core/codingAgent.ts` | `host.websocket` | IDs, numeric close code/readyState, wasClean, safe error classification; **no close reason** |

Review verdict: **PASS**. The reviewer noted two evidence limitations, not unsafe paths: some internally prefixed operation IDs are omitted by the strict identifier pattern, and a synchronously observed hook may return an unsettled Promise. No raw text is kept to work around either limitation.

## Local verification and provenance

| Gate | Result |
| --- | --- |
| Observability/adversarial tests | 27 PASS |
| Full selected runtime regression batch, including lifecycle | 190 PASS across 24 files |
| Typecheck | PASS |
| Canonical production build and Wrangler upload dry run | PASS |
| Task 4B / Task 6A | PASS |
| Ownership, preview sandbox, gateway/public routing and Publish regressions | PASS, 132 root tests in total |
| Explicit independent safety review | PASS |
| Reconstructed source comparison | 857 paths compared; differences only in the seven expected instrumentation/test source files; no unexpected differences |
| Lockfile | Unchanged |

The initial dry-run command pointed to a nonexistent output directory in the working checkout. The build itself passed. Packaging was repeated successfully from the accepted production reconstruction with its canonical Wrangler configuration; that successful dry run supplied the deployed module set. The patch is in `production/patches/continuous-coding-observability.patch`, and the source-parity and verification records are in this directory.

## Runtime deployment and non-AI smoke

- Previous and rollback runtime version: `122e2da3-5617-49cc-92ca-5c5723e30af3`
- New active runtime version: `f4488693-4424-46a3-9834-30b214645449`
- Rollout: **100% runtime only**
- Existing bindings, assets, containers: retained.
- Control changed: **NO**. Gateway changed: **NO**. Production Publish: **NO**.
- Post-deployment read confirmed the new active runtime and unchanged control and gateway versions.
- Anonymous non-AI runtime health, public capabilities, registration-provider configuration, unauthenticated identity, and impossible-ID ownership checks: **PASS**. Smoke record: `observability-smoke.json`.

## One fresh disposable fixture

- Project: **7**, new disposable owner. Agent: `914d67b0-7ad9-482e-8825-01a93e272ad3`.
- Registration requests: **1**, success. Project creation requests: **1**, success. New fixtures: **1**.
- Customer coding requests: **0**. A browser was **not** opened and no `user_suggestion` was emitted.
- Read-only observation after the failed setup: connected and idle generation indicators, **zero** Builder customer turns, but the live status did not establish the harness's expected configured/provider/agent identity fields. The independent SpaceDO Git revision read was not confirmed. The harness therefore did not certify its idle/revision baseline.
- Earliest retained failure: operator setup, `agent-identification` preflight. Its original thrown error was not retained as a typed runtime diagnostic; the safe checkpoint records the stage only. The subsequent read-only snapshot supplies the evidence above. Do not infer a Think, Cloudflare, or provider failure from it.
- WebSocket: **not opened for coding**. RPC/tool steps/Think turns/continuations/25-step boundary: **not exercised**. Provider: **not called**. Generated-app preflight, commit, preview, browser verification, finish_task, authoritative post-build revision, clean working tree, and COMPLETE: **not established**.
- Workspace safety: no coding operation ran; independent workspace/Git cleanliness could not be certified through the approved read-only evidence path. No production Publish occurred.
- Failure classification: **OTHER: operator acceptance-preflight contract mismatch**, with high confidence that the preflight blocked the request; the separate SpaceDO read failure's underlying cause is **STILL INSUFFICIENT EVIDENCE**. No evidence that runtime instrumentation caused either.
- Multi-turn production lifecycle proven: **NO**.

Project 5 read or touched: **NO**. Project 6 retried or repaired: **NO**. Project 7 will not be retried under this authorization. The new agent-specific log tail was not opened because the fixture stopped before the coding request.

## Rollback recommendation and next step

Do **not** automatically roll back a runtime that passed safety review and non-AI smoke on the basis of this operator preflight mismatch. Keep `122e2da3-5617-49cc-92ca-5c5723e30af3` as the recorded rollback version if separate evidence identifies a runtime regression. Treat generated-app and multi-turn acceptance as **unproven**.

**Exact next recommended step:** obtain separate authorization to validate the owner-scoped live status and revision-evidence contracts with an isolated, disposable simulation, correct the acceptance operator without changing production lifecycle behavior, and only then authorize a new one-shot fixture. Do not reuse Project 7, retry Project 6, or access Project 5.