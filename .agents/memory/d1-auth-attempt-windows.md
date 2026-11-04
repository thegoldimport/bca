---
name: D1 auth attempt windows
description: Auth rate-limit timestamp and client-IP handling across Cloudflare D1 and service bindings.
---

**Rule:** A D1 column declared `INTEGER` with `DEFAULT CURRENT_TIMESTAMP` can contain text timestamps. Drizzle's integer timestamp mode binds JavaScript dates as Unix seconds, so comparing those values directly can count every text row as recent. Normalize stored values to epoch seconds before applying a rolling window. Never rate-limit unrelated callers together under an `unknown` IP bucket.

**Why:** A production login lockout was caused by both the timestamp representation mismatch and the auth proxy omitting the original client IP. Account-specific limits were healthy, but the shared unknown-IP counter remained over threshold.

**How to apply:** For D1 rolling auth limits, check actual SQLite storage types and use an explicit timestamp normalization expression. When proxying through a Cloudflare service binding, forward only the edge-provided `CF-Connecting-IP` as `X-Forwarded-For`; ignore browser-supplied forwarding headers and retain per-account limits when no IP is available.
