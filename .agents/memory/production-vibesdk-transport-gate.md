---
name: Production VibeSDK transport gate
description: Non-disruptive transport requirement for connecting the Cloudflare production control plane to existing VibeSDK workspaces.
---

The active BuildCustom VibeSDK runtime uses a historical staging-style resource name but owns production workspaces and generated applications. Treat it as protected production infrastructure. Its deployed bundle already contains the authenticated API-key exchange, agent connect/create, WebSocket ticket, and ticketed WebSocket transport required by the narrow control-plane adapter.

**Why:** Comparing the downloaded active and isolated-staging bundles showed the same ETag. The earlier missing-transport conclusion came from probing incomplete or wrong paths. Adding a dedicated API-key record to the runtime D1 and storing the raw value only in the control-plane secret enabled preserved-agent reconnection without a runtime deployment.

**How to apply:** Do not deploy or replace the production runtime merely to expose transport. Preserve its Worker version, bindings, Durable Object namespaces, and existing API keys. Add or revoke only the dedicated control-plane API-key record and secret when transport access changes.

VibeSDK forward restore currently updates and redeploys the target tree in `SpaceDO` but does not refresh `ThinkAgent.state.generatedFilesMap`; reconnecting through the adapter therefore returns stale files.

**Why:** The restore canary returned the requested commit and a working restored preview, while subsequent authenticated file reads still showed the pre-restore edited files. A post-rollback `get_conversation_state` produced no fresh state frame.

**How to apply:** Keep runtime mutations gated off until restore updates ThinkAgent hydration or exposes a documented authoritative refresh operation. Require restored file hashes and a subsequent edit from the restored state before cutover.