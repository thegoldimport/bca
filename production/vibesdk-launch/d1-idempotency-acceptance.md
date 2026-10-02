# Runtime D1 instrumentation source acceptance

Production activation is explicitly excluded from this acceptance.

## Failed-test diagnosis

The original Worker-pool test mocked `@sentry/core.startSpan` and
`addBreadcrumb`. A direct call to that mock recorded activity, but the installed
Cloudflare SDK's `startSpan` re-export was a different callable reference.
One fresh D1 binding instrumented exactly once, without the candidate, produced
correct query results and propagated the controlled error while the interceptor
recorded zero spans and breadcrumbs. No Sentry client was initialized.

The first divergence was the telemetry observation boundary, not the candidate.
The SDK statically imports its real core functions inside its dependency module.
Mocking the test's core import did not replace those dependency-internal calls
in this Worker pool. Function-identity comparison and the independent baseline
proved this; an assumed ordering or proxy-name heuristic was not used.

The installed SDK starts spans lazily when first/all/run/raw execute, not when
prepare or bind execute. Without a configured client and tracing, startSpan may
provide a non-recording span. Its error handling marks a recording span with
`internal_error` and rethrows; it does not automatically call captureException
for every rejected query.

## Validated observation

Tests now initialize the actual CloudflareClient with tracing enabled, no
integrations and an in-memory transport. Real spanStart/spanEnd hooks,
beforeBreadcrumb and transaction envelopes observe the SDK's behavior. No
production Sentry project or external network transport is used.

The independent one-time baseline produces five spans and four breadcrumbs:
three successful query operations, one thrown query error and one unsuccessful
D1 result. Both failures are represented by genuine error-status spans; the
thrown error remains the same object at the caller. Five actual transaction
envelopes reach the memory transport.

The four controls cover raw D1, SDK once, candidate once and candidate repeated.
Instrumented controls produce equivalent query telemetry; raw D1 is the
negative control. SDK call counts are observed at the direct application/SDK
boundary while delegating to its unchanged real implementation.

## Candidate

The provisional WeakMap implementation and DatabaseService change were retained
unchanged. One successful SDK instrumentation is cached per binding. Original
and returned binding identities are both recognized. Repeated service
construction therefore cannot keep replacing prepare and accumulating bind
proxies. Existing SDK statement-query guards remain intact.

## Verification

- Focused: 18 passed; no focused tests skipped.
- Complete runtime: 60 files, 672 passed, one pre-existing skipped test.
- Control-plane auth/owner fixtures: six passed.
- Runtime typecheck, build and Worker dry-run: passed.
- Explicit patch affects only three runtime paths: database.ts, the guard and
  its focused test.
- Full source reconstruction checks all 862 paths, not only the changed files.

Reconstruct with:

    node scripts/reconstruct-d1-runtime.mjs /tmp/a-new-empty-runtime-directory

See d1-idempotency-source.json for hashes and the pinned canonical baseline.

## Boundaries

No deployment, production login, Project 8 request, agent continuation, AI
instruction, generated-app change, Publish or release creation was performed.
Auth/session semantics, runtime limits and the 250-credit budget are unchanged.
Think/RPC behavior is unchanged and remains out of scope.