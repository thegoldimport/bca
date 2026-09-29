---
name: Operator fixture parity
description: Avoid claiming offline acceptance for a browser operator whose mock and live control flows differ.
---

For a one-time production acceptance operator, a deterministic fixture runner must invoke the same orchestration and case lifecycle as the live operator, with only I/O adapters replaced. Sharing response classifiers and assertion functions alone does not prove navigation, response waiting, no-retry click handling, reconciliation, or failure checkpointing.

**Why:** A local fixture suite can pass every injected failure while the actual browser script still has separate control flow and untested failure boundaries. Treat that as useful component coverage, not an accepted full dry run.

**How to apply:** Before authorizing a single-use live test, trace each live phase to the same callable orchestration entrypoint used by offline fixtures. If they differ, report the full dry-run criterion as unmet and keep the production gate closed.