---
name: Public signup Origin acceptance
description: A duplicate-account test can mask whether an invalid Origin was rejected by the Origin guard.
---

An invalid-Origin registration request using an existing email returned HTTP 400 during the final guarded signup cutover. The same payload with a valid Origin and missing or invalid CSRF returned 403. This is **not proof** that the Origin guard is absent or bypassed: the 400 may instead reflect duplicate-account validation. The required Origin acceptance remained unproven, so the single attempt was rolled back; no legitimate new signup was submitted.

**Why:** A bounded 4xx only proves that the overall request failed, not which guard rejected it. Treating an existing-account 400 as proof of Origin enforcement would conflate independent security checks.

**How to apply:** In any separately authorized future acceptance, use a safe, non-account-creating payload that can distinguish Origin rejection from schema/duplicate rejection. Keep Origin and CSRF outcomes independent, and fail closed if guard attribution remains uncertain. Do not infer authorization for a second cutover from this observation.