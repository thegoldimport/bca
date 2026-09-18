---
name: Workers for Platforms URLs
description: How isolated staging dispatch scripts receive a TLS-valid public URL.
---

Serve dispatch-namespace scripts through the staging worker’s valid hostname under `/deployed/<script-name>/`, rewriting the path before dispatch.

**Why:** A constructed host shaped like `<script>.<namespace>.<account>.workers.dev` did not terminate TLS in this account, even though deployment to the dispatch namespace succeeded.

**How to apply:** Keep the script in Workers for Platforms. Route requests through the main staging Worker, preserve the browser’s path prefix for relative assets, and return that path URL in deployment events.