---
name: Wholesale production capacity
description: Separate Cloudflare's published Unified Billing request cap from unexplained wholesale admission errors and production capacity decisions.
---

BuildCustom is a multi-user AI coding platform. Normal coding-agent behavior can make multiple sequential model calls within seconds.

**Why:** The user explicitly described the intended production workload. Do not treat rapid sequential calls as malformed behavior or assume artificial per-call delays are an acceptable architecture.

**How to apply:** Capacity decisions must account for aggregate multi-user traffic and normal agent loops. Pacing, retries, provider changes, deployments, and further inference experiments require explicit authorization.

Cloudflare's AI Gateway limits page, reviewed on 2026-10-03, documents Unified Billing at 200 requests per 60 seconds per gateway using Cloudflare-managed credentials; BYOK requests are explicitly exempt from that quota. This is separate from configurable gateway rate limits. The reviewed official docs and available account metadata did not expose a specific error-2018 mapping, wholesale burst/token policy, or allocation override.

**Why:** A bounded, isolated rapid sequence received the live error `AiGatewayError` / `2018` / `Wholesale Rate limited` far below the published minute cap after verified inactivity. The published cap alone does not explain that admission failure. Cloudflare-managed credentials are documented, but their sharing or provider-pool allocation is not established by that wording.

**How to apply:** Recheck the current official limits page before relying on the numeric cap. Do not divide its minute quota into a supposed enforced RPS rule, invent a fifth-request threshold, apply Workers AI hosted-model limits to third-party Gemini, or promise that a plan upgrade/top-up will fix wholesale rejection. BYOK is a documented quota-exempt path, not proof of unlimited provider capacity or authorization to migrate. Resolve the effective admission policy and capacity options before certifying this wholesale route for launch.