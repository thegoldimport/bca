---
name: Compat fetch boundary
description: Observed staging AI Gateway /compat fetch failure after successful local preparation.
---

A protected staging `/compat` diagnostic passed account/gateway configuration, secret and token binding reads, URL parsing, header creation, and body serialization. On the sole authorized fetch attempt, the Worker caught a `TypeError` at the fetch boundary and returned a structured local error. Worker analytics counted zero subrequests and the target AI Gateway had no matching log. The exact underlying TypeError message was intentionally suppressed by output sanitization, so its cause is not established.

**Why:** Readiness immediately before `fetch()` does not demonstrate reachability of AI Gateway or Unified Billing. A local HTTP 500 at this boundary must not be called a gateway, model, or billing failure.

**How to apply:** If another investigation is authorized, obtain a safely redacted exception message or trace and identify the failing operation before changing credentials, model, billing, or routing. Do not retry inference on the strength of the preparation checks alone.