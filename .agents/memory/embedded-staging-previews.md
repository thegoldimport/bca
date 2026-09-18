---
name: Embedded staging previews
description: Requirements for loading the isolated VibeSDK staging preview inside BuildCustom.
---

BuildCustom embeds VibeSDK staging previews cross-site even though the preview uses the runtime worker's primary hostname. The isolated staging worker must opt into `SameSite=None; Secure; Partitioned` preview cookies.

**Why:** `SameSite=Lax` allows the preview HTML to load from its signed URL but prevents authenticated JavaScript and other subresources from loading in Chrome's iframe, producing a blank preview.

**How to apply:** Keep the behavior behind the staging-specific embed flag so upstream same-origin behavior remains unchanged. Run the staging build before Wrangler deploy because direct deploy uploads the existing compiled bundle.