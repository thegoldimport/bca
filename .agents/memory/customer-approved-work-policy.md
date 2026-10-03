---
name: Customer-approved work policy
description: BuildCustom's product rule for bounded work sessions and repeated customer approval.
---

An unfinished customer task may span repeated, explicitly customer-approved bounded work sessions. Approval continues the existing task rather than asking the customer to explain it again. Do not introduce an arbitrary task-wide session cap.

**Why:** The user explicitly chose bounded autonomy per session, with the customer deciding whether to authorize more work. Genuine account-level billing and usage restrictions remain separate.

**How to apply:** Preserve this distinction when changing continuation, reconnect, accounting, or customer status behavior. Approval must not bypass account restrictions or make unfinished work look complete.

Optional Auto Continue is pre-authorization for future gates on one task, defaults OFF, and must use the same secure/idempotent transition as manual approval. New substantive direction revokes the old authorization; an account-wide default is out of scope.

**Why:** The user explicitly chose task-level opt-in as the safest scope and kept genuine account limits separate from operation limits.

**How to apply:** Preserve bounded sessions and deliberate authorization when extending automation. Disabling future approvals must not abruptly interrupt an active tool mutation.

Stopped/error is for meaningful reasons that make automatic continuation inappropriate, not a generic substitute for unfinished work. Needs Input requires an actual customer dependency. Authoritative terminal state must clear Working.

**Why:** The user distinguished recoverable unfinished coding from customer-input requirements and genuine platform failures, explicitly rejecting blind retries that could loop around errors.

**How to apply:** Establish the recorded stop reason before proposing continuation eligibility. Keep status synchronization corrections separate from changes to manual or automatic approval semantics.