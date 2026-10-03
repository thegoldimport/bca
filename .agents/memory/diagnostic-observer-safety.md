---
name: Diagnostic observer safety
description: Observability equivalence and redaction gates for production error instrumentation.
---

Treat all diagnostic metadata collection as part of the best-effort observer boundary, not only the final log call. Factories, getters, serialization, and context construction must not prevent a success callback or replace the original operation's exception.

**Why:** Review of an observability-only candidate found that a protected console sink did not protect metadata factories evaluated before the sink. Passing happy-path instrumentation and lifecycle tests did not establish observational equivalence.

**How to apply:** Test throwing metadata factories and getters alongside throwing sinks; assert exact result/error identity and unchanged callback invocation counts before approving deployment.

Do not treat arbitrary WebSocket close reasons, error messages, or stack headers as metadata-only. Pattern-based credential redaction does not guarantee that unlabelled customer content or short opaque credentials are removed.

**Why:** A safety review found that allowlisting error properties still retained unlabelled sensitive text inside allowed string fields.

**How to apply:** Apply a fail-closed policy to untrusted free-form text, retain safely attributable structural fields and source frames, and explicitly test unlabelled content. A production observability release stays gated on these safety checks even when functional regressions pass.

Use exactly one writer for a shared live-acceptance evidence file. Detach a launcher's passive recorder before handing its browser to later phase drivers.

**Why:** A lingering recovery recorder retained an old in-memory snapshot and overwrote later acceptance facts when new frames arrived. This was an evidence-write race, not a customer lifecycle transition.

**How to apply:** End the previous recorder before phase handoff while preserving the browser session. Keep immutable phase receipts and reconstruct evidence only from those actual receipts, never by inventing click history or customer state.