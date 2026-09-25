---
name: Compat fetch boundary
description: Observed staging AI Gateway /compat fetch failure after successful local preparation.
---

A protected staging `/compat` diagnostic passed account/gateway configuration, secret and token binding reads, URL parsing, header creation, and body serialization. On the sole authorized fetch attempt, the Worker caught a `TypeError` at the fetch boundary and returned a structured local error. Worker analytics counted zero subrequests and the target AI Gateway had no matching log. The deployed call used `redirect: "error"`, which workerd's Request parser rejects before creating a subrequest: it accepts only `follow` or `manual`. The historical exception message was suppressed and could not be recovered, but the invalid option and runtime rejection are established from the deployed bundle and Cloudflare's runtime source. Cloudflare's public Request documentation currently lists `error` as an option despite this runtime restriction.

**Why:** Readiness immediately before `fetch()` does not demonstrate reachability of AI Gateway or Unified Billing. A diagnostic option intended to prevent redirects instead prevented any request. A local HTTP 500 at this boundary must not be called a gateway, model, or billing failure.

**How to apply:** For an approved future staging correction, use `redirect: "manual"` and explicitly reject 3xx responses to prevent redirect-following without a second request. Do not retry inference on the strength of preparation checks alone, and do not change credentials, model, billing, or routing to address this parser error.