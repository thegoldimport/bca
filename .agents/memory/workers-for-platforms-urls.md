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

An existing parent zone can safely host a separate staging wildcard without buying another domain if it already has Advanced Certificate Manager: issue an active `*.staging` certificate, then add only a proxied staging wildcard DNS record and a more-specific Worker route to the staging gateway. A separate child zone is not necessary for generated-app Test A.

**Why:** Universal SSL in a full-setup zone does not cover two-level subdomains, and a child subdomain zone requires Enterprise. A separate advanced wildcard certificate solved TLS here; the specific staging route took precedence over the pre-existing zone-wide production gateway route. The first live nested-route probe was invalid because the generated test app had no such route; acceptance must require an app to declare the route before testing direct refresh.

**How to apply:** Verify active certificate and a gateway-origin 404 for an unmapped staging hostname before enabling hostname URLs in the control plane. Test a generated app's declared route and actual stylesheet path rather than assuming `/assets/` or an invented SPA route.

Service-binding gateway checks cannot prove public DNS and Worker-route precedence. Public hostname identity and generated asset readiness are separate gates; a successful route-check alone does not prove that stylesheet MIME or browser-rendered SPA content is ready.

**Why:** The service binding bypasses public routing. An immediate generated-app acceptance failed content/MIME checks, while a later read-only probe through the same staged gateway and script returned correct CSS and distinct browser-rendered home/About content; the timing discrepancy was not resolved.

**How to apply:** Keep the public identity check fail-closed before committing hostname publish. In future acceptance work, verify rendered content and asset MIME with a bounded readiness window before declaring success; never substitute the internal service-binding response for the public-host result.

Do not treat the dispatch script-list `has_assets` flag as authoritative for static asset availability.

**Why:** A stock platform publish reported `has_assets: false` in script-list metadata while its dispatch script had an `ASSETS` binding, and the public lab hostname served the stylesheet with HTTP 200 and rendered the expected CSS.

**How to apply:** Resolve this discrepancy by checking the actual public asset response and computed browser styles through a TLS-valid hostname; report the metadata inconsistency without republishing or modifying a working app.