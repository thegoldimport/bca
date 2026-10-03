---
name: Gateway traffic evidence
description: AI Gateway aggregate log counts can remain unchanged while newly created request rows are already readable.
---

Do not identify competing inference traffic solely from a mismatch between AI Gateway `result_info.total_count` and an expected increment. Establish traffic from timestamped log rows and exact inference response log IDs, verifying that the fetched window reaches before the experiment start.

**Why:** Five diagnostic requests were visible individually and in the newest log list, but the list's aggregate total remained at its pre-experiment value. A strict aggregate-count gate incorrectly stopped the experiment and labeled the mismatch as competing traffic. Read-only reconciliation found only the five diagnostic rows in the execution window.

**How to apply:** For bounded, owner-approved experiments, retain the original stop evidence and distinguish a harness verification failure from a provider failure. A stopped experiment must not be resumed or repeated without fresh authorization. Use bounded, complete timestamp-window evidence rather than assuming aggregate counts update synchronously.