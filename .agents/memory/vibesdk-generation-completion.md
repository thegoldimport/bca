---
name: VibeSDK generation completion
description: Runtime completion and reconnect constraints for Builder turns and checkpoints.
---

Do not treat a generation-complete event or `shouldBeGenerating: false` alone as proof that a build is finished. Confirm that tool streaming has settled and validate actual content changes before reporting success.

**Why:** A Think follow-up emitted an early completion state, then continued running read, edit, and browser-console tools for several minutes. The workspace changed after the original request ended. After reconnect, the completed commit hash was no longer available from runtime state.

**How to apply:** Keep long builds in durable background jobs, persist changed files and commit hashes immediately when the real tool run settles, and reject zero-change Build responses rather than presenting them as completed work.

An isolated real-Think test also emitted an error from the model call immediately before `generation_complete`, then authenticated reconnect showed zero files. Treat completion as a transport lifecycle signal, not an assertion that the model succeeded or any revision exists.

For a fresh disposable Think project, do not stop capturing the stream at the first `deployment_failed`: stock Think may correct the generated files and deploy successfully later in the same generation. An immediate owner-cookie WebSocket handshake can also return 403 while project initialization is still settling; verify ownership through the normal read API and reconnect with an owner-issued one-time ticket rather than creating a replacement project.

**Why:** One controlled run initially failed to bundle an assets-only project, then added a server entry and reached a successful deployment without a second generation request. Its immediate WebSocket handshake failed, but a later authorized ticket connected to the same project.

**How to apply:** Preserve owner access, the entire tool-result stream, and the committed branch revisions; wait for the final generation state and verify the latest deployed revision. If the initial connection fails, reconnect to the existing agent only after confirming owner access.