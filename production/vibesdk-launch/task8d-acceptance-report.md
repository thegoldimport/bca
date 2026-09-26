# Task 8D private acceptance status

**Status:** Registration-only gate deployed and its closed state verified privately. Task 8D + remaining Task 8C acceptance is **NOT ACCEPTED** because normal-user login and the tester project cannot yet be exercised.

## Reproducible production patch

- Upstream stock VibeSDK commit: `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`; stock lockfile SHA-256 `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`.
- Apply unchanged `production/patches/task4b-immutable-runtime.patch`, then unchanged `production/patches/task6a-logout-revocation.patch`, then `production/patches/task8d-registration-gate.patch`. The third patch is normalized to repo-relative paths, applies cleanly to a fresh two-patch baseline, and passes `git diff --check`.
- Task 8D patch SHA-256: `c71153f96265fc3f1cc433dfe0d21f7092d4abce491d5d5200f7fd37ff6c72cc`.
- Runtime Worker dry-run bundle SHA-256: `fe0a4f18d3747be1f37c15911a561077b8b4d3681553ee6f43bcb7740259ba02`.
- Changed files: runtime `worker/utils/envs.ts`, `worker/types/env.d.ts`, `worker/api/controllers/auth/controller.ts`, `worker/database/services/AuthService.ts`, `src/api-types.ts`, `src/contexts/auth-context.tsx`, `src/components/auth/login-modal.tsx`; focused tests in `worker/utils/envs.test.ts`, `worker/api/controllers/auth/controller.test.ts`, and `worker/database/services/AuthService.test.ts`. Launch-only config: `production/vibesdk-launch/wrangler.jsonc`.
- Changed functions: registration capability lookup, email-registration controller and service, new OAuth-user insertion path, auth-provider capability response, frontend auth-provider mapping, and login modal signup state. Task 6A logout code and Task 4B immutable deployment code were not changed.

## User-creation paths and behavior

`AuthController.register` invokes `AuthService.register` for email registration. New-user OAuth callback processing can invoke `AuthService.createOAuthUser`; its insert is also gated. Existing linked OAuth identity login and verified same-email existing-user linkage remain available. Authenticated OAuth account linking does not create a new user. API-key exchange resolves an existing user rather than inserting one. No other runtime user insertion path was identified in the pinned source.

`REGISTRATION_ENABLED=false` causes direct email registration to return HTTP 403 with `REGISTRATION_DISABLED` in the error payload and prevents new OAuth-user insertion. It does not change `ENABLE_EMAIL_AUTH`; provider discovery continues to report email login available. The runtime signup modal hides registration when capability is false and fails closed until capability is loaded. `REGISTRATION_ENABLED=true` retains normal stock signup.

## Verification and limits

- Typecheck, focused registration and logout tests, full runtime suite (525 passed, one skipped), and build passed. Task 6A old-session/other-session regression tests passed. The Task 4B immutable script-name vector remained `bc-r-27f06beab314dec1b904ee4675f28f90140f97dc0ceb9cab11c4ca69`.
- Only `buildcustom-vibesdk-launch` was deployed: Worker version `6ff58ba1-83f5-4951-a3b6-022160ea61c5`, serving 100%. Live provider discovery returned `email=true`, `registrationEnabled=false`; direct runtime registration returned HTTP 403 `REGISTRATION_DISABLED`. The BuildCustom control-plane version remained `82515081-9c15-4669-9e59-8ffa916331ec`, with registration and public generated apps both disabled.
- A temporary bootstrap Worker bound only to localhost used the normal registration code path with registration enabled and remote launch D1. Its **single** registration request failed HTTP 500 on a D1 read. A separate local read-only Worker probe of the same remote D1 binding returned a Cloudflare internal error, while Wrangler's remote D1 CLI could read the database. The bootstrap was stopped. Remote D1 confirmed zero accounts for the intended tester email afterward; no repeat registration was sent.
- A tester password was supplied through Replit Secrets, not printed or written into project source. No tester user, project, generation, release, or authenticated acceptance test resulted. Existing-user login, live logout revocation, authenticated browser/network audit, and development-off testing remain unverified after this deployment.
- `app.buildcustom.ai` remains attached to legacy `vibesdk`; `*.apps.buildcustom.ai/*` still routes to `buildcustom-apps-gateway`. No public hostname, marketing page, Replit public deployment, public gateway, or legacy Worker was modified.

**Next implementation task:** Establish and prove a strictly private, single-operation normal registration bootstrap against the launch runtime D1 without opening any public signup route. After the account exists and both registration gates are confirmed closed, complete all remaining Task 8C authenticated checks. Do not freeze a cutover candidate or reassign a public hostname before those pass.