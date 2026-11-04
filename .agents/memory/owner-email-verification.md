---
name: BuildCustom initial owner email verification
description: Owner activation uses fresh inbox possession proof and a separate operator authorization secret.
---

For BuildCustom's designated initial owner, use a single-use Cloudflare Email Service link sent to the existing `support@buildcustom.ai` account. Do not require Google/GitHub linking, and do not trust signup-time email verification flags. Activation also requires the authenticated existing account, exact email confirmation, server-side one-time state, and a separately provisioned Cloudflare Worker secret.

**Why:** The product owner explicitly rejected provider identity linking and chose direct inbox verification with a separate operator approval step.

**How to apply:** Keep the flow bound to the existing owner account, use expiring hashed tokens and fresh proof, keep the secret out of source/frontend bundles/logs, and do not deploy or promote the production account without explicit approval.
