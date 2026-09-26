---
name: Clean VibeSDK production direction
description: Current BuildCustom strategy for a fresh upstream VibeSDK baseline and safe isolation from the serving environment.
---

The earlier preserve-the-existing-runtime migration plan has been superseded. The owner confirmed BuildCustom never launched: old users, projects, generated apps, releases, waitlist entries, and BuyerMagnets (including its custom hostnames and runtime state) are test data, not customer state. Prefer a new empty production product D1 and a new stock VibeSDK runtime with the accepted immutable-release patch; do not migrate the populated old product D1. Keep the old resources temporarily for rollback/reference, and do not delete or modify them until a separately approved cutover.

**Why:** The owner explicitly confirmed there is no legacy customer continuity requirement. Migrating the old populated product D1 or building dual-dispatch compatibility for disposable generated apps adds risk without serving customers. Starting upstream-first avoids carrying old runtime assumptions into the new product.

**How to apply:** Keep the already accepted Tasks 1–4 architecture. Bootstrap fresh product/runtime data stores for a clean first launch; preserve the custom-domain *capability*, not old BuyerMagnets records. Retain old Cloudflare associations until the new private stack passes checks and an authorized cutover safely reassigns public hostnames. Never treat a staging-looking name as an isolation boundary; use fresh resources and an account-level credential boundary for mutation tests.

Keep the separate security principle: never carry browser-supplied identity forward as authentication. Any later production cutover needs its own rollback and data-ownership plan; the former preservation-first plan is no longer its authority.