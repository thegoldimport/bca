---
name: VibeSDK generation completion
description: Runtime completion and reconnect constraints for Builder turns and checkpoints.
---

Do not treat a generation-complete event or `shouldBeGenerating: false` alone as proof that a build is finished. Confirm that tool streaming has settled and validate actual content changes before reporting success.

**Why:** A Think follow-up emitted an early completion state, then continued running read, edit, and browser-console tools for several minutes. The workspace changed after the original request ended. After reconnect, the completed commit hash was no longer available from runtime state.

**How to apply:** Keep long builds in durable background jobs, persist changed files and commit hashes immediately when the real tool run settles, and reject zero-change Build responses rather than presenting them as completed work.