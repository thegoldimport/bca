---
name: Sentry Worker test observation
description: Validate telemetry through the real SDK client rather than an assumed transitive-module spy.
---

In the Cloudflare Worker test pool, a mock of the test's `@sentry/core` import can be a different callable reference from the core functions used inside the installed Cloudflare SDK. Do not infer disabled instrumentation from an empty mock counter.

**Why:** An independent, one-time SDK baseline returned correct D1 results and errors while recording zero mock calls. The SDK's public startSpan reference differed from the mocked reference. An initialized CloudflareClient with real span hooks and an in-memory transport observed the expected spans, error statuses, breadcrumbs and transaction envelopes without changing the product guard.

**How to apply:** Prove telemetry observation with a fresh one-time SDK baseline before judging candidate changes. Use real client hooks and a network-free transport when dependency-internal mocking is unreliable. Error-status spans and automatic exception events are separate behaviors; verify the installed SDK's actual contract.