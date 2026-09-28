# Runtime cutover observation boundary

The failed Task 12D check made two independent requests after a successful
Cloudflare deployment POST:

1. `GET /accounts/{account}/workers/scripts/buildcustom-vibesdk-launch/deployments`
2. `GET https://buildcustom-vibesdk-launch.thegoldimport.workers.dev/api/auth/providers`

It then rejected the combined condition if the first response was not exactly
the candidate at 100%, **or** if `data.registrationEnabled` in the second
response was not `true`. Its failure output contained neither response.
Deployment history confirms the candidate had a 100% deployment, followed by
the accepted version's 100% rollback. It cannot establish what either
*immediate* GET returned. Classify both historical assertions as **UNKNOWN**,
not FAIL or PASS.

The registration path is `/api/auth/providers` on the runtime Worker, routed
to `AuthController.getAuthProviders`. It responds with
`isRegistrationEnabled(env) && isEmailAuthEnabled(env)`: the first function
reads `REGISTRATION_ENABLED`, the second reads `ENABLE_EMAIL_AUTH` (enabled
unless explicitly `"false"`). The product control gate uses
`STAGING_REGISTRATION_ENABLED`, a different binding. Both runtime versions
retain the same other bindings and the accepted code bytes; the candidate has
`REGISTRATION_ENABLED=true`, the accepted runtime has `false`. The direct
workers.dev URL addresses the intended runtime script, not the product
control-plane capabilities endpoint.

The provider response sets a CSRF cookie and `Vary: Origin`; the tested live
response had no `Cache-Control`, `Age`, or `CF-Cache-Status` header. This route
does not use the application's Cache API. The failed request used Node fetch,
not a browser or service binding. There is no evidence that a cache served a
stale result; these checks do not prove every Cloudflare edge is synchronous.

Cloudflare documents `Cloudflare-Workers-Version-Overrides` for versions **in
the current deployment only**. Version URLs are not generated for Workers
implementing Durable Objects, including Containers/Sandbox. Consequently
there is no supported version-specific invocation of this **inactive**
candidate without moving traffic. Once separately authorized and active, a
version override is a useful targeted request, but absent a version-metadata
binding or ScriptVersion log it is not an independent per-request identity
attestation.

## For a separately authorized cutover

The read-only observer is `scripts/task12g-runtime-cutover-probe.mjs`.
`node scripts/task12g-runtime-cutover-probe.mjs --phase=closed` is also the
rollback verification. After a separately authorized deployment, run
`--phase=candidate`. It records timestamp, observed value, expected value,
and PASS/FAIL on separate lines for:

- A: expected version 100% in deployment readback;
- B: other version absent (0%);
- C: configured registration flag and supported version-targeted capability
  request, with its identity limitation disclosed;
- D: ordinary live capability response, from a cache-busted `GET` with
  `Cache-Control: no-store`;
- E: existing-user product login and runtime `/api/auth/check` returning
  `authenticated:true`.

The observer contains **no deployment or binding mutation**. It uses the
existing tester login and creates a normal session; it prints neither
credentials nor cookies. A future operator must keep the accepted-version
rollback request ready and execute it separately on any failed required
observation. Then run `--phase=closed` to verify the accepted version at 100%,
candidate at 0%, live registration false, and existing-user authentication.

The Cloudflare deployment POST returns a deployment record; it is not itself
a live capability observation. Neither the inspected Cloudflare documentation
nor the earlier combined check establishes a specific propagation delay or a
safe convergence time. **Maximum assumed convergence window: zero seconds**:
make one immediate timestamped observation set, with no automatic retry or
traffic move in this probe. A future task may justify a short bounded
polling window only from separately captured evidence of delayed convergence;
it must not relabel an auth or application error as propagation. On any failed
required check in an authorized cutover, restore the exact accepted version
and keep the control registration gate closed.