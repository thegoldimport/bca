---
name: SaaS custom-host routing
description: Safe gateway routing for Cloudflare for SaaS hostnames alongside BuildCustom-owned hosts.
---

Cloudflare for SaaS custom-host traffic reaches a Worker-as-origin through a zone-wide `*/*` Worker route, not the narrower `*.apps.buildcustom.ai/*` route used by managed project subdomains. The gateway must pass BuildCustom-owned hosts through to their existing origin, keep the managed-subdomain branch unchanged, and dispatch an external hostname only when a verified hostname-to-slug mapping exists.

**Why:** Cloudflare evaluates Worker routes before custom-origin resolution for Custom Hostnames. A narrow apps route does not cover customer domains, while a zone-wide route can intercept the main BuildCustom site if unmatched platform hosts return a gateway 404.

**How to apply:** Add the zone-wide route only after Cloudflare for SaaS and the fallback origin are enabled. For external hosts, resolve a verified KV alias to the stable project slug, then reuse the existing route record and dispatch namespace.