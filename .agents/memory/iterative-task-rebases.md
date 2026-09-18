---
name: Iterative task rebases
description: How to validate repeated conflict rounds when a task contains several corrective commits.
---

When a task rebase replays several iterative fix commits, expect the same file to conflict in multiple rounds. Re-check the full affected behavior after every round, including nearby lines outside the conflict markers.

**Why:** A later corrective commit can be based on an older intermediate version. Resolving only the visible markers may silently restore an earlier mock, cleanup path, or assumption that had already been fixed.

**How to apply:** Preserve the latest passing semantic version, inspect conflict-adjacent code after each continuation, and rerun the exact regression command before continuing again.