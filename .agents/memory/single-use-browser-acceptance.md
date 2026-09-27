---
name: Single-use browser acceptance
description: Safely exercise one-time dashboard operations when a browser automation input may not update application state.
---

For a single-use browser action, checkpoint before the mutation and distinguish a pre-click UI failure from an unknown post-click outcome. Do not retry from an ambiguous checkpoint. A controlled textarea can display the filled text while the React state behind its submit button remains empty; verify both the exact text and enabled button, and use an actual keyboard change to reconcile state before clicking.

**Why:** A private acceptance run timed out before the create click because the visible field had the expected text but its submit control stayed disabled. A later keyboard event updated state without creating anything; remote storage confirmed the pre-click project count was still zero.

**How to apply:** In future one-shot UI provisioning tests, make the checkpoint represent the actual mutation boundary. If a pre-click attempt fails, verify authoritative storage has no target record before resuming. If the click may have happened, inspect storage and do not repeat it.