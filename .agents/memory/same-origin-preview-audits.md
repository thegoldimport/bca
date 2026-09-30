---
name: Same-origin preview audits
description: Avoid false browser acceptance failures when the product page and sandboxed preview share an origin.
---

Scope browser request audits to the capability-scoped preview path or to requests initiated by a frame under that path. Do not use origin equality alone when the product dashboard and preview share a host. Exclude known platform telemetry independently, without ignoring real requests from the generated app. Do not infer an empty POST Origin from a browser automation request-header snapshot that omits it.

**Why:** A same-origin product-page 404 and an optional Cloudflare telemetry 404 were counted as preview failures even though a separate browser load showed the unchanged generated CRM mounted and its scoped data GETs succeeded. Repeating the acceptance phase did not resolve the false classification. In an opaque-origin sandbox, a later form submit produced a successful, readable POST and inserted the correct row, while automation exposed `Origin: null` on the preflight and no Origin header on its POST request snapshot. Strictly comparing those two observed strings falsely failed the acceptance harness.

**How to apply:** Include off-path API or external requests when their initiator is the preview frame, so genuine generated-app failures remain visible. Keep product dashboard requests and provider telemetry out of the generated-app resource gate. Treat absent captured request headers as unknown rather than empty wire values; reconcile transport using the browser-readable response, preflight status, network failures, and authoritative stored result.