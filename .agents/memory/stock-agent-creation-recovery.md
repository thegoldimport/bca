---
name: Stock agent creation recovery
description: Retry boundaries for authenticated stock ThinkAgent creation when an upstream response is lost.
---

Stock ThinkAgent creation does not accept an idempotency key. Its streamed ID arrives before initialization completes or the owner-visible app row is persisted. The owner-scoped app listing has a fixed newest-50 limit, and its controller does not honor pagination parameters. A lost response before the ID arrives therefore cannot always be resolved automatically.

**Why:** An automatic second creation request after an ambiguous response can create a second agent for the same product project. A missing listing match is not evidence that the first creation failed, especially before initialization finishes or after the app falls outside the newest 50.

**How to apply:** Claim initialization once in product storage, persist the first streamed ID promptly, and reconcile unknown outcomes against the authenticated owner's stock app listing using a project-specific marker. Verify the same owner's access before marking ready. If no match can be proven, leave the project blocked for manual review instead of sending another creation request. Never let a newly created product project use the historical shared-key runtime path while its link is missing.