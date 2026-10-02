# App-backed published routing and immutable artifact identity

Publisher artifact version: `app-routing-v2`.

## Routing contract

The existing Think publish adapter emits the entry for both managed dispatch
and external user-account publication. App-backed releases force the ASSETS
binding's `not_found_handling` to `none`, while keeping Worker-first execution.
This makes asset hits distinguishable from misses.

GET/HEAD requests first check actual static assets. An asset miss goes to the
App Durable Object using the unchanged Request. Other methods go directly to
App, without calling ASSETS. Only an App 404 for GET/HEAD with an HTML Accept
may use the root index fallback, and only when the application requested SPA
fallback. API prefixes play no role. Non-navigation backend 404s remain 404s.
Static-only applications keep their original binding-level fallback.

## Identity

The new managed immutable script name is:

```
bc-r- + first 56 lowercase hex characters of SHA-256(UTF-8(
  lowercase(agent UUID) + ":" + lowercase(full generated Git commit) +
  ":" + publisher artifact version
))
```

The current explicit version is `app-routing-v2`. It must change whenever
publisher routing or packaging semantics change. It is not a timestamp,
random identifier, title or customer-supplied input.

Control and runtime use the same version and reject a runtime capability
that advertises a different or missing publisher version before sending
deployment. Existing historical release rows and script names remain as-is.
The versioned script name distinguishes a rebuilt same-source artifact from
legacy source-only identities without any database migration.

An exact artifact retry resolves the existing published record and verifies
it rather than uploading. New candidates retain the existing existence guard,
no-unsafe-PUT-retry policy, per-agent lock, owner checks, source verification
and last-known-good route-switch ordering.

## Reproducible source

From the committed BuildCustom checkout:

```
node scripts/reconstruct-publisher-runtime.mjs /tmp/publisher-runtime-fresh
```

This verifies and reconstructs the accepted ten-patch runtime baseline, then
applies the publisher patch and validates the entire exact source-path/hash
set. It does not use the ignored runtime checkout, install dependencies, or
deploy anything. Build with the pinned dependencies and stock runtime config;
use the committed launch config only for the final Worker deployment metadata.

The control change is tracked normally in `cloudflare/staging/native-publish.ts`.
Required serving components are the runtime publisher and the control-plane
identity/capability guard. Generated-app gateways, auth, lifecycle limits and
generated customer files are not part of this change.