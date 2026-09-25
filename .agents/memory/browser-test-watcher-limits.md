---
name: Browser test watcher limits
description: Chromium client tests can exhaust workspace inotify watches if they start additional Vite dev servers.
---

Starting an extra Vite dev server for browser tests while the main workflow and other test runs are active can exhaust this workspace's file watchers (`ENOSPC`), even when the application code is valid.

**Why:** Concurrent recovery-test servers caused the main development workflow to crash at a watched client file. A built client served from a lightweight local HTTP server let the same Chromium scenarios run without an additional watcher tree.

**How to apply:** For deterministic browser replay, build the client once and serve static output from a short-lived local server rather than starting parallel Vite watchers. Restart the managed workflow once after the test batch if watcher exhaustion stopped it.