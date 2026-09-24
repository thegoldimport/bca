---
name: Think billing provenance
description: Verify the live isolated Think model routing before attributing generation failures to Cloudflare billing.
---

Inspect the deployed isolated Worker bundle and its live binding names before attributing a ThinkAgent error to AI Gateway credits. A candidate checkout can omit direct-provider routing while the deployed Worker still enables it.

**Why:** A staging generation emitted “Payment Required” while Cloudflare AI Gateway credits were zero, but the live Worker’s Think model was configured for direct Google routing and lacked the gateway-name binding needed for its optional URL override. The candidate source alone would have suggested the opposite inference path.

**How to apply:** Check the model’s deployed override, resolved base URL, authorization-header behavior, and gateway bindings at the current deployed version. Treat the balance as relevant only after confirming the failed request actually traversed Unified Billing. Do not copy protected gateway credentials into an isolated Worker to force a test.

An isolated REST request can appear in the intended AI Gateway log yet still fail with HTTP 403, `wholesale: false`, no BYOK selection, and zero token/cost usage. Those fields do not establish that zero prepaid credits caused the rejection; Cloudflare's published REST docs require credits but do not specify that this exact failure pattern is the credit gate. A successful permission probe with the workspace management token does not prove that a different, unreadable Worker secret has Workers AI Read.

**Why:** The gateway's failed response-body retrieval provided no safe specific rejection code, and token-inventory metadata was inaccessible; treating either the balance or a separate management credential as proof would lead to a premature top-up or unsafe secret replacement.

**How to apply:** Classify the cause as unresolved until the exact failed-response reason or the Worker's own token policy is verified through a safe owner-controlled channel. Preserve the existing rollback versions and avoid repeat inference attempts or speculative credential changes.

An owner-reported permission edit to the isolated account token was followed by one native staging retest with the same gateway `403`, `wholesale: false`, zero usage, and no available response error body. This does not demonstrate that the permission update reached the Worker's secret or that the zero balance is the cause.

**Why:** A token edit and a secret-value roll are separate Cloudflare operations, while Worker secret metadata cannot identify which token value is installed. The unchanged gateway status cannot distinguish an unchanged credential from a different Cloudflare rejection.

**How to apply:** If this remains the latest evidence, do not send a third inference request or recommend a top-up as the sole fix. Obtain Cloudflare's specific rejection reason and independently establish credential continuity before altering isolated staging.

Do not replace the existing staging Worker's shared Cloudflare API secret with an inference-only token. Use a separate Think-only binding if choosing a dedicated credential, and first make a tightly scoped staging branch change that selects it.

**Why:** The actual serving Worker, not merely the differing candidate checkout, references the shared credential across non-Think paths such as resource provisioning, deployment, and image handling. A token restricted to Workers AI Read could break those functions even if inference authorization improves.

**How to apply:** Keep the shared secret and both rollback versions intact; request approval for a staging-only dedicated binding and Think branch before installing or testing the new token. A dashboard secret deployment creates a new serving version, so verify binding parity and rollback after that separate change.