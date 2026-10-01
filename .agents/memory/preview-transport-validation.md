---
name: Preview transport validation
description: Validate generated-app source preservation and real module/bootstrap transport, not only URL helper outputs.
---

Require preview transformation tests to execute a representative full document, including its import map and module/Babel bootstrap, in addition to request-helper tests.

**Why:** A request-boundary fix passed URL, authorization, lifecycle, typecheck, and build checks but initially scoped bare package imports as local assets. Production preview could not mount until those import-map specifiers were preserved. Correct helper output alone did not establish a working application.

**How to apply:** Test ordinary source data, templates, regexes, comments, JSX, import-map JSON, bare specifiers, and actual first-head script execution. Keep source transformation limited to syntactic module URL spans; authorize dynamically constructed application URLs at their request sink without rewriting arbitrary strings.

Treat rollback evidence and recovery commands as release-specific, including after an unknown activation outcome.

**Why:** A corrected release used separate receipts, but an unprefixed recovery command selected the older rolled-back receipt. A reconciled candidate-serving state also initially failed the ordinary rollback gate.

**How to apply:** Exercise advertised recovery commands and the transition from reconciliation to rollback in offline tests. Verify the exact serving candidate and unaffected components before restoring the recorded predecessor.