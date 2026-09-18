---
name: Direct Gemini routing
description: Compatibility rules for ThinkAgent calls that bypass Cloudflare AI Gateway.
---

When `directOverride` is enabled for a Google model, strip the `google-ai-studio/` gateway prefix from the model ID, set `useStoredKeys` to false, and do not add Cloudflare AI Gateway headers.

**Why:** Stored-key mode removes the provider Authorization header. Google then returns a misleading HTTP 400 with “Missing or invalid Authorization header,” even though the API key and model are valid.

**How to apply:** Use this only for direct provider routing. Gateway-routed models still need their qualified model ID and stored-key behavior.