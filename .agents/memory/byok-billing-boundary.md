---
name: BYOK billing boundary
description: Product rule for customer-owned provider keys and the BuildCustom-managed Gemini default.
---

Keep BuildCustom-managed Gemini as the default. When a customer configures their own supported provider key, route inference through that account-scoped credential and do not consume BuildCustom AI credits for those provider calls; the provider's own charges apply. Keep customer-facing billing copy aligned with the actual provider and credit behavior.

**Why:** The product owner wants customers to be able to use their own AI key or rely on BuildCustom's managed default. Separating provider-funded calls from platform-funded credits avoids charging BuildCustom credits for inference the customer pays their provider to run.

**How to apply:** Keep credentials encrypted in product D1 and out of browser responses, logs, and plaintext persisted agent configuration. Restrict model selection to supported providers and known model IDs; do not accept arbitrary base URLs. Preserve account/session checks and app-creation protections when skipping platform AI-credit metering for customer-key calls.
