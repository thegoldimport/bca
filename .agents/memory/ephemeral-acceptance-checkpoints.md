---
name: Ephemeral acceptance checkpoints
description: One-way customer tests must not rely on /tmp as the only copy of their session and mutation history.
---

Keep recoverable, access-controlled acceptance state before beginning a one-way customer journey; do not assume a private directory under `/tmp` survives a container or tool-server restart. If it disappears, fail closed rather than reconstructing a customer identity, resetting a click guard, or treating a newly created browser profile as the original session.

**Why:** A pre-submit form diagnosis was completed without mutation, but a subsequent environment interruption removed both the private checkpoint and authenticated browser profile. The next browser launch silently created an empty profile, so a product status read no longer had an authenticated preview URL. The source revision and read-only database facts remained known, but the original account's randomly generated login credential and durable click history were no longer locally recoverable.

**How to apply:** Before creating an acceptance customer, design an approved secure persistence/recovery path for the owner session and one-way counters that survives environment resets. On resume, independently verify checkpoint identity and database baseline before any action. Never store credentials or preview capabilities in project source, logs, or agent memory.

Persist non-secret release audit, inactive verification, activation, and failed-attempt archive receipts in the workspace before restarting local workflows. A successful remote activation does not make a disposable checkout's local receipts durable.

**Why:** Restarting the local preview removed a temporary canonical checkout after activation. PASS logs and source manifests survived, but detailed audit/staging JSON needed a clearly labeled read-only live-version/module recovery receipt. Repeating uploads or claiming the lost original receipt was retained would have been incorrect.

**How to apply:** Copy sanitized receipts immediately after each release phase. If lost, distinguish retained PASS summaries from recovered remote evidence; verify serving version IDs, rollout, variables and complete uploaded module hashes without another release audit, upload or activation.