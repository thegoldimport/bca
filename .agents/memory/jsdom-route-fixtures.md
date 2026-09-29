---
name: JSDOM route fixtures
description: Distinguishing blank-page test timeouts from actual client routing failures.
---

An SPA route test can time out on an empty JSDOM body when its mocked API returns HTTP 200 with an underspecified object. The component can throw while reading a required field before its text appears; a `VirtualConsole` listener for `jsdomError` alone may not expose that window exception.

**Why:** A project-detail route appeared broken after an unrelated marketing cleanup, but its route code had not changed. A schema-shaped project fixture resolved the timeout without a product edit.

**How to apply:** When a browser-harness route is blank, inspect the mocked response shape and component field access before attributing the failure to routing. Capture window errors as well as virtual-console errors during diagnosis; keep test fixtures representative of real API responses.