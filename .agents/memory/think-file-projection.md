---
name: Think file projection
description: Why an authoritative SpaceDO restore must replace the persisted host file snapshot before session success.
---

Keep SpaceDO as the sole authoritative workspace. After an exact restore, replace the entire host Think file projection from SpaceDO before a success frame; additions and deletions must be represented together. Do not try to refresh it from the host's legacy Git repository or from conversation history. Distinguish the restored workspace from preview build status.

**Why:** In an isolated real canary, SpaceDO's complete committed tree matched A while the current and freshly reconnected SDK file views both returned B. Reconnect loaded the host's persisted file map, not workspace files; child Think tools already used SpaceDO. An isolated correction with a complete SpaceDO-backed host snapshot yielded A in both sessions and an A-derived next edit even though preview building still failed.

**How to apply:** Treat file projection as a derived, replaceable view and persist/publish it before claiming a restore is complete. A preview failure after the commit must not leave B displayed or be mistaken for a failed authoritative restore. A failed state publication must not be silently swallowed; there is no absolute guarantee during simultaneous state-persistence and fallback-invalidation failure. Do not generalize this candidate to the protected runtime without source provenance.