# Project 8 acceptance attempt

## Overall status: PREFLIGHT BLOCKED

The owner/API preflight **passed**. Execution was blocked later, during pre-send editor navigation and then a local tool-environment interruption. No customer coding request was reserved or clicked. This result does **not** establish a production coding-lifecycle failure.

## Harness fixes and tests

Only the three authorized corrections were made:

1. Native owner status rejects a non-null explicit `error` or `success:false`; revision parsing marks such responses invalid.
2. Native preview/deployment URLs survive the status summary, without query capabilities in the checkpoint, and are checked when validating a fresh fixture.
3. Explicit failed product-detail `status` or `runtimeStatus` is rejected.

Files: `scripts/lib/task13-owner-contracts.mjs`, `scripts/continuous-coding-observability-fixture.mjs`, `scripts/task13-owner-contracts.test.mjs`.

- Eight new focused cases: **PASS**.
- Eight existing contract cases: **PASS**.
- Harness self-test: **PASS**.
- Syntax and whitespace checks: **PASS**.
- No broad architecture review was performed after these fixes.
- No product/runtime/lifecycle implementation or production observability code was changed. No product code was deployed.

## One new fixture

| Field | Retained evidence |
| --- | --- |
| Project | **8**, created by exactly one normal project-creation POST |
| Owner | `379ce699-b905-43cc-b5ba-f40bb42ded20`, one newly registered disposable owner |
| Native agent | `c9b4c828-07d1-41aa-a6bb-2c858b29c09e` |
| Owner and mapping | Authenticated product detail and owner-scoped D1 link matched |
| Generation | Native ready, connected, `shouldBeGenerating:false`, generation `idle` |
| Prior customer turns | **0** |
| Initial revision | `main`, `2a7ecab9e2c7a32c7978e0fcea4f386d7eb53ed8` |
| Existing release | **0** |
| Product and native preview/deployment | **null/null** |
| Required owner API calls | Successful; revision HTTP 200 with valid native shape |
| Corrected setup preflight | **PASS**, checkpoint at `2026-10-01T15:55:57.868Z` |
| Pre-browser preflight | **PASS**, snapshot at `2026-10-01T15:57:14.902Z`; branch/hash remained identical |

The prior Project 7 stopped checkpoint was retained separately in `observability-fixture-project7-stopped.json`; it was not used for coding.

## Pre-send failure and evidence limits

The one harness UI run retained:

- state: `BROWSER_READY`;
- failure phase: `editor-navigation`;
- failure kind: `operation-failed`;
- customer request reservation: **absent**;
- Send click checkpoint: **absent**;
- customer requests sent: **0**;
- retained WebSocket frame count: **0**.

The generic top-level harness catch did not retain the original browser exception, so the evidence does not distinguish navigation failure, missing/late composer, authentication display, or another page condition. No one of those is asserted as the cause.

A subsequent **read-only**, no-Send UI diagnostic attempted to use the existing browser profile and forbade mutating product HTTP requests. Its local shell tool disconnected with `SERVER unexpectedly disconnected`, exit `-1`. Afterward, the temporary session and browser profile no longer existed. Its facts file was absent and its screenshot file was zero bytes, so neither is treated as valid UI evidence. No new login, customer identity, or browser profile was constructed after that loss. There was no fixture repair, second fixture, or second coding request.

The production diagnostic collector independently stopped before connection confirmation with `pretty-tail-failed`, child exit code **1**. Its JSON session never started and it retained **zero events**. A bounded startup probe also exited 1 without a safely attributable error code. The collector discards child stderr by design; authentication, account selection, or another startup error was not established. This was a local collector-startup failure, not a retained Think/provider exception.

## Coding operation

| Field | Result |
| --- | --- |
| Customer coding requests | **0** |
| Think turns, tool steps, internal continuations | **NOT RUN** |
| Same operation/ThinkAgent/SpaceDO across turns | **NOT TESTED** |
| Workspace survived turn boundary | **NOT TESTED** |
| WebSocket | No retained frames; no native coding suggestion observed |
| RPC/provider | No coding outcome observed |
| Working-tree preflight, operation commit | **NOT RUN** |
| Preview and generated-app browser verification | **NOT RUN** |
| `finish_task` and completion gate | **NOT RUN** |
| Authoritative revision | Seed baseline above; no coding-created revision observed |
| Final working tree | **UNVERIFIED**, not assumed clean |
| Final operation state | **NO CODING OPERATION STARTED**; local harness remains `BROWSER_READY` with pre-send failure |
| Production Publish | **0** |

**BASIC PRODUCTION LIFECYCLE: NOT RUN**  
**MULTI-TURN PRODUCTION LIFECYCLE: NOT PROVEN**

## Classification and stop

- Earliest retained execution failure: generic `editor-navigation / operation-failed`.
- Boundary: local browser automation before customer Send.
- Root cause: **undetermined** because the original browser exception was not retained; the subsequent diagnostic was interrupted locally.
- Candidate caused failure: **not established**; no runtime candidate was deployed in this authorization.
- Production product failure: **not established**.
- Rollback recommendation: **none** on this evidence.
- Project 5 touched: **NO**.
- Project 6 retried: **NO**.
- Project 7 coding request: **NO**.
- New fixtures: **1**.
- New customer coding requests: **0**.

The local development workflow was restarted after the tool interruption and confirmed serving on port 5000. This was not a production deployment or a repair of Project 8.

**Exact next recommended step:** separately authorize recovery of this same disposable Project 8 owner session and a pre-send UI diagnosis that retains the actual browser failure. Do not create Project 9 or reset the existing request checkpoint. If that diagnosis permits continuing, independently confirm the same owner/agent and zero prior request before any first Send.