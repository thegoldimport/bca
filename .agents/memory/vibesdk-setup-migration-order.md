---
name: VibeSDK setup migration ordering
description: A fresh remote setup can leave D1 uninitialized while reporting overall setup completion.
---

Official VibeSDK setup can attempt remote D1 migrations before it replaces the pre-creation database ID in its Wrangler configuration, then continue after the migration command fails. Do not interpret an overall successful setup exit or a created D1 as proof that its schema is ready.

**Why:** An isolated lab setup created a new D1 successfully, but its remote migration command exited with code 1 while the config still held a safe placeholder ID. Setup later inserted the real new ID and exited successfully.

**How to apply:** Inspect the remote migration result and the final D1 ID before deploying or starting ThinkAgent. When a test's stop-on-failure rule applies, report the partial setup and leave resources intact rather than inferring that the database is initialized.