---
name: Clean VibeSDK production direction
description: Current BuildCustom strategy for a fresh upstream VibeSDK baseline and safe isolation from the serving environment.
---

The earlier preserve-the-existing-runtime migration plan has been superseded. The old BuildCustom test project, generated apps, historical releases, and VibeSDK staging state are disposable research data, not production customer data. Build a clean production SaaS from the current official VibeSDK architecture after proving it in fresh isolated resources. Do not delete or modify the serving environment until a separately approved cutover.

**Why:** The old preservation requirement drove custom inference transports and compatibility diagnostics that are no longer necessary. Starting upstream-first avoids carrying those assumptions into the new runtime.

**How to apply:** Research the current official source and Cloudflare docs first. Prove stock generation, preview, then Unified Billing by configuration if possible, then isolated generated-app publishing. Only after those pass connect BuildCustom's product-layer identity, project ownership, usage, and domains. Never treat a staging-looking name as an isolation boundary; use fresh resources and an account-level credential boundary for mutation tests.

Keep the separate security principle: never carry browser-supplied identity forward as authentication. Any later production cutover needs its own rollback and data-ownership plan; the former preservation-first plan is no longer its authority.