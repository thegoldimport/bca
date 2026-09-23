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

For managed-publish acceptance when there is no separately owned staging DNS zone, a dedicated `workers.dev` gateway can route `/p/<slug>/` using isolated route KV and a staging dispatch binding. Do not equate this path-based proof with arbitrary app/subdomain parity.

**Why:** Root-absolute asset URLs can be rewritten, but a generated SPA can also create root-level routes in JavaScript at runtime; those lose the slug prefix and are not generally correct under a path gateway. An isolated hostname is still needed to prove generic slug-hosted behavior without changing production DNS.

**How to apply:** Test the actual generated app, referenced assets, and expected content through the gateway. Report path-only acceptance as bounded until an isolated staging zone/hostname is available.