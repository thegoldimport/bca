---
name: App hostname cutover
description: Product-exposure and evidence constraints for moving the accepted private app to its public hostname.
---

Do not open public registration on the app hostname until the separate public generated-app gateway cutover succeeds. Keep the app login-only for known testers during the interval, and treat a browser-facing origin change as a new control-plane version requiring verification rather than assuming a Worker custom-domain association alone is sufficient.

**Why:** The accepted private control plane is pinned to its workers.dev origin for mutating-request validation and preview URLs, while Publish still returns a private workers.dev generated-app URL. Exposing signup before both paths are ready would admit customers whose published sites have a private-looking address. The launch environment guard also currently rejects a registration-disabled setting, so disabling signup is not a one-variable operation.

**How to apply:** Before any hostname reassignment, verify an exact new allowed origin, preview scope, a disabled registration policy, and a known-credential owner account for smoke tests. Keep the accepted version as a rollback reference; do not weaken origin validation or add a second auth system.

Treat the current live marketing JavaScript, not just the repository source, as the authority for where waitlist submissions go. Confirm the Worker-domain association and certificate via live read-only API before attempting to reattach a hostname; Cloudflare's attach-domain API does not document a guaranteed zero-gap replacement of an existing association.

**Why:** The live hashed marketing bundle directly sends waitlist POSTs to the Replit autoscale host even though the corresponding repository component uses a relative URL. The existing app hostname is a Worker custom domain with a Cloudflare-managed read-only DNS record and active certificate, so changing DNS manually is both unnecessary and unsafe.

**How to apply:** Inspect the actual served JS and current domain/DNS/certificate IDs immediately before a future cutover. Attempt only the documented association operation under explicit approval; on conflict, stop rather than deleting the existing domain or managed DNS speculatively.