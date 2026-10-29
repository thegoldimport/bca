---
name: Portable browser tests
description: Shared Puppeteer tests need a browser executable available in both Replit and external CI.
---

Browser tests shared by Replit and GitHub Actions must not hardcode the Replit Chromium path. Prefer an explicit executable override, then the local Replit browser when present, and otherwise Puppeteer's managed browser.

**Why:** GitHub runners do not have `/repl/tools/bin/chromium`; Replit's bundled Puppeteer browser can also fail locally because some system libraries are absent.

**How to apply:** Resolve the executable by environment, and verify both the Replit test path and the external CI path after browser-related test changes.
