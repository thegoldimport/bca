---
name: Cloudflare account token scoping
description: How to validate account-scoped Cloudflare tokens without confusing an account mismatch with an invalid credential.
---

For account-scoped Cloudflare API tokens, derive the account ID from the target zone's `account.id` and test the required resource operation against that account. Do not assume an account identifier exposed by an integration wrapper owns the zone.

**Why:** A valid Workers KV token appeared invalid when requests used an unrelated account identifier. The same token authenticated and accessed KV once requests used the account that owns the domain zone.

**How to apply:** Read the target zone, use its account ID for account-level Workers and KV APIs, and validate the narrow resource operation. Treat `/user/tokens/verify` cautiously for account-level tokens.