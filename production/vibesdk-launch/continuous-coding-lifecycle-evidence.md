# Continuous coding lifecycle: isolated implementation evidence

## Status

PASS for local/isolated implementation acceptance. Production deployment and Project 5 repair remain unauthorized and were not performed.

Date: 2026-09-30.

## Durable source

- Candidate patch: `production/patches/continuous-coding-lifecycle.patch`.
- SHA-256: `3fe4d720abd59991574d5462a2b7340f1b65ada01beb3475a453c4dbdfab057e`.
- Base: pinned upstream `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`, followed by the existing immutable-publish, logout-revocation, registration-gate, password-recovery, and preview-capability patches.
- Independent `git apply --check`: PASS.
- Existing accepted patches, launch configuration, and dependency lockfiles were not changed.

## Source/test files changed

All paths below are relative to `production/vibesdk-launch/runtime-source/`.

- `worker/agents/think/ThinkAgent.ts`
- `worker/agents/think/finish-task-tool.ts` and its test
- `worker/agents/think/task-operation.test.ts`
- `worker/agents/think/deploy-tool.ts` and its test
- `worker/agents/think/space-workspace-ops.ts`
- `worker/agents/think/context-selector.ts` and its test
- `worker/agents/think/browser-evidence.ts`
- `worker/agents/think/ThinkAgent.browser-evidence.test.ts`
- `worker/agents/think/browser-logs-tool.ts` and its test
- `worker/services/browser-capture/capture-core.ts` and its test
- `worker/agents/core/behaviors/think.ts`
- `worker/agents/core/conversation/MessageLoader.ts` and its test
- `space/src/space/deploy-engine.ts` and its test
- `space/src/space/durable-object.ts`

## Behavior implemented

- Durable states: RUNNING, COMPLETE, BLOCKED, USER_INPUT_REQUIRED, INCOMPLETE_RESOURCE_LIMIT.
- One durable queued request identity and host conversation identity across native sequential Think chat RPCs.
- Internal prompts are marked, hidden from customer history, and never repeat the original request verbatim.
- Persisted prompt boundaries and stream-completion checkpoints distinguish interrupted work from completed turns. Recovery may require additional continuation work, but does not resend the original customer prompt.
- Durable starting HEAD/time, model/tool/continuation counters, available and consumed metered credits, limits, and workspace/validation fingerprints.
- Configurable limits: `maxContinuations`, `maxModelCalls`, `maxToolCalls`, `maxElapsedMs`, `maxCredits`.
- Optional host variables: `THINK_OPERATION_MAX_CONTINUATIONS`, `THINK_OPERATION_MAX_MODEL_CALLS`, `THINK_OPERATION_MAX_TOOL_CALLS`, `THINK_OPERATION_MAX_ELAPSED_MS`, `THINK_OPERATION_MAX_CREDITS`. None was set in production.
- Uncalibrated development fallbacks: 25 continuations, 650 model calls, 1,300 tool calls, 3,600,000 milliseconds, 100 credits. These are not approved production thresholds.
- No-progress becomes BLOCKED; clarification pauses; a harness-authored resource stop cannot be rewritten as model success.
- `maxSteps = 25` is unchanged.

## Preflight, commit, preview, completion

Snapshot preflight reads the working tree without checkout, initialization, checkpoint, materialization, commit, reset, restore, or deployment. Cold/unready workspaces fail closed rather than initialize inside preflight. Static authored JS/MJS/JSX/TSX assets are syntax checked; vendor/minified content is excluded and remains subject to browser/runtime validation.

The deploy tool uses one serialized internal `preflightCommitDeploy` RPC. It pins the current branch and workspace snapshot, compiles before commit, surfaces real commit failures, checks raw committed bytes/path sets against the validated snapshot, requires successful Artifacts push where applicable, and persists the already-built preview bundle without checkout.

`finish_task` records primary-agent intent. COMPLETE requires preflight/deploy evidence, a clean current tree, authoritative HEAD/deployed/preview/browser revision and branch parity, and verified browser evidence for the configured signed preview. Verification reads use metadata/Git reads rather than a branch checkout. Missing proof remains RUNNING.

Browser verification checks the actual final navigation URL, rejects truncated/incomplete diagnostics, and requires zero actionable errors. Preview generation is separate from immutable production Publish.

## Verification

Failing isolated tests were added before the corresponding implementations and acceptance-gap fixes.

Final runtime run: **23 files, 163 tests passed**. Coverage includes:

- small edit and multi-turn continuation;
- malformed source preservation, repair, and coherent final revision;
- no-progress, clarification, and model/tool/time/credit ceilings;
- request/recovery checkpoints and terminal acknowledgement;
- finish intent without proof, dirty/stale/revision-mismatched evidence;
- real commit failure, branch mismatch, intervening writes, ignored-file mismatch;
- Artifacts whiteouts, failed push, and binary snapshot equality;
- cold preflight with no initialization or mutation;
- targeted discovery and bounded continuation context;
- internal transcript suppression;
- cross-origin redirect and truncated browser evidence rejection;
- immutable publishing, auth/logout/recovery, WebSocket ownership, preview capability/rate-limit, and sandbox regressions.

BuildCustom adapter/gateway regression run: **60 tests passed**, covering project-scoped publishing, private preview capability/sandbox paths, ownership boundaries, gateway dispatch, public routing, and domain-routing preservation.

`bun run typecheck`: PASS. `bun run build`: PASS. Existing experimental Wrangler, dynamic-import, and large-chunk warnings remain non-fatal.

## Boundaries and limitations

- Project 5 touched: NO.
- Production deployed: NO.
- Production Publish invoked: NO.
- Coding-runtime subagents added: NO.
- No custom Workflow orchestration, new service, competing task ledger, or project-memory database.
- Isolation tests use fixtures/simulations; they are not live production acceptance.
- Cold preflight deliberately requires prior normal workspace readiness.
- Browser checks and syntax checks do not prove every requested semantic behavior; task-specific runtime acceptance is still necessary.
- Interrupted execution can perform extra continuation work; model/tool execution is not claimed to be globally exactly-once.
- Production resource thresholds must be reviewed/configured separately before deployment.

Next recommended step: review this candidate and approve production thresholds, then separately authorize a controlled lifecycle deployment. Project 5 repair must remain a separate authorization.