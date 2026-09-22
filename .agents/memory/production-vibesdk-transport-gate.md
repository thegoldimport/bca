---
name: Production VibeSDK transport gate
description: Non-disruptive transport requirement for connecting the Cloudflare production control plane to existing VibeSDK workspaces.
---

The active BuildCustom VibeSDK runtime uses a historical staging-style resource name but owns production workspaces and generated applications. Treat it as protected production infrastructure. It lacks the authenticated HTTP/WebSocket transport endpoints proven on the isolated migration clone.

**Why:** Health succeeds on the active runtime, but transport paths fall back to its frontend and its bindings expose internal JWT state rather than the adapter API-key contract. Replacing it or switching to a fresh clone would disconnect persisted agent IDs from their Durable Object workspaces.

**How to apply:** Keep production control-plane runtime mutations disabled until an additive transport change is reviewed and shown to preserve the existing Worker bindings and Durable Object namespaces. Do not rename, clone-and-switch, or rotate runtime authentication blindly.