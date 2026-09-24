---
name: Cloudflare secret versions
description: Separating Worker secret binding presence from the version actually serving a rotated secret.
---

Replacing a Worker secret through the Cloudflare dashboard can create a newer version without deploying it. An older version may remain at 100% while the newer version has identical script code and binding names. Never infer which secret value is active from binding presence or the latest version alone.

**Why:** A diagnostic request using a newly rotated secret returned 404 while the previous Worker version still served 100%; the dashboard had created a newer undeployed version with the same script.

**How to apply:** Compare current deployments with version history after a dashboard secret change. Before attributing a failed authorization to routing or code, verify that the secret-changing version is actually deployed. Do not inspect secret values.