---
name: AI Gateway test isolation
description: Why a disposable gateway on a shared account is not a sufficient credential boundary.
---

Do not assume a gateway-specific Cloudflare Run token can be issued for an isolated VibeSDK test on the same account. Cloudflare documents AI Gateway Run permissions as account-scoped across all gateways, including those with stored provider keys.

**Why:** A previous disposable VibeSDK Think run omitted the account/gateway token for safety, but the candidate treated that as stored-key mode and removed the provider authorization header. The owner explicitly confirmed that the protected production token must not be placed in a disposable Worker. Reusing it would expose a production credential to the test Worker; a newly minted account-wide Run token is still broader than the test gateway.

**How to apply:** Before another live baseline attempt, secure a separate account or an explicitly approved, safely constrained credential path. Do not attribute a past HTTP 400 definitively without its response code/body, and do not bypass the normal Think configuration by changing source or faking state.

For the explicitly approved clean stock VibeSDK lab, account-scoped permissions on the existing BuildCustom account are acceptable; the isolation boundary is fresh resource identity, not account separation. This does not relax the ban on modifying existing Workers, routes, DNS, databases, namespaces, buckets, gateways, or domains.

**Why:** The owner clarified that the historical runtime is disposable test state with no customer projects to migrate, while existing serving resources must still remain untouched.

**How to apply:** Audit and verify every mutable target before each lab setup/deployment operation. Treat account-wide credential reach as a known limitation, not by itself a reason to stop this approved lab test. Do not generalize this exception to other projects or future unapproved tests.