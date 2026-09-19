---
name: Migration snapshot compatibility
description: Backward-compatibility rule for recovery guidance built from persisted custom-domain migration state.
---

Recovery guidance must derive required customer actions from the oldest reliable persisted source when newer convenience or derived fields are missing.

**Why:** Existing customers can resume migrations saved before newer derived fields were introduced. Treating a missing derived field as “no action needed” can hide required DNS changes.

**How to apply:** When adding recovery UI based on persisted migration state, test both the current snapshot shape and an older snapshot containing only the underlying inventory or source facts.