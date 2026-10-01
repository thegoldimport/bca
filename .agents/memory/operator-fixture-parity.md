---
name: Operator fixture parity
description: Avoid claiming offline acceptance for a browser operator whose mock and live control flows differ.
---

For a one-time production acceptance operator, a deterministic fixture runner must invoke the same orchestration and case lifecycle as the live operator, with only I/O adapters replaced. Sharing response classifiers and assertion functions alone does not prove navigation, response waiting, no-retry click handling, reconciliation, or failure checkpointing. Its owner-bound status, revision, and evidence gates must also be validated against the live service contract before consuming a one-use fixture.

**Why:** A local fixture suite can pass every injected failure while the actual browser script still has separate control flow and untested failure boundaries. A one-use setup later created its disposable project but failed before the coding request because the live owner status and safe revision-evidence shape did not satisfy locally mocked assumptions. Treat passing mocks as useful component coverage, not an accepted full dry run.

**How to apply:** Before authorizing a single-use live test, trace each live phase to the same callable orchestration entrypoint used by offline fixtures and validate owner-scoped response shapes using an authorized isolated simulation or safe preflight. If they differ, report the full dry-run criterion as unmet and keep the production gate closed. Do not compensate by silently creating a second fixture.