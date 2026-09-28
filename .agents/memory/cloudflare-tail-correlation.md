---
name: Cloudflare tail correlation
description: Evidence and caveats for correlating a public Worker request with its serving version.
---

Wrangler 4.90.0's JSON tail for this account exposes `scriptVersion.id` alongside the request URL and script name. A unique request can therefore yield direct serving-version evidence without changing Worker code or deployment configuration, provided the subscription captured that request. Treat a missing matching event as UNKNOWN, never as proof that deployment readback identifies the request's version.

**Why:** During a read-only control-plane investigation, tail produced versioned events but silently replaced UUID-shaped query values with `REDACTED`, so exact URL correlation failed across several attempts. A timestamp-shaped marker survived. The redaction policy is not a stable contract: future markers may be treated differently, and tail startup and sampling can also lose events.

**How to apply:** Before recording the consequential request, prove that a harmless uniquely marked calibration request is captured with `scriptVersion.id`; then match an exact URL, script name, and invocation timestamp while retaining only projected public fields. If calibration or correlation fails, preserve the HTTP response and report version UNKNOWN. Never store unrelated tail events, which may include customer request headers or logs.