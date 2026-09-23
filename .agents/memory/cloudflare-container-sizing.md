---
name: Cloudflare container sizing
description: Cloudflare container resource validation constraints discovered during isolated VibeSDK provisioning.
---

When sizing a Cloudflare Container application, allow at least 3 GiB of memory for each of its first four vCPUs, and no more than 2 GiB of disk for each 1 GiB of memory. A small test size that satisfied validation was 1 vCPU, 4 GiB memory, 8 GiB disk.

**Why:** An isolated Worker upload succeeded but creating its Container application failed twice, first on insufficient memory per CPU and then on the disk-to-memory ratio. The prior configuration had been accepted earlier, so reusing known-good resource numbers did not guarantee a new application would pass current validation.

**How to apply:** Check these relationships before the first disposable Container deployment, even when copying a previously working configuration. These sizing constraints are about Container applications, not VibeSDK model inference.