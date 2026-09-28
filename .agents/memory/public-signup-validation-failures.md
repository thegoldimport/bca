---
name: Public signup validation failures
description: Live validation-path failure observed during a single authorized signup cutover.
---

When the existing registration-enabled runtime and control versions were live, anonymous public signup rejected an already-existing account and its case-variant with bounded HTTP 400 responses. An invalid email and a syntactically valid request with a weak password instead produced HTTP 502 and a generic account-creation message. The serving control version for the separate capability check was directly established through a matching Cloudflare tail event. Both Workers were restored to their accepted closed versions; no diagnosis of the validation failure was established.

**Why:** A 502 is not a valid bounded input-rejection outcome, even when no user is created. Treating every non-2xx response as successful validation would incorrectly approve public signup.

**How to apply:** Investigate the actual validation/error path and production runtime logs under a separately authorized diagnostic task before requesting any new public signup cutover. Do not infer the root cause from the HTTP status alone or retry deployment as a substitute for diagnosis.