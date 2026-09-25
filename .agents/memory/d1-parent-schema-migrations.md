---
name: D1 parent schema migrations
description: Preserving child records when changing a parent table with cascading foreign keys in Cloudflare D1
---

Avoid rebuilding a D1 parent table by dropping it when child tables reference it with `ON DELETE CASCADE`. Deferring foreign-key checks does not defer cascades, and setting `foreign_keys=OFF` inside a Wrangler-executed batch did not prevent them. Prefer an in-place, column-only migration for a small constraint change when SQLite supports it, preserving existing values in a clearly identified optional column.

**Why:** A populated local D1 rehearsal silently removed project and session rows during a parent-table rebuild, whereas a column-only approach preserved those rows and passed `foreign_key_check`.

**How to apply:** Rehearse any parent-table migration against a populated local D1 with representative children; compare row counts and foreign-key checks before and after. Back up the target before applying the migration. Never take successful SQL execution alone as evidence that related data survived.