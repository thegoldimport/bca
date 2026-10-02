---
name: Customer operation diagnosis
description: Distinguish old queued task errors, fresh operation accounting, and account-wide admission policy.
---

Do not infer inherited operation budgets from the first error shown while a new customer message is waiting. Correlate the sequential native operations and their counter resets first.

**Why:** A retained older queue item stopped on elapsed time, then a fresh operation made two model calls and stopped on metered credits. The first UI error and the latest supported lifecycle referred to different operations, not a proven identity collision.

**How to apply:** Compare native response/conversation identifiers and start/stop counters. If private operation storage is protected and exact task IDs or timestamps are not projected, say those values are unavailable rather than bypassing storage or claiming they were observed.

Account-wide metering must follow the customer-admission policy independently of the per-operation budget.

**Why:** Admission disabled stock Cloudflare daily limits for the self-deployed runtime, while Think still read and charged the stock daily bucket. A fresh operation therefore stopped before its configured operation allowance was consumed.

**How to apply:** When resource ceilings appear inconsistent, distinguish operation credits from account quota and check whether both admission and execution apply the same enabled/disabled policy. Never reset a real account quota to make a new operation pass.