# Task 8 — app.buildcustom.ai cutover preparation

**Preparation only, September 26, 2026. No hostname, DNS, route, Worker, binding, database or public deployment change is authorized by this document. Commands marked FUTURE MUTATION must not be run during Task 8.** Task 6/6A/7 architecture and accepted Worker versions remain frozen.

## Read-only snapshot and ownership

| Resource | Observed state |
|---|---|
| Cloudflare account / zone | `03ef1e6e42498920987f07059e107538` / `56e85999af2d246ac01bfa9ccac5d805`, active `buildcustom.ai` zone |
| `app.buildcustom.ai` DNS | Cloudflare-managed, read-only proxied `AAAA 100::`, record `c2b16ea05b19ace1d200b82ea7352685`, `meta.origin_worker_id=cbe52cb7de7fb2b1c7d4207c5b4763fe4f973b8d`; no ordinary user-managed app CNAME |
| Worker custom domain | ID `cbe52cb7de7fb2b1c7d4207c5b4763fe4f973b8d`, service `vibesdk`, environment `production`, enabled, previews disabled |
| Certificate | Advanced pack `dc1f5e08-f2e6-4f20-814c-1d5aa64a04e7`, active, covers `buildcustom.ai` and `app.buildcustom.ai`; also active universal pack `1a33ec31-bfab-401c-9fe6-5a7ca4e42b31` covers apex and wildcard. Live SNI cert CN `buildcustom.ai`, SAN includes app host, issuer Google Trust Services WE1, valid Aug 7–Nov 5, 2026; TLS verification succeeds. Recheck validity on cutover day. |
| HTTP | `GET https://app.buildcustom.ai/` returned HTTP 500, no redirect, `text/plain`, body `An error occurred while loading this application.` `OPTIONS /api/auth/me` also 500. This matches the old Worker, not a healthy customer app. |
| Routes ahead of origin | Zone route `*/*` ID `86ded3299c9f41f78d66c8009e66f475` runs `buildcustom-apps-gateway`; deployed source passes all non-`.apps.buildcustom.ai` zone hosts through using `fetch(request)`, including app host. There is no app-specific route. |
| Dependencies | The broad gateway route remains in place. Reassigning the custom domain affects app-host traffic after the gateway pass-through; it does not reassign the apex, marketing Pages, or generated-app wildcard. |

The accepted *target* is `buildcustom-control-plane-launch`, version `8d8f0e80-48f6-48cd-ab7e-76a14777e0a6` at 100%. Its workers.dev `/`, `/app/signup`, `/app/login`, `/app` and unauthenticated `/api/auth/me` and `/api/auth/csrf-token` returned 200. Live bindings: `AUTH_RUNTIME` and `VIBESDK_RUNTIME` to `buildcustom-vibesdk-launch` (runtime version `699e38f7-4622-4932-a0a2-264e1f97d5a4`), `DB` to clean product D1 `ca820baf-6973-4318-ac52-529d56293bb6`, `STAGING_ROUTES` to clean KV `248ac5b6821a475794a7fe3d2b0c3718`, `STAGING_GATEWAY` to `buildcustom-apps-gateway-launch`, launch dispatch namespace `buildcustom-vibesdk-launch-dispatch`, profile `launch`. The `STAGING_*` variable names are historical adapter names; their **live targets are clean launch resources**, not staging. No Replit or lab service binding is present. No new app, inference or publish was used for this snapshot.

## Compatibility and pre-cutover gates

**The frozen accepted target version is not yet public-origin compatible. Do not attach the hostname to that version.** Its `CONTROL_PLANE_ALLOWED_ORIGIN` and `STAGING_ALLOWED_ORIGIN` both equal the workers.dev canary origin. All mutating product requests require exact Origin equality. A local read-only rehearsal proved an app-host POST is rejected with `ORIGIN_REJECTED`; supplying an exact `https://app.buildcustom.ai` allowed origin passes. Preview proxy URL construction, referer authorization and capability checks likewise use that configured origin; the local rehearsal generated an app-host preview URL when given the new origin.

Before a future reassignment, authorize and deploy a **new** control-plane version with the exact public origin configured and verified. This changes the deployed version and thus needs separate approval; preserve version `8d8f0e80-48f6-48cd-ab7e-76a14777e0a6` as rollback reference. Do not replace the internal runtime URL or service bindings with the app hostname. Browser fetches and WebSockets are same-origin/relative, and the service-binding chain remains `app host → control plane → AUTH_RUNTIME → frozen VibeSDK`. The owner-filtered runtime bridge continues to handle tickets, WebSocket, conversations, files, preview and publish; no browser credential is forwarded to a Replit, staging or lab backend.

Current registration is `STAGING_REGISTRATION_ENABLED=true`, and the launch environment assertion **requires** it to be true. To keep new customers away from the private generated-app URL, the future public-origin version must explicitly support registration disabled and deploy with it disabled; merely changing the variable to `false` currently fails environment validation. Keep login available only for prearranged test accounts. Do not create a second auth architecture or allow a wildcard origin. Public registration remains closed until the separate generated-app wildcard gateway cutover is accepted. Even with registration closed, logged-in test users can see the private workers.dev URL after Publish: use only known testers and do not present the app host as open for general use in this interval. No publish is needed in the initial hostname smoke test.

The new auth cookies are host-only because they have no `Domain` attribute: stock `accessToken` and `csrf-token` are forwarded only from the stock runtime, and preview uses a Secure, HttpOnly, SameSite=None, Partitioned path-scoped capability cookie. Old workers.dev acceptance cookies do **not** transfer to `app.buildcustom.ai`; a fresh login is required. Browser-host cookies cannot leak to `buildcustom.ai` or `*.apps.buildcustom.ai`. The legacy VibeSDK bundle contains names `accessToken`, `refreshToken`, `csrf-token` and `sessionId`; `accessToken`/`csrf-token` can collide on the app host. The new bridge ignores `refreshToken` and `sessionId`, and normal login should replace stock token cookies. Test a stale legacy cookie explicitly. Only if a collision is demonstrated, expire the affected cookie with its verified legacy host-only scope and exact Path; never clear a parent-domain cookie or all cookies indiscriminately.

CSRF token endpoint and header checks remain required. There is no permissive CORS policy or explicit CSP found in this launch Worker; the UI uses same-origin API/WS and a sandboxed same-origin preview. Review CSP/frame/connect restrictions on the future public version rather than adding permissive `*` CORS. GET routes lack a separate Origin gate, so ensure Cloudflare domain routing and owner checks remain correct. The preview iframe must remain opaque to the parent, yet load its scoped stylesheet and avoid product API access.

## Rehearsal completed without public mutations

- Read-only Cloudflare API snapshot established DNS/custom-domain/certificate/route/Worker identities above.
- A local configuration rehearsal confirmed: present launch configuration is valid; app-host POST is rejected by the accepted version; exact app allowed origin passes; preview URL changes to app origin with that exact setting; simply disabling registration fails the current launch guard.
- A local invocation of the **downloaded deployed public gateway module**, with KV and dispatcher made to throw on access, returned origin pass-through for `buildcustom.ai`, `www.buildcustom.ai`, `app.buildcustom.ai` and another non-apps zone host. It did not read routes or dispatch a tenant script. This verifies pass-through is independent of the two bindings being replaced later.
- Rehearse the passive browser smoke script against the unchanged private canary with `node scripts/task8-cutover-audit.mjs --rehearsal`; run it against the app hostname **only after** a separately approved cutover.

## Future app-host operation and rollback — NOT RUN IN TASK 8

**Preconditions for the next task:** public-origin-compatible control-plane version deployed and healthy; registration disabled; a verified stock-auth login for the **existing project owner** recovered or another already-linked project owner available with known credentials; exact current domain, DNS, certificate, routes, Worker versions and bindings re-snapshotted; private-gateway URL disclosure accepted for test accounts only; the operator has rollback permission. The Task 7 owner's password was discarded, so a fresh account with no project cannot satisfy the reopen/Files/preview checks. Stop if any item differs from this snapshot without explanation. Cloudflare's [Attach Worker Domain API](https://developers.cloudflare.com/api/resources/workers/subresources/domains/methods/update) documents `PUT /accounts/{account_id}/workers/domains` with `hostname`, `service`, `zone_id`. The API reference does **not** explicitly guarantee an in-place, zero-gap update of an already attached hostname; treat replacement/propagation as a risk. Do not delete the existing association or managed DNS as a speculative workaround if PUT rejects it.

```bash
# FUTURE MUTATION — execute only after separate cutover approval and preflight.
curl --fail-with-body -sS -X PUT \
  'https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538/workers/domains' \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"hostname":"app.buildcustom.ai","service":"buildcustom-control-plane-launch","zone_id":"56e85999af2d246ac01bfa9ccac5d805"}'
```

Immediately GET the domain list and domain ID; require exactly one app-host association with service `buildcustom-control-plane-launch`. Confirm the proxied managed DNS record and active certificate remain present; do not assume the original domain/certificate IDs persist. No intentional DNS update or certificate reissue is needed for an in-place service change, but the API may replace metadata or the edge may briefly serve old/new associations. Poll direct HTTPS and the association independently; a 200 frontend alone is not proof that API, JS, WebSocket or cookie flows work. Do not rely on a cached browser tab.

**Rollback trigger:** any mandatory post-cutover check below fails or the association enters a persistent conflict state. Reattach the **same hostname** to the old `vibesdk` service with the same `PUT` body changing only `service` to `vibesdk`; do not delete DNS, routes or certificate. This intentionally restores the old HTTP 500 behavior while Cloudflare/domain issues are diagnosed, not a usable app. GET the domain association to verify service `vibesdk`; require the managed proxied `AAAA 100::`, active cert and valid TLS, then verify the old HTTP response (currently 500). If the forward PUT failed without changing association, do not run rollback. If a PUT unexpectedly changes domain ID/cert or fails due to duplicate hostname, **stop and escalate the exact API error rather than deleting any resource**. A version-only failure after reassignment may instead be mitigated by deploying a corrected public-origin version, but that is not a substitute for the documented hostname rollback.

## Future post-cutover acceptance script (no AI generation)

Before this sequence, record both old and new Worker versions, domain ID, cert ID, DNS record ID and timestamp. Run the passive browser audit `node scripts/task8-cutover-audit.mjs` and the following **operator-driven** checks using an existing project owner with a known stock-auth login; keep credentials in the workspace secrets flow, never in this file or logs.

1. TLS handshake succeeds for `app.buildcustom.ai` with a valid SAN and unexpired certificate.
2. Fresh GET `/app/login` is BuildCustom HTML, not the legacy 500 body or a redirect to legacy.
3. Cloudflare domain API identifies the expected Worker, not `vibesdk`.
4. Browser loads same-origin JS and CSS, with no failed resource requests.
5. GET `/api/auth/csrf-token` works; an intentional bad/missing CSRF mutation is denied without side effects.
6. Confirm registration is disabled server-side; do not submit a valid signup that would create an account.
7. Login through the actual BuildCustom UI using the prearranged test account.
8. GET `/api/auth/me` reports that same stock identity; the bridge's `/api/auth/check` call remains internal to the runtime.
9. Dashboard loads only that user's projects.
10. Existing owner test project reopens with the same linked agent and revision.
11. Authoritative Files view loads the existing committed files.
12. Sandboxed preview renders existing marker and CSS; parent DOM/product API remain inaccessible.
13. Existing ThinkAgent WebSocket connects and reports idle without sending a prompt.
14. Existing conversation history loads, with no new turn.
15. Logout through the UI.
16. Replay the exact pre-logout cookie only as a test request: old session must not authenticate.
17. Fresh UI login works again.
18. Browser network shows zero requests to Replit services.
19. Browser network shows zero requests to staging/lab or legacy Worker URLs.
20. Neither requests nor deployed bindings use the old `VIBESDK_API_KEY` path. No generation or publish is part of this smoke test.

Stop and run the hostname rollback if any mandatory step fails. An existing project owner's credentials or a safe stock-auth recovery path must be arranged **before** the next task starts; the Task 7 acceptance passwords were intentionally discarded. A newly created auth-only user cannot access the Task 7 project. Do not make a new agent, inference call or release to create this account.

For the browser network audit, capture requests, responses, failed requests, WebSocket handshakes and iframe subresources from a fresh profile across steps 2–17. Flag `*.replit.com`, `*.replit.dev`, `*.replit.app`, any legacy `vibesdk` Worker URL, staging/lab Worker, old BuildCustom API origin and any direct runtime Worker request from the browser. Internal service-binding calls should not appear in browser traffic. Record method, host, path, initiator, status and whether cookies were sent, not credential/cookie values. Allow only the app origin and explicitly approved static/CDN origins; review every exception rather than adding a global wildcard.

## Following generated-app gateway cutover — also NOT RUN

The public gateway `buildcustom-apps-gateway` currently serves version `a7b8128e-356f-4354-8ae3-1dbe2ed9ed0e` at 100%, with `ROUTES` = legacy KV `d6e19823343e46d3965ad167775afb30` and `DISPATCHER` = legacy `buildcustom-vibesdk-staging`. Route `*.apps.buildcustom.ai/*` has ID `b868cb4091c448c99b225250a0ec8b8b`; the zone-wide pass-through route `*/*` has ID `86ded3299c9f41f78d66c8009e66f475`. Wildcard DNS is proxied A `192.0.2.1`, record `ba561c0c324b05ee79fc5f54c8b6dee3`. Do not change any of them during Task 8.

The clean replacements are `ROUTES` KV `248ac5b6821a475794a7fe3d2b0c3718` and `DISPATCHER` namespace `buildcustom-vibesdk-launch-dispatch`; accepted private gateway `buildcustom-apps-gateway-launch` serves version `26ac7a8c-695f-49d9-845a-8fe79ec2c28e`. Future gateway task: snapshot public source/version/settings, use the [Worker script/version settings PATCH API](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/script_and_version_settings/methods/edit) with a multipart `settings` JSON form part containing **both** bindings below, retaining all other settings; verify whether Cloudflare created and activated a new version; if not active, explicitly deploy the returned version after its source and binding inventory are confirmed. Verify the active settings and version, then test the clean slug through the wildcard hostname and pass-through on apex/app/unrelated zone hosts. Keep current public script/version and bindings as rollback references. Do not dual-dispatch disposable legacy apps. Do not assume the private `/p/<slug>/` route equals the public wildcard route until verified with the new bindings and source.

```bash
# FUTURE MUTATION — not authorized in Task 8. The PATCH may create a new version.
curl --fail-with-body -sS -X PATCH \
  'https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538/workers/scripts/buildcustom-apps-gateway/settings' \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'settings={"bindings":[{"type":"kv_namespace","name":"ROUTES","namespace_id":"248ac5b6821a475794a7fe3d2b0c3718"},{"type":"dispatch_namespace","name":"DISPATCHER","namespace":"buildcustom-vibesdk-launch-dispatch"}]}'
```

If the PATCH is rejected or changes any other setting/source, stop instead of uploading a guessed replacement. Reverse the two bindings to `ROUTES=d6e19823343e46d3965ad167775afb30`, `DISPATCHER=buildcustom-vibesdk-staging` through the same PATCH (or restore the recorded prior version/deployment) if gateway verification fails. Verify the active route IDs and marketing pass-through after either operation. The exact behavior of settings PATCH on the live deployment cannot be exercised without a public mutation, so its deployment/version semantics remain a future-task preflight gate.

The downloaded currently deployed public gateway source checks exact apex and all non-`.apps` zone subdomains **before** reading KV or dispatching; the local no-KV/no-dispatch rehearsal above proves this pass-through path. Changing only `ROUTES` and `DISPATCHER` therefore cannot by itself route marketing or app-host requests to a generated tenant. Cloudflare route precedence and downstream Pages/custom-domain origin must still be verified live after the later gateway change.

## Marketing waitlist, later task only

Marketing DNS apex and `www` are proxied CNAMEs to `bca-96p.pages.dev` (records `b07c8e34df84bbc068b145f7eec47e3d`, `b3ccb9c1b5dbcd44de8ebf1dd10ab597`). The currently served `buildcustom.ai` hashed JS sends **browser-side POST** to `https://ai-build-studio.replit.app/api/waitlist`, JSON `{name,email,source}`; it does not use a verified Pages Function or shared-gateway proxy for this request. Legacy Express validates that payload and returns 201 with a created row, 400 with validation details, or 500. Do not submit a waitlist form in Task 8. Later minimum replacement: keep marketing Pages, implement equivalent validated unauthenticated POST on the existing Cloudflare control plane and product D1, transfer/retain old waitlist records appropriately, restrict CORS to the marketing origins (or use a same-origin Pages proxy), then change only the marketing bundle's endpoint and verify it before turning off Replit. That is a separate migration, not part of either hostname reassignment.

## Remaining risks and acceptance boundary

**High:** the accepted version rejects public Origin; disabling registration fails its environment guard; public signup currently enabled; generated-app Publish URL is still private workers.dev; a known-credential **existing project owner** is not currently available; the Cloudflare API does not promise an atomic reassignment of an existing custom domain. Resolve these as explicit preconditions before any hostname change.

**Medium:** stale legacy `accessToken`/`csrf-token` may coexist on the new host; certificate/domain ID could rotate; broad `*/*` route means a routing regression can shadow Pages or the app; the public gateway source/version differs from the private candidate; the marketing waitlist still relies on Replit and must not be moved incidentally. Recheck live values before the next task because this document is a time-specific snapshot.

Task 8 authorizes documentation and local rehearsal only. It does **not** authorize app-host association PUT, registration changes, a new Worker version, wildcard gateway changes, marketing migration or public deployment changes.