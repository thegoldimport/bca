---
name: AI Gateway test isolation
description: Why a disposable gateway on a shared account is not a sufficient credential boundary.
---

Do not assume a gateway-specific Cloudflare Run token can be issued for an isolated VibeSDK test on the same account. Cloudflare documents AI Gateway Run permissions as account-scoped across all gateways, including those with stored provider keys.

**Why:** A previous disposable VibeSDK Think run omitted the account/gateway token for safety, but the candidate treated that as stored-key mode and removed the provider authorization header. Reusing the protected account token would expose a production credential to the test Worker; a newly minted account-wide Run token is still broader than the test gateway.

**How to apply:** Before another live baseline attempt, secure a separate account or an explicitly approved, safely constrained credential path. Do not attribute a past HTTP 400 definitively without its response code/body, and do not bypass the normal Think configuration by changing source or faking state.