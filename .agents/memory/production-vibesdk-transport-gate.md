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

The current upstream restore path reports SpaceDO deployment before refreshing the ThinkAgent file projection. Its existing file-manager Git synchronization reads legacy agent-local Git, not SpaceDO, so it is not a safe refresh operation. An isolated attempt to return a SpaceDO snapshot with rollback remained unsafe because consistency-sensitive reads and an alternate HTTP deploy path bypassed the workspace mutation boundary.

**Why:** Repeated isolated patch reviews found that a correct restore result alone cannot guarantee a coherent observed tree when other SpaceDO operations can interleave with checkout/reconciliation, and deploy paths do not share the same materialization behavior.

**How to apply:** Before deploying a restore fix, unify coherent workspace reads and writes under the same SpaceDO serialization boundary and bring HTTP/RPC deploy semantics into alignment. Test the real SpaceDO method composition, both restore entry points, reconnect, and edit-after-restore in isolation; do not treat unit-only hydration tests as acceptance.

Cancellation needs separate attention: ThinkAgent chat runs in a child Durable Object while the host's generation ownership is in memory. A host reset/reconnect can lose the guard while a child turn continues. A restore is not safe merely because the host reports idle; the child turn needs an effective cancel/fence before the restored tree is declared current.

**Why:** Isolated source review found that host cancellation does not propagate an abort to the child ThinkAgent turn, and a failed restore commit can otherwise be followed by a deployed older branch while the host advertises restored files.

**How to apply:** Treat child-turn ownership and fail-closed commit/deploy verification as prerequisites for the restore canary. Do not use a generatedFilesMap refresh alone as proof of workspace consistency.

The matching downloaded bundle ETags for protected production and isolated staging prove they run the same artifact, but neither version metadata nor the bundle establishes the exact public Git source revision that built it. The isolated staging database migrations came from a known public commit; that is not deployment provenance.

**Why:** The protected Worker’s Cloudflare version metadata identifies a Wrangler upload but contains no Git commit. A candidate clean checkout can be made from upstream, yet running tests against it cannot establish a baseline for the protected Worker until source identity is proved.

**How to apply:** Before another restore patch, recover trusted source-to-bundle provenance (build manifest/commit annotation or a reproducible artifact match). Do not treat public `main`, a staging D1 migration commit, or matching production/staging ETags as proof of the production source commit.

An unknown production source commit is a hard gate for protected-Worker deployment, **not** for reproducing and developing an isolated fix against a clearly labeled candidate checkout. Keep those gates separate.

**Why:** The owner explicitly distinguished executable candidate-baseline work from later production compatibility proof. The public candidate can run its pinned Bun/Node unit/type/build checks even while the production source-to-bundle link remains unknown.

**How to apply:** Reproduce the central Think/SpaceDO stale-state defect with an executable test against the unmodified candidate before implementing another fix. Treat pinned Vitest/Miniflare's missing `cloudflare:workers` named `exports` binding as a test-harness gap, not evidence that the defect is fixed or absent.