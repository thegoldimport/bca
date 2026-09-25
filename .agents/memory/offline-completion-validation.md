---
name: Offline completion validation
description: Distinguish the accepted stock coding loop from client completion-signaling reliability.
---

The owner-linked stock ThinkAgent coding loop—from project selection and native progress through committed files, preview, follow-up edit, persisted history, and fresh-session reopen—was explicitly accepted as functionally proven. Completion-state reliability is a separate concern. Do not repeat a real generation merely to validate a missing or interrupted completion signal.

**Why:** The user accepted the initial and edit results despite incomplete WebSocket lifecycle signals, then required zero new inference while validating client recovery.

**How to apply:** Use deterministic browser-level replay of the observed frame types and stock state transitions, plus read-only checks of the existing project and Gateway count. Keep follow-up work scoped to client/bridge reliability until separately authorized.