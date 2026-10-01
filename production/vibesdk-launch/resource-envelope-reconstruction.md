# Canonical resource-envelope candidate

This is the current ten-patch recipe. It supersedes the older eight-patch
examples in `manifest.md`; those remain historical evidence.

## Permanent inputs

- Canonical BuildCustom repository: `thegoldimport/bca`, branch `main`.
- Upstream: `https://github.com/cloudflare/vibesdk`,
  commit `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`.
- Complete ordered patches and their SHA-256 values:
  `resource-envelope-source-parity.json` → `reconstruction.acceptedPatchChain`
  followed by `releasePatch`. The sequence is:
  1. `task4b-immutable-runtime.patch`
  2. `task6a-logout-revocation.patch`
  3. `task8d-registration-gate.patch`
  4. `task9-password-recovery.patch`
  5. `preview-capability-validation.patch`
  6. `continuous-coding-lifecycle.patch`
  7. `accepted-auth-source-provenance.patch`
  8. `continuous-coding-type-provenance.patch`
  9. `continuous-coding-observability.patch`
  10. `resource-envelope-terminal-state.patch`
- Frozen upstream `bun.lock` SHA-256:
  `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`.
- Exact accepted 860-file source hashes:
  `resource-envelope-validation.json` → `sourceHashes`, runtime-source prefix.
- Launch variables/bindings: committed `production/vibesdk-launch/wrangler.jsonc`.
- Control source: committed `cloudflare/`, `client/`, `server/`, `shared/`,
  root package/lock and production control Wrangler configuration.

## Fresh source reconstruction

From a checkout of the canonical committed BuildCustom source:

```sh
node scripts/reconstruct-resource-runtime.mjs /tmp/resource-runtime-canonical
```

The script verifies the pinned archive, all ten patch hashes and clean
application, all 860 file hashes, exact source path set and frozen lockfile.
It does not use the ignored runtime checkout or install dependencies.
An existing target directory or source mismatch stops reconstruction.

Install the frozen runtime dependencies in the new directory, then run
`bun run build`. Keep the stock canonical `wrangler.jsonc` while building:
overwriting it would change a validated source hash. The Vite output is
`dist/vibesdk_production/`. Build control from the canonical root with its
frozen npm lock and `PUBLIC_APP_URL=https://app.buildcustom.ai npm run build`.
This explicit input preserves the accepted social-image metadata instead of
embedding the ambient Replit development hostname. Do not borrow workspace-package symlinks
from an unrelated checkout.

Create disposable dry-run configurations outside the canonical source,
pointing at the compiled runtime entry and the committed control entry.
Use the committed launch metadata and `no_bundle` for the already compiled
runtime. Set `find_additional_modules=true` and an ESModule rule for
`**/*.js` to collect every compiled split chunk; resolve the container
Dockerfile and asset directory to absolute paths in the fresh reconstruction.
Do not upload with those disposable configurations. Recreate both
Worker dry-run directories named by the release validator, plus the exact
control public asset manifest.

Before release, verify that the reconstructed runtime and control executable
sources equal the already-tested hashes. Update release-validation artifact
manifests only with fresh build/dry-run evidence; retain the prior test results
and distinguish release-operator changes from application changes.

## One release audit and guarded activation

`scripts/resource-envelope-module-audit.mjs` compares the complete old/new
module graphs. WASM and bundler runtime must be byte-identical; auxiliary JS
must have identical executable ASTs after narrowly matching corresponding
hashed imports and excluding comments/locations. Main export pairs must match.
Main implementation changes are constrained by the exact source identity.

After canonical source is pushed and reconstructed:

```sh
node scripts/resource-envelope-release.mjs audit
node scripts/resource-envelope-release.mjs reconcile-no-upload
node scripts/resource-envelope-release.mjs stage
node scripts/resource-envelope-release.mjs activate
```

Each command is a separate gate. Never proceed after a failure. Reconciliation
is allowed once only for the prior failed preflight with empty targets and
unchanged serving/latest versions; it archives that evidence. Reserved or
uploaded targets must be investigated, never blindly retried.

The audit is GET-only. Stage creates inactive runtime/control candidates;
complete binding, runtime/container/assets configuration and exact uploaded
module bytes must match before activation. Native assets and all secrets are
inherited without exposing values. Only the production credit variable changes
to `250`; continuations stay `4`, elapsed stays `900000`, native maxSteps stays
`25`, and five total turns remain. Other-environment credit fallback remains
`100`. Already-started operations are not rewritten.

Rollback versions: runtime `f4488693-4424-46a3-9834-30b214645449`;
control `363353cd-76d3-4eb1-9df0-5bdd9a859083`. Gateways and generated-app
production routing are not release targets.

Normal-login Project 8 smoke must use the same owner/agent and revision
`020de27f52eb0273554e1004cb12eb9f2977aa7a`. A replacement browser after restart
is a fresh authenticated session, not the lost original session. No new
customer/agent/project, AI instruction, resend, note/lead write or generated-app
Publish is authorized. Verify the existing preview, 12 seeded leads, details,
note, timeline, API and empty releases using read-only interactions, then stop.