---
name: App hostname cutover
description: Product-exposure and evidence constraints for moving the accepted private app to its public hostname.
---

Do not open public registration on the app hostname until the separate public generated-app gateway cutover succeeds. Keep the app login-only for known testers during the interval, and verify the canonical public Origin and preview scope rather than assuming a Worker custom-domain association alone is sufficient.

**Why:** The launch control plane has a canonical public Origin and a separate private canary Origin, and previews are request-origin scoped. Generated-app URLs remain private while the public gateway is disabled. Exposing signup before both paths are ready would admit customers whose published sites do not have a usable public address.

**How to apply:** Before any hostname reassignment, verify the live canonical allowed Origin, preview scope, disabled registration policy, and a known-credential owner account for smoke tests. Keep the accepted version as a rollback reference; do not weaken origin validation or add a second auth system.

Treat the current live marketing JavaScript, not just the repository source, as the authority for where waitlist submissions go. Confirm the Worker-domain association and certificate via live read-only API before attempting to reattach a hostname; Cloudflare's attach-domain API does not document a guaranteed zero-gap replacement of an existing association.

**Why:** The live hashed marketing bundle directly sends waitlist POSTs to the Replit autoscale host even though the corresponding repository component uses a relative URL. The existing app hostname is a Worker custom domain with a Cloudflare-managed read-only DNS record and active certificate, so changing DNS manually is both unnecessary and unsafe.

**How to apply:** Inspect the actual served JS and current domain/DNS/certificate IDs immediately before a future cutover. Attempt only the documented association operation under explicit approval; on conflict, stop rather than deleting the existing domain or managed DNS speculatively.

The ordinary Attach Worker Domain request can reject an already-associated app hostname. Cloudflare's supported Wrangler takeover flow first previews a script-scoped Custom Domain changeset, then explicitly overrides the existing Worker origin for that hostname. Keep DNS-record override disabled when the preview reports no DNS conflict; never assume an override preserves record or certificate IDs.

**Why:** A generic attach returned a conflict even though the domain was healthy. The supported changeset identified an update of the existing Worker Custom Domain, not a delete/recreate or an external DNS conflict. Using that path allowed a one-hostname takeover while managed DNS, certificate, and unrelated routing stayed unchanged.

**How to apply:** For future Worker Custom Domain reassociations, inspect the live changeset and all domains on both scripts before mutation, preconstruct the symmetric reverse override toward the old Worker, and snapshot DNS/TLS. Never delete the old domain speculatively. After any successful response, verify actual association, TLS, managed DNS, unaffected routes, and browser behavior before accepting the cutover.