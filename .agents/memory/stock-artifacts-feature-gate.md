---
name: Stock Artifacts feature gate
description: Account entitlement can block stock Artifacts REST even when owner authorization succeeds.
---

For this staging Cloudflare account, stock Artifacts REST may return `403 Access denied by feature gate` for a freshly linked project whose owner can successfully access stock agent connection, branches, and private Git smart HTTP. Do not interpret that Artifacts response as evidence of a wrong owner or create a replacement agent. The stock private Git export is an authoritative way to read the same SpaceDO repository without a second persistent file store.

**Why:** The Artifacts REST entitlement is a separate account-level feature gate; owner authorization alone does not grant it. A staging read through the stock Git protocol succeeded where Artifacts REST did not.

**How to apply:** Prefer an owner-bound, pinned private Git read with strict transfer limits and current-branch verification for committed tree, blob, and revision reads. Fail closed if that read fails; do not synthesize files from a browser cache or retry agent creation.

The lab account can also reject a Worker upload with code 10015 when its config includes an Artifacts binding. This binding may exist in source configuration even when it is absent from the active Worker version.

**Why:** A lab Worker upload was rejected by the account gate; inspection of the serving version showed it had no Artifacts binding. Omitting that undeployed binding allowed the update without dropping any active binding.

**How to apply:** Compare the serving version's binding names and types with the proposed bundle before adjusting lab configuration. Never infer that removing a config entry preserves behavior without checking the active version and code usage. Preserve all serving bindings, including secrets, when deploying.