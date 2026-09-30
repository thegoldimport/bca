---
name: Launch registration config parity
description: Prevent runtime-only deployments from silently changing the customer signup gate.
---

Before deploying the launch runtime from a reconstructed or ignored checkout, compare its full Wrangler configuration against the tracked intended launch configuration, not just the Worker bundle. Registration must be enabled in both the runtime and the product control plane for normal public signup.

**Why:** A runtime deployment made for an unrelated preview fix used a stale ignored launch config and changed only the runtime registration binding from true to false. The product still advertised signup, but forwarded registrations then received 403. Cloudflare version binding snapshots identified the mismatch; code tests alone could not.

**How to apply:** Read the actual serving Worker version bindings and compare them with the intended config before and after a runtime deploy. Preserve every other binding, check both live signup capability endpoints, and make one normal UI signup attempt only after they agree.