---
name: Isolated VibeSDK bootstrap
description: Requirements and credential limitation discovered when cloning VibeSDK into isolated Cloudflare staging resources.
---

An isolated VibeSDK Worker clone needs the canonical public D1 migrations and template catalog applied separately; neither is carried in the downloaded Worker module bundle.

**Why:** A bundle-only clone could answer health checks but failed API-key authentication until the D1 migrations and a staging-only API key were created, then failed agent creation until the template catalog and archives were uploaded to its R2 bucket.

**How to apply:** Bootstrap disposable VibeSDK environments from the matching public VibeSDK and template repositories before testing the SDK. Keep identities and API keys staging-only.

Do not assume an embedded templates directory remains a usable Git checkout after a workspace checkpoint. If its nested Git metadata disappears while files remain, the stock deployment script attempts to clone into a nonempty directory, reports template deployment failure, but can still declare the overall Worker deployment successful.

**Why:** A clean lab's first stock deploy uploaded a Worker despite this non-blocking template failure; the checkout directory existed but no longer contained its nested Git metadata.

**How to apply:** Check template checkout integrity and the template-upload step independently before claiming a full VibeSDK deployment succeeded. Do not infer success solely from the final Worker deployment message.

VibeSDK platform publishing currently requires an account ID and Cloudflare API token even when the Worker has an isolated dispatch namespace binding.

**Why:** Build, realtime state, preview, and cancellation worked without the token, but platform publish explicitly rejected the missing account credentials. Its dispatch upload calls require account-scoped Workers Scripts Write; Cloudflare exposes no dispatch-namespace or script-name token resource scope. The available token could mutate protected account resources and therefore could not satisfy a hard staging boundary.

**How to apply:** Do not treat a broker allowlist as a credential boundary when the broker token remains account-wide. Use a separate staging-only Cloudflare account, wait for namespace-scoped credentials, or obtain explicit approval to weaken the boundary.