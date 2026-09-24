---
name: Think billing provenance
description: Verify the live isolated Think model routing before attributing generation failures to Cloudflare billing.
---

Inspect the deployed isolated Worker bundle and its live binding names before attributing a ThinkAgent error to AI Gateway credits. A candidate checkout can omit direct-provider routing while the deployed Worker still enables it.

**Why:** A staging generation emitted “Payment Required” while Cloudflare AI Gateway credits were zero, but the live Worker’s Think model was configured for direct Google routing and lacked the gateway-name binding needed for its optional URL override. The candidate source alone would have suggested the opposite inference path.

**How to apply:** Check the model’s deployed override, resolved base URL, authorization-header behavior, and gateway bindings at the current deployed version. Treat the balance as relevant only after confirming the failed request actually traversed Unified Billing. Do not copy protected gateway credentials into an isolated Worker to force a test.