---
name: Acceptance artifact ordering
description: Durable completion and reconciliation evidence rules for single-action signup acceptance.
---

Persist a final PASS artifact only after all lifecycle checks and cleanup succeed, and before an irreversible one-time credential handoff. A failed acknowledgment after handoff is UNKNOWN rather than permission to repeat the handoff.

**Why:** An earlier order could leave a persisted PASS after cleanup failed, or hand off credentials before the final PASS write succeeded. A successful real reconciliation also represented read errors as an empty array while an offline fixture used null, so the fake passed when the production-shaped result failed.

**How to apply:** In any acceptance operator with irreversible actions, test artifact-write failure on the successful path and cleanup failure before completion. Feed production-shaped success and missing, nonempty, and empty error collections through the same offline runner.