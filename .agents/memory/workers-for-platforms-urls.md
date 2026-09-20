---
name: Workers for Platforms URLs
description: How isolated staging dispatch scripts receive a TLS-valid public URL.
---

Serve dispatch-namespace scripts through the staging worker’s valid hostname under `/deployed/<script-name>/`, rewriting the path before dispatch.

**Why:** A constructed host shaped like `<script>.<namespace>.<account>.workers.dev` did not terminate TLS in this account, even though deployment to the dispatch namespace succeeded.

**How to apply:** Keep the script in Workers for Platforms. Route requests through the main staging Worker, preserve the browser’s path prefix for relative assets, and return that path URL in deployment events.

For server-to-server control-plane calls, use a Cloudflare service binding for both HTTP and WebSocket upgrades instead of fetching the sibling `workers.dev` hostname.

**Why:** A Worker calling the isolated VibeSDK Worker by its public `workers.dev` hostname received Cloudflare error 1042, including with `global_fetch_strictly_public`; the service binding carried authenticated HTTP and WebSocket traffic successfully.

**How to apply:** Keep credentials in the caller/runtime Workers, convert returned `wss:` URLs to service-binding `https:` upgrade requests, and consume the returned `response.webSocket` without exposing runtime credentials to browsers.