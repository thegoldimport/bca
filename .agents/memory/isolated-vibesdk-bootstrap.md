---
name: Isolated VibeSDK bootstrap
description: Requirements and credential limitation discovered when cloning VibeSDK into isolated Cloudflare staging resources.
---

An isolated VibeSDK Worker clone needs the canonical public D1 migrations and template catalog applied separately; neither is carried in the downloaded Worker module bundle.

**Why:** A bundle-only clone could answer health checks but failed API-key authentication until the D1 migrations and a staging-only API key were created, then failed agent creation until the template catalog and archives were uploaded to its R2 bucket.

**How to apply:** Bootstrap disposable VibeSDK environments from the matching public VibeSDK and template repositories before testing the SDK. Keep identities and API keys staging-only.

VibeSDK platform publishing currently requires an account ID and Cloudflare API token even when the Worker has an isolated dispatch namespace binding.

**Why:** Build, realtime state, preview, and cancellation worked without the token, but platform publish explicitly rejected the missing account credentials. The available token could mutate protected account resources and therefore could not satisfy a hard staging boundary.

**How to apply:** Do not attach a broad production-capable token merely to complete a staging publish test. Require an owner-approved credential boundary or change the publishing architecture first.