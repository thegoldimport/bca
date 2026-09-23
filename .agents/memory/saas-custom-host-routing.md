---
name: SaaS custom-host routing
description: Safe gateway routing for Cloudflare for SaaS hostnames alongside BuildCustom-owned hosts.
---

Cloudflare for SaaS custom-host traffic reaches a Worker-as-origin through a zone-wide `*/*` Worker route, not the narrower `*.apps.buildcustom.ai/*` route used by managed project subdomains. The gateway must pass BuildCustom-owned hosts through to their existing origin, keep the managed-subdomain branch unchanged, and dispatch an external hostname only when a verified hostname-to-slug mapping exists.

**Why:** Cloudflare evaluates Worker routes before custom-origin resolution for Custom Hostnames. A narrow apps route does not cover customer domains, while a zone-wide route can intercept the main BuildCustom site if unmatched platform hosts return a gateway 404.

**How to apply:** Add the zone-wide route only after Cloudflare for SaaS and the fallback origin are enabled. For external hosts, resolve a verified KV alias to the stable project slug, then reuse the existing route record and dispatch namespace.

Test A (BuildCustom-owned staging subdomains) and Test B (external customer domains) have different isolation requirements. A zone-scoped SSL/Certificates Write token is not scoped to a custom-hostname prefix; on a SaaS zone that already hosts production custom domains, it could mutate those hosts. Also, external SaaS hosts hit that zone's existing `*/*` Worker route before origin resolution, which may point to the protected production gateway.

**Why:** A staging-specific wildcard route in the same zone can isolate BuildCustom-owned subdomains, but it cannot safely exercise external Custom Hostnames API mutations or redirect arbitrary external hosts without broadening authority over production records.

**How to apply:** Keep external-domain mutation disabled until there is an independently controlled staging SaaS zone and token scoped to that zone, or the owner explicitly approves a different credential/routing boundary. Do not count a same-zone staging subdomain as a customer-owned external domain.