---
name: Single-use browser acceptance
description: Safely exercise one-time dashboard operations when a browser automation input may not update application state.
---

For a single-use browser action, checkpoint before the mutation and distinguish a pre-click UI failure from an unknown post-click outcome. Do not retry from an ambiguous checkpoint. A controlled input can display the filled text while React submit state remains stale; verify both the displayed value and the application's submitted state before clicking. If the unique marker is absent after a click, even a read-only collection with no matching record does not prove zero side effects: the app may have saved different values.

**Why:** One private acceptance run timed out before a create click because the visible field had the expected text but its submit control stayed disabled. Another reached a single Add Lead click, but the marker appeared in neither the UI nor the subsequent readable lead collection; without a before/after baseline, an unintended record could not be ruled out.

**How to apply:** In future one-shot UI provisioning tests, make the checkpoint represent the actual mutation boundary. If a pre-click attempt fails, verify authoritative storage has no target record before resuming. If the click may have happened, inspect storage read-only, retain the uncertainty, and do not repeat it.