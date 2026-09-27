---
name: Publish request trace interpretation
description: Distinguishing a Publish server hang from a client-side preflight failure.
---

When a customer Publish checker times out waiting for a particular POST, do not assume the server held that request. Correlate browser requests, UI error state, and control-plane invocation logs for the whole click sequence, including any preflight writes. A missing POST with a completed earlier error is a client-side path failure, not an unbounded server request.

**Why:** A same-revision retry was initially described as a four-minute server hang. Historical invocation records showed only a fast failed settings write and no retry POST; a controlled direct POST returned the existing release promptly. The checker had waited only for the POST and missed the UI failure.

**How to apply:** On future publish regressions, record the initial click, each request and response status, the final UI state, and the server invocation timeline before changing deployment or claim logic. In particular, do not use a timeout in a POST-only browser watcher as evidence that the Publish server branch blocked.