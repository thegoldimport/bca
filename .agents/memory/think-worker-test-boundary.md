---
name: Think Worker test boundary
description: An installed SDK dependency-resolution trap in isolated Cloudflare Worker tests.
---

Importing the installed Think harness directly in isolated Worker Vitest can pull in a shell bundle with an unresolved extensionless `turndown` module, even while the application typecheck and production build succeed. A failure at module collection is not evidence that the tested lifecycle predicate is wrong.

**Why:** A browser-verification test initially failed before running any assertions because its import loaded the entire SDK shell dependency graph. Testing the actual dependency-light contract used by the harness removed that unrelated test-runtime boundary.

**How to apply:** Keep pure evidence/state predicates testable without importing the entire Think runtime, or explicitly mock the SDK boundary for class tests. Do not weaken verification or upgrade production dependencies solely to make such an isolated test collect.