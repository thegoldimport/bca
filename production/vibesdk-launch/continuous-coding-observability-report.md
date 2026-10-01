# Continuous-coding observability authorization report

## OVERALL STATUS: BLOCKED

Stopped at the local observability safety gate. No runtime deployment, new fixture, customer coding request, production Publish, or rollback was performed.

The local safety review identified two blockers:

1. Diagnostic context construction occurs outside the protected logging boundary. A throwing metadata factory/getter can prevent an existing callback or replace the original operation error. Protecting only the final console call is insufficient.
2. Pattern-based redaction can retain unlabelled customer content or short opaque credentials in arbitrary error text, stack headers, nested causes, or client-supplied WebSocket close reasons.

These findings prevent certification of the required observability-only equivalence and secret/content protection, despite passing functional tests. Per the authorization's STOP condition, no further implementation, build, deployment, or fixture attempt was undertaken after the findings.

## OBSERVABILITY

Files changed in the local, ignored runtime checkout, relative to `production/vibesdk-launch/runtime-source/`:

- `worker/agents/think/diagnostics.ts` — new structured diagnostic helper.
- `worker/agents/think/stream-forwarder.ts` — extracted existing RPC forwarder with diagnostic hooks.
- `worker/agents/think/diagnostics.test.ts` — 12 focused tests.
- `worker/agents/think/ThinkAgent.ts` — supported Think hooks, tool failures and existing KV put observation.
- `worker/agents/think/finish-task-tool.ts` — operation-driver and continuation-decision observation.
- `worker/agents/core/behaviors/think.ts` — parent chat RPC and pass observation.
- `worker/agents/core/codingAgent.ts` — WebSocket close/error observation.

This is an **unreleased draft**, not an approved release patch. Release manifest and release scripts were not changed.

- Boundaries instrumented in draft: parent `stub.chat`; RPC callbacks/stream result; stream forwarding; WebSocket close/error; tool execution; `onStepFinish`; operation-state persistence; post-chat continuation decision.
- Error cause retention: focused tests retain nested causes, error code and available stack/source information.
- WebSocket diagnostics: close code, readyState and wasClean are captured; free-form close reason retention is a redaction blocker.
- RPC diagnostics: cancellation attribution and callback rejection retention pass focused synthetic tests; no new live RPC was invoked.
- Tool diagnostics: tool name/call ID and execution/evidence failure boundaries are recorded without serializing arguments/results.
- Continuation diagnostics: existing decisions and failure boundaries are recorded; no new continuation is triggered.
- Secret redaction: **NOT APPROVED**. Recognized secret formats pass the tests, but unlabelled sensitive text is not reliably protected.
- Behavior changed: **NO production behavior changed** because nothing was deployed. The draft's required behavior-preservation guarantee is **NOT SATISFIED** under diagnostic metadata failures.
- Inspection confirmed unchanged existing KV write keys/values/count/order, lifecycle decisions, limits, tool results, recovery and queue logic. That does not remove the diagnostic-failure blocker.

## LOCAL VERIFICATION

- Instrumentation tests: **PASS — 12 tests**. Coverage does not establish the two missing safety guarantees above.
- Lifecycle tests: **PASS** in the runtime batch, including 19 task-operation tests and 8 finish-task tests.
- Typecheck: **PASS** on the final checked draft. An initial missing `RpcTarget` type import was corrected before the final check.
- Runtime regression batch: **PASS — 175 tests across 24 files**, including the 12 instrumentation tests.
- Build: **NOT RUN — stopped at safety gate**.
- Task 4B: runtime immutable-deployment/platform-identity/Think-deploy tests **PASS**; complete root acceptance regression **NOT RUN**.
- Task 6A: runtime auth, logout and session/password-reset tests **PASS**; complete root acceptance regression **NOT RUN**.
- Ownership: complete root ownership regression **NOT RUN**.
- Preview sandbox: runtime preview-handler/request-handler regressions **PASS**; complete root sandbox/browser regression **NOT RUN**.
- Gateway/public routing: complete root regression **NOT RUN**.
- Observability-only safety review: **FAILED** for the two blockers above.

Local logs:

- `/tmp/buildcustom-observability-instrumentation-tests.log`
- `/tmp/buildcustom-observability-types.log`
- `/tmp/buildcustom-observability-regressions.log`

These are local logs, not production acceptance evidence.

## DEPLOYMENT

- Previous runtime: `122e2da3-5617-49cc-92ca-5c5723e30af3`, as specified by the authorization and preceding evidence. Not re-queried after the local stop.
- New runtime: **NONE**.
- Rollout percentage: **no new rollout**; preceding candidate was recorded at 100%.
- Control changed: **NO**.
- Gateway changed: **NO**.
- Rollback version: the existing runtime above would be the pre-instrumentation target if a future observability version were deployed. No deployment or rollback occurred here.
- Production hosting, bindings, assets, limits, auth, ownership and Publish: **not changed**.

## NEW FIXTURE

- User: **N/A — not created**.
- Project: **N/A — not created**.
- Agent: **N/A — not created**.
- Conversation: **N/A**.
- Operation: **N/A**.
- Exactly one customer request: **not attempted; zero requests sent because the predeployment gate failed**.
- Think turns / tool steps / continuations: **N/A**.
- WebSocket remained connected / RPC cancellation / provider errors / native stream errors: **N/A — no new live run**.
- Preflight / commit / preview / browser verification / finish_task / revision / working tree / final state: **N/A — no new fixture**.
- Production Publish: **NO**.
- Result: **BLOCKED before deployment and fixture creation**.

## IF FAILURE

- Earliest original production error, type, message, code, stack and nested cause: **N/A — no new fixture run; historical failure was not retried or reclassified**.
- Local blocking component/boundary: diagnostic metadata collection preceding RPC callback/forwarding and related logging hooks; free-form diagnostic text projection.
- Candidate caused the historical production failure: **NOT ASSESSED by this stopped attempt**.
- Classification: **OTHER — local instrumentation safety gate failure**, not a reproduced production root cause.
- Confidence: **HIGH** for the local source-review blockers; no additional confidence claimed about the historical production failure.

## IF SUCCESS

- Crossed 25-step/internal-turn boundary: **NOT TESTED**.
- Multi-turn continuation proven: **NO**.
- Lifecycle production acceptance proven: **NO**.

## ROLLBACK RECOMMENDATION

**No rollback recommended from this attempt.** Nothing new was deployed, and no new production evidence established a lifecycle-candidate regression.

## PROTECTED PROJECTS

- Project 5 read or touched: **NO**.
- Project 6 retried or repaired: **NO**.

## EXACT NEXT RECOMMENDED STEP

Authorize a local-only correction of the two observability blockers. Add adversarial tests for throwing metadata factories/getters and unlabelled sensitive text, then complete the remaining regressions and build before any deployment or fresh-fixture request.

**STOPPED.**