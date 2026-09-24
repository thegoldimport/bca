# Isolated staging ThinkAgent billing migration

This runbook applies **only** to Cloudflare Worker `buildcustom-vibesdk-migration-staging` in the isolated staging account. Do not use the candidate `vibesdk-candidate/wrangler.staging.jsonc` to deploy it: that file targets a different Worker and different D1, KV, dispatch, and R2 resources.

## Rollback baseline, captured before routing changes

- Currently serving deployment: `e47de8be-3060-4c35-8161-6da1db1fee1b`, created 2026-09-20 20:41:27 UTC.
- Serving version: `e8a7042e-8b17-4d6b-ac1a-f02e77c3511f`, 100% traffic, version number 5.
- Compatibility date and flags: `2026-05-23`, `nodejs_compat`.
- Current native Think model: Google AI Studio `gemini-3.6-flash` via `directOverride: true` and the isolated Worker's Google key. No `CLOUDFLARE_AI_GATEWAY` binding was present at baseline.
- The deployed bundle is not byte-identical to the candidate checkout. The candidate's frozen restore/synchronization markers were not found in the current deployed bundle. Do not rebuild the old version from the candidate as a rollback.

To roll back, redeploy the exact captured Cloudflare **version** above to 100% of this named Worker after checking its resource bindings. Do not touch the separately named protected Worker or the BuildCustom control plane. Do not delete credentials as part of this migration.

## Supported target

Cloudflare's model catalog explicitly lists [`google/gemini-3.6-flash`](https://developers.cloudflare.com/ai/models/google/gemini-3.6-flash/) as a third-party model with a Chat Completions request format. Its [REST API](https://developers.cloudflare.com/ai-gateway/usage/rest-api/) supports OpenAI-compatible `POST /client/v4/accounts/{account_id}/ai/v1/chat/completions`, with `model: google/gemini-3.6-flash`. The REST endpoint uses a Cloudflare token with **Account → Workers AI → Read**, not just AI Gateway Run. A `cf-aig-gateway-id` header can select a dedicated isolated staging gateway. No Google provider Authorization or gateway-stored Google BYOK credential should be used; Cloudflare documents third-party REST requests as Unified Billing. The AI binding is not used by this OpenAI-compatible transport.

If the isolated Worker's existing Cloudflare token lacks Workers AI Read, stop on the resulting authorization error. Never copy a protected production token or inspect/log token values to work around it.

## Controlled staging result (2026-09-24)

- Dedicated gateway: `buildcustom-think-unified-staging` in the isolated account, with logging enabled, `byok_only: false`, and zero stored provider configurations. The account credit balance was zero before and after the probe; no credits were purchased.
- A binary-preserving, module-format upload created version `0815f983-7730-41ee-a497-c24d8d93e172` from the **actual serving bundle**, not the differing candidate checkout. Seven original modules were preserved, including the WASM asset. Cloudflare confirmed that all 30 previous bindings retained their names and types; only the two plain-text staging settings `BUILDCUSTOM_UNIFIED_BILLING=true` and `CLOUDFLARE_AI_GATEWAY=buildcustom-think-unified-staging` were added. Compatibility date, `nodejs_compat`, and migration tag `v1` remained unchanged.
- The new version was deployed at 100% in deployment `699a3675-0a80-4a77-8ffe-9b6e18446ecc`. The previous exact version above remains available for rollback. The enabled branch returns before any Google key resolver or `directOverride` path can run; it uses the Cloudflare REST token and the dedicated gateway ID, with no Google provider authorization or stored provider key.
- **Exactly one native build request** was made via the isolated control plane. It returned HTTP `502` after approximately 8.7 seconds, with control-plane `cf-ray` `a4035ce1fc6ce592-ATL`. The disposable project and user/session rows were deleted; route/preview KV cleanup passed. No edit, preview, publish, or second generation followed.
- The dedicated AI Gateway recorded request `707e47a25d3831a3312332ba73379868f43e8d0c990c80b40a716f2579531b3a` at `2026-09-24T17:03:38.671Z`, provider `google-vertex-ai`, model `google/gemini-3.6-flash`, HTTP `403`, `success: false`, `wholesale: false`, `byok: null`, zero input/output tokens, and zero cost. Its error body was not exposed in the safe gateway log. This **does not prove** Unified Billing or that insufficient credits caused the failure. Do not purchase credits or run another inference attempt on the assumption that funding alone will solve it. Investigate the isolated runtime token's Workers AI Read permission and the precise Cloudflare rejection without accessing or printing the credential; if that is valid, investigate the REST/gateway configuration. A missing permission must be fixed by the credential owner, not by copying another environment's token.
- Candidate tests could not start because its borrowed `node_modules` lacks Vitest/Workers test-pool packages. Candidate typecheck and Wrangler dry-run were blocked by missing dependencies, so they are not claimed as passing. Targeted Node assertions for the route helper, syntax checking of the patched deployed module, multipart asset preservation checks, binding parity, and live version verification passed. No frozen restore/synchronization code was changed in the deployed bundle.