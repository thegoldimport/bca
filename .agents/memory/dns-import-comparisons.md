---
name: DNS import comparisons
description: Safety rules for comparing customer-provided provider exports with incomplete public DNS discovery.
---

Treat provider exports as read-only evidence, not authorization to change or activate DNS. Keep public observations and imported records visibly distinct, and invalidate the comparison and customer acknowledgment whenever either source changes.

**Why:** Public DNS cannot reveal private records or proxy status, while an old saved comparison can falsely appear complete after a rescan or edited import.

**How to apply:** Serialize scan/import/configuration state updates, canonicalize equivalent DNS RDATA before comparing, flag missing/changed/import-only records separately, and require DNS-only service records when proxy status is known or explicitly rechecked when it is absent.