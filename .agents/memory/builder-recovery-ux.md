---
name: Builder recovery UX
description: BuildCustom's native editor should make chat immediately usable while runtime recovery happens automatically.
---

**Rule:** Opening a project should leave the customer able to draft in the Agent chat without a manual status-check step. Reconnect and state reconciliation belong in the background. Only enable sending when fresh runtime evidence shows that a new request will not overlap active work. Show live activity for the current chat turn, while keeping prior activity with its saved checkpoint.

**Why:** The user explicitly said that recovery controls and instructions make the Builder feel unlike Replit and create unnecessary friction. They also want older activity available at its chat turn and the option to restore that turn's checkpoint without affecting Production.

**How to apply:** Keep the composer available, remove routine Check Agent controls, reconnect automatically with bounded backoff, start a fresh live activity group for each explicit request, and expose confirmed Development-only restore for verified checkpoints. Never replay an old prompt or infer application completion from idle status alone.
