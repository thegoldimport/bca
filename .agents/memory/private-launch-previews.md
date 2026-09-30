---
name: Private launch previews
description: Browser and Worker routing constraints for previewing frozen-runtime projects in the private control plane.
---

For a frozen runtime, keep untrusted generated pages in an opaque-origin sandbox with scripts allowed but same-origin access denied. A control-plane preview proxy must constrain upstream requests to the exact runtime preview path, reject redirects and credentials, and authorize assets with the runtime's short-lived preview-only capability rather than relying solely on a cookie. Keep owner-gated status and preview creation separate from capability-gated asset retrieval.

**Why:** In Chromium, the sandboxed preview HTML loaded with a partitioned cookie, but its stylesheet request omitted that cookie because the subresource had a different cross-site-ancestor partition. The asset returned 401 and was blocked by opaque response blocking. The static-assets SPA fallback also served the dashboard HTML at a preview path until Worker-first routing was enabled. A 200 HTML preview alone masked both defects.

**How to apply:** Test the actual iframe's HTML, stylesheet response and computed style in a browser, and confirm the sandbox cannot read the parent document or product API. Keep asset capabilities scoped to the linked agent and branch, short-lived, and unavailable on root preview or product routes; use a no-referrer policy to avoid leaking them. When a Worker owns both static assets and private dynamic paths, ensure asset fallback cannot intercept those dynamic paths.

For production acceptance, fetch the owner-gated project status **inside the same authenticated browser context** before requesting its private preview URL there. A status response obtained separately by a Node HTTP client can supply an identical preview URL yet a browser fetch of it returns 401; browser status followed by browser preview succeeds.

**Why:** A development-off smoke test initially reported preview failure despite both users' editors and WebSockets working. The only changed step in a focused comparison was obtaining project status in the browser before the preview request, after which the preview returned 200. The URL string alone did not carry all necessary request context.

**How to apply:** In browser acceptance, let the browser acquire project status and immediately fetch the resulting preview URL using its own credentials; do not transplant a URL minted by a separate HTTP client into the browser and treat a 401 as a product regression.

Opaque sandbox previews can successfully load JavaScript and render an app while its generated data requests still fail. Treat a generated “database connection” error as a symptom, not proof of a database outage: inspect each scoped API request's capability, response status, and browser CORS result separately.

**Why:** A browser trace showed a metrics request returning 200 JSON but being hidden by a missing opaque-origin allow header; a leads request built with additional query parameters lacked the preview capability and returned 401. Both appeared to the generated app as network failure despite a working JavaScript preview.

**How to apply:** Before changing the generated app or its database, inspect the iframe's actual requests in Chromium, including `Origin`, token presence (not its value), response status, and CORS error. Preserve opaque sandbox and owner/capability isolation rather than broadly enabling credentialed CORS.

Read-only preview success does not prove a generated data app is fully usable. A JSON mutation from the opaque iframe needs a CORS preflight; a preview proxy that accepts only GET can show real metrics and rows while its create/update actions remain blocked.

**Why:** A CRM's metrics and filtered leads became browser-readable, yet a non-mutating preflight for its existing Add Lead request returned 405 without CORS headers. Testing only dashboard data would have incorrectly classified the preview as ready.

**How to apply:** Before calling a generated CRUD preview fully usable, check its actual API methods and perform a safe preflight probe for at least one JSON mutation. Do not create test records merely to establish that method/CORS routing is blocked.