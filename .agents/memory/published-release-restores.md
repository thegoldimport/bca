---
name: Published release restores
description: Product rule for preserving and restoring BuildCustom production release points.
---

Every production publish must record the exact VibeSDK commit and live URL as a release point. Restoring an old release must create a new forward restore commit in Development rather than resetting or rewriting history.

**Why:** Publishing changes the live app immediately and cannot be reversed in place, but users need a safe way to recover any prior published version, test it in Development, and deliberately publish it again.

**How to apply:** Keep Production unchanged during restore. Require confirmation, restore the selected commit through the SpaceDO rollback mechanism, open the restored result in Development, and require the normal publish approval flow before it becomes live.