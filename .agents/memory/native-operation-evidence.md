---
name: Native operation evidence
description: Separate customer authentication, public generation summaries, native journal outcomes, and acceptance completion.
---

Do not equate the owner-facing generation summary's idle flag with a native Think operation being finished. Correlate native stream metadata and tool records with the actual editor state and committed preview.

**Why:** During a live existing-app edit, the owner status endpoint repeatedly reported idle while the editor remained busy and native journal records showed active edits and automatic continuations.

**How to apply:** Preserve a one-way customer-send checkpoint and use native journal metadata to distinguish completed passes, zero-step failed attempts, step markers, and actual tool calls. A new commit and successful preview deployment still do not prove finish_task or controller completion.

Treat a successful baseline authentication check as point-in-time evidence, not a guarantee for the whole acceptance operation. A successful auth HTTP response may carry no signed-in user.

**Why:** A valid owner session at submission later became unauthenticated; project reads returned 401 while the editor still displayed cached UI. A first observer also assumed auth HTTP success implied a non-null user.

**How to apply:** Check the returned identity, not just HTTP status. Keep authentication loss separate from native stream errors unless a causal link is established. Never resend an already observed instruction to recover an observer or session.

When deriving working-tree status from a read-only SpaceDO export, include every remote file, including tracked hidden and root configuration files, before interpreting local Git deletions.

**Why:** A restricted export omitted two tracked config files, producing artificial deletions. Exporting the complete remote file set yielded a clean tree.

**How to apply:** Compare exported file inventory against the remote inventory and label derived status as a snapshot calculation, not native gitStatus RPC evidence.

Separate a chat RPC resolving from successful model execution. A callback-delivered native stream error can still let the driver mark the chat resolved and increment its completed-pass counter.

**Why:** A zero-step failed continuation increased the completed-pass counter even though its journal had no completed assistant message. Retained production diagnostics located the failure in a cumulative-resource guard before provider invocation.

**How to apply:** Correlate pass counters with stream statuses and step markers. Starting a stream does not prove a provider request was reached. Match retained stack locations to the active deployed bundle when private lifecycle getters have no safe owner endpoint; never bypass protected KV to obtain them.

A native stream can have terminal metadata status `error` without an explicit error chunk. A partial source commit or private deploy call does not turn that into accepted completion.

**Why:** A customer update produced a new commit, but its last native pass ended with error metadata, no error chunk, and no observed finish_task. Authentication subsequently blocked normal owner reads and sign-in; the evidence did not establish a common cause.

**How to apply:** Inspect stream metadata independently of chunk-level errors, require the finish_task/controller completion gates before publishing, and keep native failure, session loss, and login failure separately attributable. Do not assume a successful earlier pass or new revision proves the whole operation completed.

A green editor success badge is not authoritative evidence of native completion.

**Why:** A later customer repair returned control with supported native lifecycle `BLOCKED`, while the editor claimed that the build, authoritative files, and preview were verified. The rendered app still had zero leads and a failing leads request.

**How to apply:** Check the native lifecycle and rendered customer requirements independently of the badge. Keep a misleading status badge separate from generated-app defects, and do not publish a failed private repair.

An approval click, chat echo, or optimistic Working label does not establish that a new bounded operation started.

**Why:** Live acceptance briefly displayed Working after Continue, then returned to the same eligible boundary with unchanged durable operation identity and accounting.

**How to apply:** Preserve the one-way approval checkpoint and require a new operation identity plus fresh accounting before accepting a resumed session. Do not retry an ambiguous approval or treat the unchanged parent boundary as a second approved session.

An operation ending `BLOCKED` does not by itself prove that customer iteration is blocked.

**Why:** A subsequent normal customer correction was accepted, performed coding work, and created new private revisions after a `BLOCKED` result. The customer confirmed that remaining application defects should be handled through normal corrections, not automatic platform forensics.

**How to apply:** Check whether the chat remains usable and a new customer request can start working. Keep application-health verification separate from operation status. Follow the user's requested verification scope: a whole-CRM check continues after a failed basic data/API gate and reports the remaining customer-visible defects together. Failed private verification blocks publishing; do not inspect checkpoints or enter platform forensics to repair generated-app defects.