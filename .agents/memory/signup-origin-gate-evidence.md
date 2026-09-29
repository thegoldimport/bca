---
name: Public signup Origin acceptance
description: A duplicate-account test can mask whether an invalid Origin was rejected by the Origin guard.
---

An invalid-Origin registration request using an existing email returned HTTP 400 during a guarded signup cutover. Its response body was not retained, so that attempt remains ambiguous and was correctly rolled back; no legitimate new signup was submitted.

In a separately authorized closed-state probe on 2026-09-29, a syntactically invalid email produced the exact safe response `{"message":"ORIGIN_REJECTED"}` for both foreign and missing Origin, while valid Origin returned `{"message":"Registration is closed."}`. The Origin check runs before the closed gate. Control maps runtime CSRF 403 to a generic public response, so that public body alone does not identify CSRF as the cause.

**Why:** A bounded 4xx only proves that the overall request failed, not which guard rejected it. Keeping the body and using matched non-account-creating controls distinguishes Origin from duplicate, schema, and closed-gate rejection.

**How to apply:** In separately authorized future acceptance, compare otherwise identical deliberately invalid-email requests differing only in Origin or CSRF. Require the exact Origin rejection body; attribute generic CSRF 403 only with source-backed local middleware tests, independently traced Worker versions, verified open/email capability, and unchanged identities. Closed-state CSRF remains unproven. Do not infer authorization for another cutover from this observation.