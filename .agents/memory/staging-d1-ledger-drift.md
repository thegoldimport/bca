---
name: Staging D1 migration ledger drift
description: Handle a pending migration whose schema is already present without replaying destructive or conflicting SQL.
---

Rule: A migration listed as pending is not proof that its schema changes are absent. Verify both the live schema and migration ledger before applying older ALTER statements.

**Why:** The staging database had project-link columns and an index already in place while its ledger lacked the corresponding migration entry. Replaying that migration would collide with existing columns.

**How to apply:** Take a staging-only backup, compare the complete migration's schema effects with live PRAGMA results, reconcile only a verified missing ledger entry, then apply new additive migrations normally. Never infer the same drift in production.