# Private launch foundation (in progress)

Cloudflare account: `03ef1e6e42498920987f07059e107538`. No BuildCustom public domain, route, marketing site, old product D1, or Replit deployment has been changed.

## Pinned build

- Stock `cloudflare/vibesdk`: `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`
- Stock `bun.lock` SHA-256: `b4920a63bd0c943d09951bccb3d2955fe0b7aced555cffdb2cdb24a37958e26f`
- Applied patch: `production/patches/task4b-immutable-runtime.patch`, SHA-256 `49e57d3e4ae4eaef5ad0a43a10d62b3421fdbab501a15bdd4d5f74dd31e6b91b`
- Dry-run Worker bundle SHA-256: `fc879ba5378e71b123c1c641d9de62b1e578b41a52c5d8533118d331da9af5e3`
- Immutable vector: `550e8400-e29b-41d4-a716-446655440000` + `e7520d4a88db2e5c794a1dbf8668a1236eab35f7` = `bc-r-27f06beab314dec1b904ee4675f28f90140f97dc0ceb9cab11c4ca69` (verified).
- Typecheck passed; tests: 510 passed, one skipped.

## New resources only

| Purpose | Name | ID |
| --- | --- | --- |
| Product D1 | `buildcustom-product-launch-db` | `ca820baf-6973-4318-ac52-529d56293bb6` |
| Runtime D1 | `buildcustom-vibesdk-launch-db` | `716c6600-8c60-408a-9446-3779979d5316` |
| Runtime KV | `buildcustom-vibesdk-launch-kv` | `80e8a38752dd4012875a189b05b6a148` |
| Template R2 bucket | `buildcustom-vibesdk-launch-templates` | bucket name |
| Dispatch namespace | `buildcustom-vibesdk-launch-dispatch` | `a73a11e6-f9fb-4331-8ba7-e8320b4804ff` |
| AI Gateway | `buildcustom-vibesdk-launch-ai` | gateway ID/name |
| Empty route KV | `buildcustom-app-routes-launch` | `248ac5b6821a475794a7fe3d2b0c3718` |
| Container application | `buildcustom-vibesdk-launch-userappsandboxservice` | `a03833f0-ec87-44db-a7f0-77076ca4888c` |
| CodeGenObject DO | `CodeGeneratorAgent` | `a9c65da411c946569c6d6939190cf03e` |
| Sandbox DO | `UserAppSandboxService` | `9a4a4f1f70314713b4e5ddfda7a69f03` |
| DORateLimitStore DO | `DORateLimitStore` | `d156c0b8d76148d8a3ab0d4622bf1bde` |
| UserSecretsStore DO | `UserSecretsStore` | `37c9221368634c12b04f74655e927e8e` |
| THINK_DO | `ThinkAgent` | `5d1e8716e75e4e1884458127f83c7f1c` |
| SPACE_DO | `SpaceDO` | `bd1438931f1e489b89439e66b385837e` |

Product D1 migrations 0001–0005 applied: 17 application tables, plus Cloudflare's internal `_cf_KV` and `d1_migrations`; users, projects, releases, claims all zero; foreign keys clean. Runtime D1 has nine stock migrations, zero users/apps, foreign keys clean. Route KV has zero keys.

Templates source: `cloudflare/vibesdk-templates` commit `7ea201fafdef44f5dcc5bc05f03b36e3198cebe5`; catalog SHA-256 `db6e3dc43aba7fc7556eb81f1aca32225ac0f6f5c0e983ba717a40661612b8bf`. The seven catalog entries are `c-code-react-runner`, `minimal-js`, `reveal-presentation-pro`, `vite-cf-DO-KV-runner`, `vite-cf-DO-runner`, `vite-cf-DO-v2-runner`, `vite-cfagents-runner`. Eight remote objects (catalog plus seven ZIPs) were read back byte-identical; all ZIPs passed integrity checks. The template generator's optional lockfile refresh for an **uncatalogued** Next.js definition was blocked by the package firewall; no pinned dependency was changed.

Worker `buildcustom-vibesdk-launch` was deployed with no BuildCustom public route, at the isolated canary `https://buildcustom-vibesdk-launch.thegoldimport.workers.dev`. Initial version `cd3a89b3-f8de-4ad8-b027-da85bb1c0ccc`; after adding a newly generated, never-displayed `JWT_SECRET`, active version `b60798fe-d668-4bfd-a62f-519ec84490d6` (100%). Health, frontend, and CSRF return HTTP 200. Gateway authentication is on, `byok_only` is false, provider-config count is zero, and no AI request has yet been made.

## Pending, not accepted

The existing Cloudflare integration can provision resources but cannot create new account tokens (API 9109). A **new** account-scoped AI Gateway Run token and a **new** Workers for Platforms deployment token are required; neither the existing Cloudflare provisioning token nor the lab Gateway token may be installed in the runtime. `CLOUDFLARE_ACCOUNT_ID` is present in the launch config but has not been redeployed yet. No disposable users, ThinkAgent, inference request, preview, or dispatch script has been created. Do not mark Task 6 accepted until the authorized generation and immutable deployment pass.