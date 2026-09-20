# BuildCustom Replit to Cloudflare Control-Plane Migration Audit

**Status:** Read-only migration design  
**Audit date:** September 20, 2026  
**Audited source commit:** `9c83b521a0524450662f533412d110df9a23eabb` on local `main`  
**Primary acceptance criterion:** BuildCustom and existing customer applications continue operating indefinitely after the Replit production deployment, Replit Postgres access, and Replit production secrets are disabled.

## Evidence and safety boundary

This document is based on:

- The current repository and runtime configuration.
- Read-only queries against the Replit development and production databases.
- Read-only Cloudflare account inventory.
- Current Git remotes and branch state.
- Existing automated tests and implementation behavior.

The database and Cloudflare inventories were captured on September 20, 2026 between 17:15 and 17:21 UTC. Inspected environments were the Replit development and production database connections and the Cloudflare account owning the active `buildcustom.ai` and `buyermagnets.com` zones. Account/resource identifiers are evidence, not secrets, but this document generally uses stable resource names instead of repeating IDs.

Audit limitations:

- Cloudflare Pages project settings, Containers, Workflows, Queues, and account audit logs were not independently enumerated.
- Cloudflare D1 metadata reported zero user tables for the two VibeSDK databases even though their Worker bindings are active; no D1 data query was made because those databases are protected VibeSDK state.
- Production traffic logs, branch-protection settings, and external systems not represented in this repository were not available.
- The observed Replit production database is empty and materially older than the development schema, so the authoritative production data source remains an explicit owner gate.

No Cloudflare resource, DNS record, database row, secret, runtime, custom hostname, generated application, or deployment was changed during this audit.

Labels used below:

- **Confirmed:** directly observed in source, database metadata, Git, or Cloudflare.
- **Decision:** recommended target design.
- **Gate:** an owner or implementation decision required before proceeding.
- **Unknown:** evidence was insufficient; preserve the resource or behavior until investigated.

---

## 1. Executive summary

### Current architecture

**Confirmed:** BuildCustom itself is a single long-lived Node/Express application. It serves the Vite-built React application and the API from one process (`server/index.ts`, `server/static.ts`, `script/build.ts`). Replit currently supplies:

- Production process hosting and port/runtime conventions through `.replit`.
- The production `DATABASE_URL`.
- Production secret/environment storage.
- The deployment lifecycle for the Express process and built frontend.

The control-plane database uses PostgreSQL through `pg` and Drizzle (`server/db.ts`, `server/storage.ts`, `shared/schema.ts`). Startup mutates the PostgreSQL schema through `ensureRuntimeSchema()` (`server/runtime-schema.ts`).

The BuildCustom API calls the existing Cloudflare VibeSDK runtime through `@cf-vibesdk/sdk` (`server/runtime-adapter.ts`). VibeSDK/ThinkAgent, SpaceDO, Cloudflare Artifacts/workspaces, previews, and Workers for Platforms are already on Cloudflare. Published applications are routed through:

1. ThinkAgent deployment to a Workers for Platforms user Worker.
2. A BuildCustom route record in Cloudflare KV.
3. `buildcustom-apps-gateway`.
4. The `buildcustom-vibesdk-staging` dispatch namespace.
5. `*.apps.buildcustom.ai` or an active Cloudflare for SaaS hostname.

### Target architecture

**Decision:** Move only the BuildCustom control plane to Cloudflare:

- One Cloudflare Worker for the authenticated API and static application assets.
- D1 for BuildCustom relational control-plane data.
- One Durable Object namespace for per-project operation serialization plus Cloudflare Workflows for durable long-running execution.
- Existing VibeSDK/ThinkAgent, SpaceDO, Artifacts, staging dispatch namespace, generated app Workers, gateway, KV route map, hosted subdomains, and Cloudflare for SaaS custom hostnames remain unchanged.
- Cloudflare Worker secrets replace Replit production secrets.
- GitHub becomes the enforced canonical source, with CI, isolated staging, approval, and production deployment.

Do not introduce a second AI agent. The target call chain remains:

`BuildCustom UI -> authenticated BuildCustom API -> VibeSDK adapter/platform actions -> ThinkAgent + SpaceDO`

### Major migration risks

1. **Authentication is not production-safe.** The browser supplies `x-user-id` from localStorage, and the API trusts it after only checking that the user exists. Admin routes have no durable server session and some are unprotected.
2. **Production database drift.** The read-only production database currently contains only empty `users` and `waitlist_entries` tables. The development database has the full 12-table control-plane model and the live project/domain/runtime records observed during development.
3. **PostgreSQL-specific coordination.** Custom-domain operations use PostgreSQL advisory locks. Several operations rely on transactions, partial unique indexes, `jsonb`, arrays, serial IDs, and PostgreSQL startup DDL.
4. **Process-memory runtime state.** VibeSDK sessions and per-project operation queues are in process-level `Map` objects. Agent operations can run for three to five minutes, longer than a simple request/response migration should assume.
5. **Protected Cloudflare systems are already live.** The gateway has broad zone routing, three active SaaS custom hostnames, and live route metadata. A control-plane error must not modify, replace, or orphan them.
6. **GitHub is not yet operationally canonical.** `main` is 84 commits ahead of `origin/main`; no GitHub Actions workflows are present.
7. **Observability is incomplete.** Express logs can include full JSON response bodies, while gateway Workers have no persisted logging enabled in the observed inventory.

### Recommendation

Proceed incrementally. First establish GitHub source control and isolated Cloudflare staging. Then port the API and assets, implement server-validated sessions and Durable Object coordination, migrate a verified database snapshot during a short maintenance window, run shadow/read-only verification, cut over `app.buildcustom.ai`, and only then perform the Replit shutdown test. Do not use dual-write at the current data volume unless a later production inventory proves materially larger or requires zero downtime.

---

## 2. Current Replit dependency inventory

| Area | Current dependency | Exact location | Cloudflare target |
|---|---|---|---|
| Process hosting | Long-lived Node/Express process; `PORT`, `0.0.0.0`, one exposed port | `.replit`, `server/index.ts` | Cloudflare Worker |
| Frontend hosting | Express serves built static files in production | `server/index.ts`, `server/static.ts`, `script/build.ts` | Worker Static Assets |
| Development UI | Replit-specific Vite plugins and accepted Replit CORS origins | `vite.config.ts`, `server/index.ts`, `package.json` | Keep plugins development-only; remove Replit production origins |
| Database | `DATABASE_URL` is mandatory at module load; PostgreSQL pool | `server/db.ts`, `drizzle.config.ts` | D1 binding |
| ORM/schema | Drizzle PostgreSQL schema and Postgres dialect | `shared/schema.ts`, `server/storage.ts` | Drizzle SQLite/D1 schema or direct prepared D1 statements |
| Startup migrations | Runtime executes PostgreSQL DDL every boot | `server/runtime-schema.ts` | Versioned D1 migrations applied before deployment |
| Identity | Browser-local user object supplies `x-user-id` | `client/src/lib/auth.ts`, `client/src/lib/queryClient.ts`, `server/routes.ts` | Server-issued HttpOnly session cookie |
| Password auth | bcrypt hashes stored in PostgreSQL | `server/routes.ts`, `shared/schema.ts` | Preserve hashes initially; validate in Worker-compatible code or complete a controlled rehash |
| Admin auth | Environment credential comparison and browser localStorage flag; default password fallback exists | `server/routes.ts`, `client/src/pages/login.tsx`, `client/src/pages/admin.tsx` | Normal authenticated user/session plus database role checks; no fallback credential |
| Runtime sessions | `BuildSession` objects cached in process memory | `server/runtime-adapter.ts` | Durable Object coordination; reconnect to VibeSDK by persisted `agent_id` |
| Operation serialization | Per-project Promise queues in a process `Map` | `server/runtime-adapter.ts` | Per-project Durable Object |
| Long requests | Plan up to 180 seconds; generation up to 300 seconds; deploy up to 240 seconds | `server/runtime-adapter.ts` | Cloudflare Workflow with per-project Durable Object serialization and async status polling |
| Runtime key | API key derived from `SESSION_SECRET` | `server/runtime-adapter.ts` | Dedicated Worker secret, preserving current derivation during compatibility phase |
| Custom-domain lock | PostgreSQL advisory lock held across API and DNS operations | `server/routes.ts` | Per-project Durable Object lock |
| DNS inspection | Node `dns`, `dgram`, `Buffer`, raw UDP DNS | `server/custom-domains.ts` | Keep in a Node-compatible Worker only if verified; otherwise isolate authoritative DNS checks in a small service/Workflow using Cloudflare DNS-over-HTTPS/API |
| Cloudflare management | Server calls Cloudflare REST directly using account/zone/token configuration | `server/custom-domains.ts`, `server/published-routes.ts`, `server/project-preview-image.ts` | Worker secrets plus least-privilege Cloudflare API token |
| Images/uploads | Base64 images in JSON and Postgres; max request 12 MB | `server/index.ts`, `server/routes.ts`, `shared/schema.ts` | Keep small metadata in D1; move image bytes to R2 before cutover or enforce D1-safe size bounds |
| Preview screenshot | Server-side screenshot capture depends on current implementation/runtime | `server/project-preview-image.ts` | Browser Rendering binding or preserve non-critical failure behavior |
| SEO suggestions | Direct Gemini call uses `GOOGLE_AI_STUDIO_API_KEY`; 15-minute process-memory cache | `server/seo-suggestions.ts`, `server/routes.ts` | Control-plane Worker secret plus Cache API/KV cache, or explicitly retire the feature |
| Meta-image build plugin | Rewrites OpenGraph image URL from `REPLIT_INTERNAL_APP_DOMAIN`/`REPLIT_DEV_DOMAIN` | `vite-plugin-meta-images.ts`, `vite.config.ts` | Remove from production build; use configured production URL and gateway metadata |
| Legacy API helper | Hardcoded `https://ai-build-studio.replit.app` | `client/src/lib/api.ts` | Remove if unused; otherwise use same-origin relative API |
| Logging | Process stdout and full API JSON response logging | `server/index.ts` | Workers Logs with structured redaction |
| Secrets | Replit secret store/environment | Replit environment and `.replit` names | Worker secrets and CI deployment secrets |
| Deployment | Replit autoscale deployment runs `npm run start` | `.replit`, `package.json` | Wrangler deploy from GitHub CI |
| Source synchronization | Workspace branch has unpublished commits relative to GitHub | Git state | Push reviewed history; enforce protected GitHub branches |

Additional findings:

- Same-origin API URLs are already relative in the browser. This is migration-friendly.
- Replit URL allowances exist in CORS for development only; they must not remain part of the production trust boundary.
- No server-side persistent filesystem writes were found for application state. Customer files remain in VibeSDK/Artifacts.
- Node-only dependencies requiring verification include Express middleware, `pg`, `bcryptjs`, Node DNS/UDP, and portions of the VibeSDK SDK.
- Client timers are UI polling/toast/animation behavior, not Replit infrastructure.

---

## 3. Current Cloudflare inventory

Classification is conservative. No resource should be deleted based on this audit.

### Active

| Resource | Evidence and role |
|---|---|
| Zone `buildcustom.ai` | Active full zone. Hosts marketing, app, managed app wildcard, and fallback origin DNS. |
| Zone `buyermagnets.com` | Active full zone with preserved mail/service records and BuildCustom website/app routing. |
| Worker `buildcustom-apps-gateway` | Active published-app gateway. Bound to route KV and `buildcustom-vibesdk-staging` dispatch namespace. |
| Route `*.apps.buildcustom.ai/*` | Active hosted project subdomain route. |
| Route `*/*` | Active zone-wide route required for Cloudflare for SaaS Worker-as-origin behavior. Gateway passes `buildcustom.ai` hosts through. Treat as protected. |
| KV `buildcustom-app-routes` | Active slug, hostname, metadata, and preview-image routing source. |
| Dispatch namespace `buildcustom-vibesdk-staging` | Active generated-app namespace with two observed scripts. Despite its name, it is in the current production publishing path. |
| User Worker `taskflow---task-management-dashboard` | Active current generated application, modified September 20, 2026. |
| Worker `buildcustom-vibesdk-staging` | Active current ThinkAgent/SpaceDO runtime and generated-app deployer. |
| D1 `buildcustom-vibesdk-staging-db` | Bound to current VibeSDK Worker. This is VibeSDK state, not the BuildCustom control-plane database. |
| R2 `buildcustom-vibesdk-staging-templates` | Bound to current VibeSDK runtime. |
| KV `buildcustom-vibesdk-staging-kv` | Bound to current VibeSDK runtime. |
| Durable Objects for current staging-named VibeSDK | ThinkAgent, SpaceDO, CodeGeneratorAgent, UserAppSandboxService, UserSecretsStore, DORateLimitStore. |
| DNS `*.apps.buildcustom.ai` | Active proxied managed-app wildcard. |
| DNS `fallback.buildcustom.ai` | Active Cloudflare for SaaS fallback origin. |
| Cloudflare for SaaS custom hostnames | `buyermagnets.com`, `www.buyermagnets.com`, and `app.buyermagnets.com` are all active with active SSL. |

### Staging

| Resource | Evidence and role |
|---|---|
| Worker `buildcustom-apps-staging-gateway` | Route only for `staging-proof.apps.buildcustom.ai/*`; no KV binding. |
| DNS `staging-proof.apps.buildcustom.ai` | Nested staging proof hostname. |
| User Worker `buildcustom-runtime-proof` | Proof application in the current dispatch namespace. Preserve while migration staging is established. |

### Legacy

These appear to be the earlier VibeSDK generation, but are not safe to delete because dashboard emptiness does not prove no historical project references remain:

| Resource | Classification basis |
|---|---|
| Worker `vibesdk` | Older compatibility date and migration tag; no ThinkAgent or SpaceDO binding observed. |
| D1 `vibesdk-db` | Bound to the older Worker. |
| R2 `vibesdk-templates` | Bound to the older Worker. |
| KV `VibecoderStore` | Bound to the older Worker. |
| Dispatch namespace `vibesdk-default-namespace` | Bound to the older Worker; contains one script. |
| Older VibeSDK Durable Objects | CodeGeneratorAgent, UserAppSandboxService, UserSecretsStore, DORateLimitStore. |

### Unknown

| Resource | Required investigation |
|---|---|
| Dispatch namespace `buildcustomai` and `buildcustomai-dispatch` | Historical production-named dispatch path. No current source binding proves it is obsolete. Search persisted project/deployment metadata and request logs before reclassification. |
| User Worker `vibesdk-default-namespace` | Name matches its namespace but purpose is not proven. |
| Any Cloudflare Containers/Sandbox resources not returned by the inspected endpoints | Current Worker bindings prove sandbox usage through Durable Objects/Worker Loader, but container inventory was not independently enumerable in this audit. |
| Marketing Pages project `bca-96p.pages.dev` | DNS proves current marketing hosting, but Pages project settings were not included in the account inventory endpoint set. |

All observed Worker cron schedule lists were empty.

---

## 4. Source control / deployment workflow

### Current state

- GitHub remote: `https://github.com/thegoldimport/bca.git`.
- Current branch: `main`.
- Local `main` is 84 commits ahead of `origin/main` at audit time.
- Replit and gitsafe remotes are also configured.
- No `.github/workflows` files were found.
- Current production deployment is configured in `.replit`, not GitHub.

**Conclusion:** GitHub is the intended repository but is not yet the operational source of truth. Replit currently contains source changes and deployment ownership that GitHub does not.

### Recommended source of truth

1. Review and push the current complete history to GitHub without rewriting it.
2. Protect `main`: pull request required, CI required, no force pushes.
3. Add a `development` branch for integration if the team needs continuous shared staging. For a small team, short-lived feature branches into `main` plus an explicit production environment approval is simpler.
4. Treat repository migrations and Worker configuration as code. Dashboard changes should be emergency-only and reconciled back to Git.
5. Store no secret values in Git. CI receives scoped deployment credentials through GitHub environment secrets or Cloudflare's supported CI authentication.

### Deployment workflow

1. Feature branch: typecheck, unit tests, migration lint, Worker bundle build.
2. Pull request: temporary or shared isolated control-plane staging deployment.
3. Staging checks: auth, D1, VibeSDK connection, preview, publish to staging-only app resources, domain mutation prohibition.
4. Merge to `main`.
5. Production job builds once, applies reviewed forward-only D1 migrations, then deploys the same artifact.
6. GitHub production environment approval is required.
7. Store deployment version and migration version in logs and Worker version metadata.
8. Rollback uses a known prior Worker version. Database rollback is forward repair or restore to a new D1 database; never blindly reverse destructive migrations.

---

## 5. Target Cloudflare architecture

### Required services

**Control-plane Worker**

- Serves React static assets.
- Implements authenticated API routes.
- Validates sessions and authorization.
- Calls D1, project Durable Objects, VibeSDK, Cloudflare management APIs, and existing route KV.

**Worker Static Assets**

- Replaces Express static serving.
- Uses SPA fallback for client routes.
- Marketing `buildcustom.ai` can remain on its current Pages deployment and move separately.

**D1**

- Stores BuildCustom users, sessions, projects, runtime links, domain claims, releases, builder-turn metadata, content metadata, and settings.
- Does not store VibeSDK workspace files or future customer-application data.

**Durable Objects and Workflows**

- One instance keyed by BuildCustom project ID.
- Serializes plan/build/preview/deploy/restore/domain mutation operations.
- Acquires/releases the per-project operation lease and rejects conflicting commands.
- A Cloudflare Workflow executes every plan/build/preview/deploy/restore operation that can outlive a normal Worker request. The Workflow persists step progress, retry state, and terminal result.
- Reconnects to VibeSDK from persisted `agent_id`; neither the Durable Object nor Workflow becomes a second source of workspace truth.

**Existing KV**

- Reuse `buildcustom-app-routes` for published routing.
- Do not put authoritative control-plane relational data in KV.

**R2**

- Create a control-plane asset bucket only if preview/social/favicon image payloads are moved out of D1. This is recommended because D1 is not appropriate for repeated large base64 blobs.
- Do not combine this bucket with VibeSDK template buckets.

**Service bindings**

- Prefer a service binding from the control-plane Worker to the current VibeSDK Worker if the existing VibeSDK SDK/protocol supports it without behavioral change.
- Otherwise retain the current HTTPS VibeSDK base URL and HMAC authentication initially.

**Existing protected systems**

- `buildcustom-vibesdk-staging` Worker and its ThinkAgent/SpaceDO/Artifact/runtime bindings.
- `buildcustom-apps-gateway`.
- `buildcustom-vibesdk-staging` dispatch namespace and user Workers.
- Cloudflare for SaaS fallback origin/custom hostnames.
- `*.apps.buildcustom.ai`.

**Hard staging runtime boundary**

The active Worker and dispatch namespace named `buildcustom-vibesdk-staging` are part of the current production path and must be treated as production despite their names. Migration staging must not bind to them for any operation that can generate, edit, preview, restore, deploy, cancel, or otherwise mutate a workspace.

Create a separate migration-staging VibeSDK stack with:

- A distinct VibeSDK Worker/service hostname.
- A distinct runtime authentication secret accepted only by that Worker.
- Separate D1, R2, KV, Durable Object namespaces, Worker Loader/Sandbox bindings, logs, and dispatch namespace.
- Separate generated test Workers and hosted staging routes.
- No service binding, API credential, or management token that can call the active production VibeSDK Worker or production dispatch namespace.

The staging control-plane D1 must contain only staging project records and agent IDs created by the isolated staging runtime. Do not import production `agent_id` values into mutable staging tables. Read-only migration comparison tooling may inspect exported production identifiers offline, but the staging API must reject them and cannot possess a production runtime credential.

### Required long-running execution

- Workflows: required for the current three-to-five-minute runtime operations. The Durable Object and Workflow have different responsibilities: the DO serializes by project; the Workflow provides durable execution/retry state.

### Services not required initially

- Queues: no active queue producer/consumer exists.
- Cron Triggers: no active scheduled server job exists.
- Analytics Engine: optional after baseline Workers Logs are in place.
- New Containers: not required for the control plane; VibeSDK owns sandbox/container execution.

---

## 6. Control-plane database migration

### Observed databases

**Development**

- Database size: approximately 9.6 MB including PostgreSQL system/overhead.
- Twelve control-plane tables.
- Exact row counts at audit time:

| Table | Rows | Approx. relation size |
|---|---:|---:|
| `users` | 2 | 80 KiB |
| `waitlist_entries` | 2 | 32 KiB |
| `projects` | 2 | 32 KiB |
| `runtime_project_links` | 1 | 568 KiB |
| `runtime_custom_domain_claims` | 3 | 248 KiB |
| `runtime_releases` | 5 | 32 KiB |
| `runtime_builder_turns` | 3 | 32 KiB |
| `blog_posts` | 1 | 32 KiB |
| `autoblogger_settings` | 1 | 48 KiB |
| `seo_settings` | 2 | 272 KiB |
| `site_pages` | 1 | 32 KiB |
| `templates` | 15 | 48 KiB |

**Production**

- Database size: approximately 7.7 MB including PostgreSQL system/overhead.
- Only `users` and `waitlist_entries` exist.
- Both tables contain zero rows.
- The production `users` table contains only `id`, `username`, and `password`; it does not match the current application schema.

**Critical gate:** Before implementation, the owner must identify which database contains the authoritative current users/projects/domains. The observed Replit “production” database cannot be treated as the source of the working project/domain records.

### Authoritative observed PostgreSQL schema inventory

The following is the live development database schema observed through `information_schema` and `pg_indexes` on September 20, 2026. It is authoritative for that database snapshot. It is not merely the TypeScript declaration. `NOT NULL` is listed inline; PostgreSQL's internal generated not-null check names are omitted. Every foreign key below uses `ON DELETE CASCADE`.

- **`users`**
  - Columns: `id varchar NOT NULL DEFAULT gen_random_uuid()`, `username text NOT NULL`, `password text NOT NULL`, `email text NOT NULL DEFAULT ''`, `plan text NOT NULL DEFAULT 'free'`, `created_at timestamp NOT NULL DEFAULT now()`, `role text NOT NULL DEFAULT 'user'`.
  - Constraints/indexes: PK `id`; unique `username`; unique `email`; partial unique index `users_single_super_admin(role) WHERE role = 'super_admin'`.
- **`waitlist_entries`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `name text NOT NULL`, `email text NOT NULL`, `source text NOT NULL DEFAULT 'waitlist'`, `status text NOT NULL DEFAULT 'Pending'`, `created_at timestamp NOT NULL DEFAULT now()`.
  - Constraints/indexes: PK `id`.
- **`projects`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `user_id varchar NOT NULL`, `name text NOT NULL`, `type text NOT NULL DEFAULT 'website'`, `status text NOT NULL DEFAULT 'draft'`, `description text NOT NULL DEFAULT ''`, `framework text NOT NULL DEFAULT 'React + TailwindCSS'`, `url text NULL`, `created_at timestamp NOT NULL DEFAULT now()`, `updated_at timestamp NOT NULL DEFAULT now()`.
  - Constraints/indexes: PK `id`; FK `user_id -> users.id`.
- **`runtime_project_links`**
  - Columns: `project_id integer NOT NULL`, `agent_id text NULL`, `preview_url text NULL`, `deployment_url text NULL`, `created_at timestamp NOT NULL DEFAULT now()`, `updated_at timestamp NOT NULL DEFAULT now()`, `hosting_provider text NOT NULL DEFAULT 'cloudflare'`, `custom_domain text NULL`, `custom_origin text NULL`, `subdomain_slug text NULL`, `deployment_origin_url text NULL`, `deployment_script_name text NULL`, `custom_domain_cloudflare_id text NULL`, `custom_domain_status text NULL`, `custom_domain_ssl_status text NULL`, `custom_domain_dns_records jsonb NOT NULL DEFAULT '[]'`, `custom_domain_error text NULL`, `custom_domain_checked_at timestamp NULL`, `custom_domain_migration_state jsonb NOT NULL DEFAULT '{}'`, `custom_domain_secondary text NULL`, `custom_domain_secondary_cloudflare_id text NULL`, `custom_domain_secondary_status text NULL`, `custom_domain_secondary_ssl_status text NULL`, `custom_domain_secondary_dns_records jsonb NOT NULL DEFAULT '[]'`, `custom_domain_secondary_error text NULL`, `custom_domain_secondary_checked_at timestamp NULL`.
  - Constraints/indexes: PK/FK `project_id -> projects.id`; unique `agent_id`; partial unique indexes for non-null `subdomain_slug`, `custom_domain`, `custom_domain_cloudflare_id`, `custom_domain_secondary`, and `custom_domain_secondary_cloudflare_id`.
  - Drift note: the live default for `hosting_provider` is `'cloudflare'`, while `shared/schema.ts` declares `'buildcustom'`. The importer must preserve row values and the owner must approve the target default.
- **`runtime_custom_domain_claims`**
  - Columns: `hostname text NOT NULL`, `project_id integer NOT NULL`, `role text NOT NULL`, `created_at timestamp NOT NULL DEFAULT now()`, `source text NOT NULL DEFAULT 'custom'`, `purpose text NOT NULL DEFAULT 'website'`, `hostname_kind text NOT NULL DEFAULT 'subdomain'`, `is_primary boolean NOT NULL DEFAULT false`, `redirect_to text NULL`, `cloudflare_id text NULL`, `status text NULL`, `ssl_status text NULL`, `dns_records jsonb NOT NULL DEFAULT '[]'`, `error text NULL`, `checked_at timestamp NULL`, `migration_state jsonb NOT NULL DEFAULT '{}'`, `updated_at timestamp NOT NULL DEFAULT now()`.
  - Constraints/indexes: PK `hostname`; FK `project_id -> projects.id`; partial unique non-null `cloudflare_id`; partial unique `project_id WHERE is_primary = true`.
  - Drift note: no role check exists in the live database. `runtime-schema.ts` created and then dropped the old `primary`/`secondary` check.
- **`runtime_releases`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `project_id integer NOT NULL`, `commit_hash text NOT NULL`, `deployment_url text NOT NULL`, `created_at timestamp NOT NULL DEFAULT now()`.
  - Constraints/indexes: PK `id`; FK `project_id -> projects.id`.
- **`runtime_builder_turns`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `project_id integer NOT NULL`, `mode text NOT NULL DEFAULT 'build'`, `prompt text NOT NULL`, `response text NOT NULL`, `changed_files jsonb NOT NULL DEFAULT '[]'`, `commit_hash text NULL`, `created_at timestamp NOT NULL DEFAULT now()`, `activity jsonb NOT NULL DEFAULT '[]'`.
  - Constraints/indexes: PK `id`; FK `project_id -> projects.id`.
- **`blog_posts`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `project_id integer NOT NULL`, `title text NOT NULL`, `slug text NOT NULL`, `content text NOT NULL DEFAULT ''`, `status text NOT NULL DEFAULT 'draft'`, `keyword text NOT NULL DEFAULT ''`, `word_count integer NOT NULL DEFAULT 0`, `scheduled_at timestamp NULL`, `published_at timestamp NULL`, `created_at timestamp NOT NULL DEFAULT now()`.
  - Constraints/indexes: PK `id`; FK `project_id -> projects.id`. No unique slug constraint exists in the observed database.
- **`autoblogger_settings`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `project_id integer NOT NULL`, `enabled boolean NOT NULL DEFAULT false`, `posts_per_day integer NOT NULL DEFAULT 3`, `writing_style text NOT NULL DEFAULT 'neil-patel'`, `min_word_count integer NOT NULL DEFAULT 2000`, `keywords text NOT NULL DEFAULT ''`, `updated_at timestamp NOT NULL DEFAULT now()`.
  - Constraints/indexes: PK `id`; FK `project_id -> projects.id`; unique `project_id`.
- **`seo_settings`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `project_id integer NOT NULL`, `meta_title text NOT NULL DEFAULT ''`, `meta_description text NOT NULL DEFAULT ''`, `focus_keyword text NOT NULL DEFAULT ''`, `schema_json text NOT NULL DEFAULT '{}'`, `updated_at timestamp NOT NULL DEFAULT now()`, `favicon_data text NOT NULL DEFAULT ''`, `canonical_url text NOT NULL DEFAULT ''`, `og_title text NOT NULL DEFAULT ''`, `og_description text NOT NULL DEFAULT ''`, `og_image_url text NOT NULL DEFAULT ''`, `allow_indexing boolean NOT NULL DEFAULT true`, `social_image_data text NOT NULL DEFAULT ''`, `seo_keywords text NOT NULL DEFAULT ''`, `long_tail_keywords text NOT NULL DEFAULT ''`, `preview_image_data text NOT NULL DEFAULT ''`.
  - Constraints/indexes: PK `id`; FK `project_id -> projects.id`; unique `project_id`.
- **`site_pages`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `project_id integer NOT NULL`, `title text NOT NULL`, `slug text NOT NULL`, `status text NOT NULL DEFAULT 'draft'`, `page_type text NOT NULL DEFAULT 'standard'`, `content text NOT NULL DEFAULT ''`, `created_at timestamp NOT NULL DEFAULT now()`.
  - Constraints/indexes: PK `id`; FK `project_id -> projects.id`. No unique slug constraint exists in the observed database.
- **`templates`**
  - Columns: `id integer NOT NULL DEFAULT nextval(...)`, `name text NOT NULL`, `slug text NOT NULL`, `category text NOT NULL`, `description text NOT NULL DEFAULT ''`, `framework text NOT NULL DEFAULT ''`, `project_type text NOT NULL DEFAULT 'website'`, `tags text[] NOT NULL DEFAULT '{}'`, `color text NOT NULL DEFAULT 'from-cyan-500 to-blue-600'`, `github_url text NOT NULL DEFAULT ''`, `fork_url text NOT NULL DEFAULT ''`, `featured boolean NOT NULL DEFAULT false`, `stars integer NOT NULL DEFAULT 0`.
  - Constraints/indexes: PK `id`; unique `slug`.

The observed database has no additional non-primary lookup indexes beyond the unique and partial indexes listed above. The target D1 DDL adds project/time lookup indexes and value checks for performance and validation. Those additions are target safeguards, not claims about existing PostgreSQL constraints.

### Relationships and constraints

- `projects.user_id -> users.id`, cascade delete.
- Runtime links are one-to-one with projects.
- Runtime domain claims, releases, builder turns, posts, pages, SEO, and autoblogger settings reference projects.
- Domain hostname and Cloudflare IDs are unique.
- Hosted subdomain slug is unique.
- Agent ID is unique when present.
- SEO and autoblogger settings are one-to-one with projects.
- A partial unique index enforces one primary custom-domain claim per project.
- A partial unique index attempts to enforce one `super_admin`.

### PostgreSQL-specific behavior

- `gen_random_uuid()`.
- `serial` sequences.
- `jsonb` and `::jsonb` defaults.
- PostgreSQL text arrays and `::text[]`.
- Partial unique indexes.
- `RETURNING`.
- `ON CONFLICT`.
- Multi-statement transactions.
- PostgreSQL advisory locks.
- `DO $$ ... $$` migration blocks.
- `IS DISTINCT FROM`.
- Startup `ALTER TABLE` and migration backfill logic.

### D1 compatibility decision

D1 is suitable for the current small relational control-plane workload after explicit conversion:

- Store UUIDs as text and generate them in application code.
- Use `INTEGER PRIMARY KEY` while inserting existing integer IDs explicitly.
- Store timestamps as ISO-8601 text or integer epoch consistently.
- Store booleans as constrained integers.
- Store JSON and arrays as JSON text with application validation.
- Replace PostgreSQL partial uniqueness with D1 partial indexes if supported by the selected compatibility target, or enforce through transaction plus Durable Object serialization.
- Replace advisory locks with project Durable Objects.
- Replace boot-time DDL with checked-in D1 migrations.

### Proposed D1 schema

Keep the existing 12 logical tables and columns, changing types only for SQLite compatibility. Add:

1. `sessions`
   - `id` text primary key containing a random opaque token hash, not the raw cookie token.
   - `user_id` text foreign key.
   - `created_at`, `expires_at`, `last_seen_at`, `revoked_at`.
   - optional user-agent/IP risk metadata with a documented retention period.
2. `audit_events`
   - actor user/session, action, resource type/ID, result, request correlation ID, timestamp.
3. Required `operations`
   - durable operation ID, project ID, kind, status, timestamps, error summary. Workspace state remains in VibeSDK.

Do not invent duplicate `agent_sessions`, `revisions`, or `deployments` tables unless implementation shows a missing control-plane requirement. Existing `runtime_project_links`, `runtime_releases`, and `runtime_builder_turns` already cover the current references.

### Concrete D1 DDL baseline

The implementation may split this into numbered migration files, but it must preserve these columns and invariants. JSON columns are validated JSON text. Timestamps are UTC ISO-8601 text. Boolean values are integers constrained to `0` or `1`.

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '' UNIQUE,
  plan TEXT NOT NULL DEFAULT 'free',
  role TEXT NOT NULL DEFAULT 'user',
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX users_single_super_admin
  ON users(role) WHERE role = 'super_admin';

CREATE TABLE waitlist_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'waitlist',
  status TEXT NOT NULL DEFAULT 'Pending',
  created_at TEXT NOT NULL
);

CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'draft',
  description TEXT NOT NULL DEFAULT '',
  framework TEXT NOT NULL DEFAULT 'React + TailwindCSS',
  url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX projects_user_id_idx ON projects(user_id);

CREATE TABLE runtime_project_links (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  agent_id TEXT UNIQUE,
  preview_url TEXT,
  deployment_url TEXT,
  deployment_origin_url TEXT,
  deployment_script_name TEXT,
  subdomain_slug TEXT UNIQUE,
  hosting_provider TEXT NOT NULL DEFAULT 'buildcustom',
  custom_domain TEXT UNIQUE,
  custom_origin TEXT,
  custom_domain_cloudflare_id TEXT UNIQUE,
  custom_domain_status TEXT,
  custom_domain_ssl_status TEXT,
  custom_domain_dns_records TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(custom_domain_dns_records)),
  custom_domain_error TEXT,
  custom_domain_checked_at TEXT,
  custom_domain_secondary TEXT UNIQUE,
  custom_domain_secondary_cloudflare_id TEXT UNIQUE,
  custom_domain_secondary_status TEXT,
  custom_domain_secondary_ssl_status TEXT,
  custom_domain_secondary_dns_records TEXT NOT NULL DEFAULT '[]'
    CHECK (json_valid(custom_domain_secondary_dns_records)),
  custom_domain_secondary_error TEXT,
  custom_domain_secondary_checked_at TEXT,
  custom_domain_migration_state TEXT NOT NULL DEFAULT '{}'
    CHECK (json_valid(custom_domain_migration_state)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runtime_custom_domain_claims (
  hostname TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'custom',
  purpose TEXT NOT NULL DEFAULT 'website',
  hostname_kind TEXT NOT NULL DEFAULT 'subdomain'
    CHECK (hostname_kind IN ('apex','www','subdomain')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0,1)),
  redirect_to TEXT,
  cloudflare_id TEXT UNIQUE,
  status TEXT,
  ssl_status TEXT,
  dns_records TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(dns_records)),
  error TEXT,
  checked_at TEXT,
  migration_state TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(migration_state)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX runtime_custom_domain_claims_project_id_idx
  ON runtime_custom_domain_claims(project_id);
CREATE UNIQUE INDEX runtime_custom_domain_claims_one_primary_per_project
  ON runtime_custom_domain_claims(project_id) WHERE is_primary = 1;

CREATE TABLE runtime_releases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  commit_hash TEXT NOT NULL,
  deployment_url TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX runtime_releases_project_created_idx
  ON runtime_releases(project_id, created_at DESC);

CREATE TABLE runtime_builder_turns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mode TEXT NOT NULL DEFAULT 'build' CHECK (mode IN ('plan','build')),
  prompt TEXT NOT NULL,
  response TEXT NOT NULL,
  changed_files TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(changed_files)),
  activity TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(activity)),
  commit_hash TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX runtime_builder_turns_project_created_idx
  ON runtime_builder_turns(project_id, created_at);

CREATE TABLE blog_posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  keyword TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  scheduled_at TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX blog_posts_project_id_idx ON blog_posts(project_id);

CREATE TABLE autoblogger_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  posts_per_day INTEGER NOT NULL DEFAULT 3,
  writing_style TEXT NOT NULL DEFAULT 'neil-patel',
  min_word_count INTEGER NOT NULL DEFAULT 2000,
  keywords TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE seo_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  meta_title TEXT NOT NULL DEFAULT '',
  meta_description TEXT NOT NULL DEFAULT '',
  focus_keyword TEXT NOT NULL DEFAULT '',
  seo_keywords TEXT NOT NULL DEFAULT '',
  long_tail_keywords TEXT NOT NULL DEFAULT '',
  schema_json TEXT NOT NULL DEFAULT '{}',
  favicon_data TEXT NOT NULL DEFAULT '',
  canonical_url TEXT NOT NULL DEFAULT '',
  og_title TEXT NOT NULL DEFAULT '',
  og_description TEXT NOT NULL DEFAULT '',
  og_image_url TEXT NOT NULL DEFAULT '',
  preview_image_data TEXT NOT NULL DEFAULT '',
  social_image_data TEXT NOT NULL DEFAULT '',
  allow_indexing INTEGER NOT NULL DEFAULT 1 CHECK (allow_indexing IN (0,1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE site_pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  page_type TEXT NOT NULL DEFAULT 'standard',
  content TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX site_pages_project_id_idx ON site_pages(project_id);

CREATE TABLE templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  category TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  framework TEXT NOT NULL DEFAULT '',
  project_type TEXT NOT NULL DEFAULT 'website',
  tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)),
  color TEXT NOT NULL DEFAULT 'from-cyan-500 to-blue-600',
  github_url TEXT NOT NULL DEFAULT '',
  fork_url TEXT NOT NULL DEFAULT '',
  featured INTEGER NOT NULL DEFAULT 0 CHECK (featured IN (0,1)),
  stars INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX sessions_user_expires_idx ON sessions(user_id, expires_at);

CREATE TABLE operations (
  id TEXT PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  workflow_instance_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('queued','running','cancelling','succeeded','failed','cancelled')),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
  error_code TEXT,
  error_message TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX operations_project_created_idx
  ON operations(project_id, created_at DESC);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id_hash TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL,
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  side_effects_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(side_effects_json)),
  created_at TEXT NOT NULL
);
CREATE INDEX audit_events_resource_created_idx
  ON audit_events(resource_type, resource_id, created_at DESC);

CREATE TABLE mutation_ledger (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  request_id TEXT NOT NULL,
  actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending','completed','failed','compensating','compensated')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX mutation_ledger_status_sequence_idx
  ON mutation_ledger(status, sequence);

CREATE TABLE mutation_side_effects (
  mutation_id TEXT NOT NULL REFERENCES mutation_ledger(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  resource_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL
    CHECK (status IN ('pending','completed','failed','compensating','compensated')),
  before_json TEXT CHECK (before_json IS NULL OR json_valid(before_json)),
  after_json TEXT CHECK (after_json IS NULL OR json_valid(after_json)),
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (mutation_id, ordinal)
);
```

The source `runtime-schema.ts` once constrained domain roles to only `primary`/`secondary`, then dropped that constraint because current roles also include `redirect` and `direct`. The D1 schema deliberately leaves `role` open while application validation enforces the current role/purpose matrix.

### Migration method

Use a short maintenance window:

1. Resolve the authoritative source database.
2. Apply reviewed D1 migrations to an empty staging database.
3. Export each PostgreSQL table in dependency order to deterministic JSON/CSV.
4. Transform PostgreSQL values to D1 forms without changing IDs or external identifiers.
5. Import in transactions/batches sized below the current D1 statement/parameter/request limits. Enable `PRAGMA defer_foreign_keys = ON` inside each full dependency-order import transaction and run `PRAGMA foreign_key_check` before commit.
6. Insert every historical integer ID explicitly. For every `AUTOINCREMENT` table, verify the next generated ID is greater than `MAX(id)` in a post-import probe; update `sqlite_sequence` only if the verified D1 runtime does not advance it from explicit inserts.
7. Verify exact row counts, nullability, uniqueness, foreign-key integrity, JSON parseability, and normalized row hashes.
8. Compare project-to-agent, project-to-deployment, slug, hostname, and Cloudflare ID mappings.
9. Repeat the full export/import into a newly created staging D1 database until deterministic.
10. Restore a PostgreSQL snapshot in an isolated environment and run the exporter against that restored copy to prove backup usability.
11. During production maintenance, stop writes, take a final backup/export, run the same importer, validate, then cut over.

At this scale, dual-write adds risk without benefit. If authoritative production volume is materially different, revisit this decision.

### ID preservation

Preserve exactly:

- User UUIDs.
- Project, release, builder-turn, content, and settings integer IDs.
- VibeSDK agent/workspace IDs.
- Commit hashes.
- Deployment script names and origin URLs.
- Hosted subdomain slugs.
- Custom hostnames and Cloudflare custom-hostname IDs.
- SSL/domain lifecycle data.
- Redirect and role/purpose mappings.

---

## 7. Authentication migration

### Current security model

- Registration and login validate a password and return the user object.
- The browser stores that object in `localStorage`.
- Every browser API request attaches `x-user-id`.
- The API treats a matching database user as authenticated.
- There is no server session, secure cookie, logout invalidation, password reset, email verification, or login rate limit in the Express control plane.
- Admin login compares environment credentials and the browser stores an `isAuthenticated` flag.
- A default admin password exists in source fallback logic.
- Several admin waitlist endpoints do not call any server authorization middleware.

### Vulnerabilities

- User impersonation by changing `x-user-id`.
- Persistent token-equivalent identity in JavaScript-readable storage.
- IDOR/cross-tenant risk if any ownership check is missed.
- No session expiration or revocation.
- No CSRF design because no real cookie session exists yet.
- No password reset/email verification.
- Weak minimum password length.
- Admin authentication can be bypassed client-side for UI access, and server admin routes are insufficiently protected.
- Full API response logging can leak user or operational data.

### Target model

**Decision:** Keep current email/password accounts for the initial migration to avoid an unrelated identity-provider migration. Implement server-side sessions in D1:

1. Login verifies the existing password hash.
2. Server generates a cryptographically random opaque session token.
3. Store only a hash of the token in D1.
4. Set `__Host-bc_session` as `HttpOnly; Secure; SameSite=Lax; Path=/`.
5. Use short idle and absolute expiration, with rotation after login and sensitive changes.
6. Logout revokes the session in D1 and expires the cookie.
7. Every protected API resolves the user only from the validated session.
8. Remove all trust in `x-user-id`; reject it at the edge during the compatibility period.
9. Role checks use `users.role`, not a separate browser flag.
10. Add rate limiting for login, registration, password changes, domain changes, deployment, and runtime operations.

### CSRF

- SameSite=Lax plus same-origin APIs is the baseline.
- Require an Origin check for all state-changing requests.
- Add a per-session CSRF token for highly sensitive operations if any cross-site embedding or relaxed SameSite policy is required.
- CORS production allowlist should contain only actual BuildCustom origins and must not accept arbitrary Replit domains.

### Authorization boundaries

For every project-scoped request:

1. Validate session.
2. Fetch project.
3. Verify owner or future membership.
4. Resolve the runtime link from that project only.
5. Verify any turn/release/domain belongs to the same project.
6. Perform the external operation.

Admin, billing, domain, deployment, agent/workspace, and future resource operations need explicit authorization middleware and audit events.

---

## 8. VibeSDK / ThinkAgent integration

### Current integration

- `VibeClient` connects to `VIBESDK_RUNTIME_URL` with an HMAC-derived API key.
- BuildCustom persists one VibeSDK `agent_id` per project.
- The SDK maintains the underlying realtime connection/protocol. BuildCustom does not expose its own WebSocket endpoint.
- The browser sends normal HTTP requests and polls status.
- Plan/build requests currently hold an HTTP request open while polling session state.
- Sessions are cached in memory and reconnected by `agent_id`.
- Per-project plan/build/preview/deploy/restore operations are serialized only within one Node process.
- Cancellation calls `session.stop()`.
- Build retries connect/build behavior through the SDK and stores a builder-turn record after completion.

### Target integration

Preserve the SDK and protocol. Move coordination, not workspace state:

1. API validates user and project ownership.
2. API creates the D1 `operations` row using a client/request idempotency key, then asks the project Durable Object to acquire the project lease.
3. The Durable Object starts one Cloudflare Workflow instance and records its ID. Conflicting operations remain queued or are rejected according to an explicit compatibility matrix.
4. The Workflow connects/reconnects through the same VibeSDK SDK using persisted `agent_id`, checkpoints each phase, and writes terminal result/error state to D1.
5. API returns the operation ID immediately with `202 Accepted`.
6. Browser polls an authenticated operation/status endpoint. If SDK event streaming is later exposed safely, SSE/WebSocket can be added without changing ThinkAgent.
7. Files/revisions remain in VibeSDK/Artifacts. D1 stores only operation/request/result metadata and durable BuildCustom references.
8. Retries reuse the operation idempotency key and must inspect current VibeSDK state before repeating a non-idempotent deploy or restore step.
9. Cancellation marks the operation `cancelling`; the Workflow reconnects if needed, invokes the current SDK `stop()`, records `cancelled`, and releases the DO lease.
10. On Workflow crash/retry, the persisted phase and VibeSDK state decide whether to resume, compensate, or fail for owner retry. A DO alarm checks and releases only leases whose Workflow has a terminal state or exceeded the documented recovery deadline.

### Environment isolation

- **Production control plane:** connects only to the existing active production VibeSDK runtime and active production dispatch namespace.
- **Migration staging control plane:** connects only to the newly created isolated staging VibeSDK runtime and staging dispatch namespace.
- Runtime credentials are environment-specific and server-enforced. A staging credential is not recognized by production.
- Staging-generated `agent_id` values are stored only in staging D1. Production agent IDs are excluded from staging imports and rejected by staging ownership/provenance validation.
- All staging plan/build/edit/files/preview/restore/stop/deploy tests use staging-created workspaces.
- There is no application-level “read-only production adapter” fallback for staging. Offline exports and normalized shadow comparisons are the only permitted production-data inspection paths.

### Project mapping

| BuildCustom concept | Current/target reference |
|---|---|
| Project | `projects.id` |
| VibeSDK workspace/agent | `runtime_project_links.agent_id` |
| ThinkAgent session | Reconnectable SDK session for `agent_id`; transient |
| BuildCustom conversation summary | `runtime_builder_turns` |
| Revision/checkpoint | `commit_hash` references VibeSDK/Artifacts history |
| Preview | `runtime_project_links.preview_url`; source of truth remains runtime |
| Published deployment | `deployment_script_name`, origin URL, public URL |
| Workers for Platforms Worker | Script name in existing dispatch namespace |
| Hosted hostname | `subdomain_slug.apps.buildcustom.ai` |
| Custom hostnames | `runtime_custom_domain_claims` plus Cloudflare IDs |

### Unchanged

- ThinkAgent is the native agent.
- SpaceDO and Artifacts own workspace state.
- Dynamic preview behavior and current SDK protocol.
- Worker Loader/Sandbox behavior.
- Workers for Platforms deployment.
- Existing user Workers and published routes.

### Compatibility gate

Prove `@cf-vibesdk/sdk` runs correctly inside a Cloudflare Workflow step in the target Worker runtime, including its realtime transport, Node compatibility requirements, reconnect behavior, retry boundaries, and five-minute operation behavior. Also prove that the project Durable Object can serialize Workflow starts and recover stale leases. If the SDK cannot run safely in Workflow execution, isolate only the adapter in a dedicated Cloudflare Worker/Container invoked by the Workflow while keeping the same API and no additional AI layer.

---

## 9. Deployment / Workers for Platforms

### Current flow

1. User invokes deploy.
2. API checks plan entitlement and live-project count.
3. API allocates/persists a hosted slug.
4. VibeSDK deploys to Workers for Platforms.
5. API extracts the dispatch script name.
6. API writes slug -> script/metadata to `buildcustom-app-routes`.
7. API transaction persists public URL, origin URL, script name, and release.
8. Gateway resolves KV and dispatches to the user Worker.
9. Gateway injects SEO/favicon/social metadata and serves preview images.

### Target flow

Same flow, with:

- Authenticated Worker API.
- Per-project Durable Object lock.
- D1 transaction for metadata.
- Existing route KV and gateway.
- Idempotency key for deploy/finalize operations.
- Compensating route restoration retained if D1 persistence fails.

### Protected invariants

- One shared dispatch namespace, not one per customer.
- Customer code remains outside the control-plane Worker.
- No customer Worker receives control-plane secrets or D1 bindings.
- Existing script names and route KV values remain unchanged.
- Existing published applications continue serving even while control-plane cutover occurs.

---

## 10. Custom domains

### Current working implementation

The current code:

- Normalizes and classifies apex, `www`, and subdomain hostnames.
- Performs read-only DNS inventory and imported-record comparisons.
- Creates Cloudflare for SaaS custom hostnames.
- Tracks ownership and SSL validation records.
- Verifies root nameserver delegation through parent and authoritative servers.
- Writes hostname route mappings into KV.
- Verifies actual customer-host traffic before exposing a hostname as live.
- Supports primary, redirect, and application/direct roles.
- Uses PostgreSQL advisory locks and relational uniqueness to prevent conflicting claims.

Cloudflare confirms active SSL for:

- `buyermagnets.com`
- `www.buyermagnets.com`
- `app.buyermagnets.com`

### Metadata that must migrate

- All `runtime_project_links` domain fields.
- Every `runtime_custom_domain_claims` row.
- Hostname, project ID, role, source, purpose, kind, primary flag, redirect target.
- Cloudflare custom-hostname ID.
- Hostname status and SSL status.
- Validation/DNS records.
- Errors and checked timestamps.
- Migration state, DNS inventories, acknowledgements, and nameserver state.
- KV `hostname:<hostname>` entries.

### No-reconnection strategy

Do not recreate custom hostnames. Preserve their Cloudflare IDs and KV mappings. The Cloudflare for SaaS resources, fallback origin, gateway route, customer DNS, and certificates are independent of the Replit control plane. During migration:

1. Export and validate all domain records.
2. Compare them with live Cloudflare custom-hostname inventory and KV.
3. Import unchanged IDs and mappings to D1.
4. Keep domain mutation endpoints disabled during the short final migration window.
5. Verify each hostname through the customer hostname itself.

Customers do not reconnect because neither their DNS nor their existing Cloudflare custom-hostname objects are replaced.

---

## 11. Files / storage

### Current state

- VibeSDK/Artifacts owns generated project files and revisions.
- The Express control plane does not persist project files to Replit disk.
- Runtime message image attachments are base64 JSON payloads sent to VibeSDK.
- SEO/favicon/social/preview image data can be stored as base64 text in PostgreSQL.
- Published preview JPEG bytes are stored in route KV.
- Static BuildCustom frontend assets are built into `dist/public`.

### Target

- Worker Static Assets: BuildCustom frontend.
- VibeSDK/Artifacts: generated app files and revisions, unchanged.
- Existing route KV: current published preview image and route behavior, unchanged during migration.
- R2 control-plane asset bucket: recommended for durable uploaded preview/social/favicon bytes. D1 stores object key, content type, checksum, size, and timestamps.
- Do not use Worker filesystem as durable storage.
- Temporary request data remains in request memory with strict size limits.

---

## 12. Background jobs

### Active

- No server cron loop, queue consumer, or autonomous scheduler was found.
- No Cron Trigger is attached to the observed Workers.
- Domain refresh, deployment, screenshots, and runtime operations are user/request driven.
- Browser polling is active UI behavior.

### Legacy/incomplete

- `autoblogger_settings` and scheduled blog fields exist.
- No scheduler that generates or publishes posts was found.
- Admin billing/revenue displays are presentation data, not a verified billing job.

### Migration target

- Do not migrate autoblogging as an active job.
- Mark it disabled until a product decision activates it.
- If activated later, use Cron Trigger -> Queue/Workflow with idempotent job records.
- Multi-minute runtime operations use Workflows plus project Durable Object serialization, but this is request-driven coordination, not a global cron.
- Domain/SSL reconciliation can be added later as a low-frequency Workflow/Cron only after the request-driven path is stable.

---

## 13. Secrets

Secret values were not read or included.

| Name | Current purpose/location | Target |
|---|---|---|
| `DATABASE_URL` | Replit PostgreSQL connection | Remove from production after D1 cutover |
| `SESSION_SECRET` | Current VibeSDK HMAC derivation; Replit secret | Dedicated control-plane Worker secret; separate from browser session signing/token generation |
| `CLOUDFLARE_API_TOKEN` | Cloudflare custom-hostname management; Replit secret and VibeSDK Worker secret | Least-privilege Worker secret, scoped to required zone/account operations |
| `WORKERSKV` | Cloudflare KV REST writes from Express | Prefer direct KV binding; remove this token from control-plane runtime if binding is used |
| `GOOGLE_AI_STUDIO_API_KEY` | Direct project-aware SEO suggestions in `server/seo-suggestions.ts`; model provider may use its own separately bound copy | Separate control-plane Worker secret for SEO suggestions, or remove only if the feature is explicitly retired |
| `JWT_SECRET` | VibeSDK runtime authentication | Remains on VibeSDK Worker; do not duplicate unnecessarily |
| `GITHUB_PERSONAL_ACCESS_TOKEN` | Repository automation/development | CI/repository secret only; never bind to production Worker unless a specific platform action requires it |
| `ADMIN_USERNAME` | Legacy admin login | Remove after role-based sessions |
| `ADMIN_PASSWORD` | Legacy admin login | Remove after role-based sessions; eliminate source fallback immediately during implementation |

Non-secret configuration should be Worker vars/bindings, not secrets:

- Cloudflare account/zone IDs.
- Route KV namespace binding.
- Apps domain.
- Custom-hostname fallback target.
- Public BuildCustom URL.
- VibeSDK service/base URL.

Each environment must have separate secrets. Staging credentials must be unable to mutate production DNS, custom hostnames, billing, or dispatch resources.

The model key must not be exposed to the browser or shared with generated customer Workers. Replace the process-memory SEO cache with Cache API or a namespaced KV entry keyed by content hash and a 15-minute TTL.

---

## 14. Billing

### Current architecture

**Confirmed:** No Stripe SDK, checkout endpoint, webhook endpoint, Stripe customer/subscription IDs, webhook verification, or active Stripe secret was found. Plan names and entitlements exist in application code and user records. Billing/revenue UI contains display data but does not prove active billing.

### Migration plan

- Migrate current plan/entitlement fields as control-plane data.
- Do not introduce Stripe during this infrastructure migration.
- Treat billing as inactive unless the owner identifies a separate service or untracked deployment.
- If an external Stripe integration exists outside this repository, inventory it before cutover.
- A future Stripe webhook should run on the Cloudflare control-plane Worker, verify the raw request body, deduplicate event IDs in D1, and update entitlements transactionally.
- No pricing or plan behavior changes should be bundled with migration.

---

## 15. Security

### Required before cutover

1. Replace browser-trusted `x-user-id` with server-validated sessions.
2. Remove legacy admin fallback credentials and protect every admin endpoint.
3. Centralize authentication, role checks, and project ownership middleware.
4. Enforce ownership for project, turn, release, deployment, domain, agent/workspace, and future resource IDs.
5. Add rate limits to auth and high-cost/mutating operations.
6. Validate Origin/CSRF for state changes.
7. Restrict CORS to real production/staging origins.
8. Stop logging full API response bodies.
9. Use least-privilege, environment-specific Cloudflare API tokens.
10. Ensure generated customer Workers receive no control-plane D1, KV management token, Cloudflare management credential, model provider secret, or session secret.
11. Preserve gateway header sanitization before dispatch.
12. Keep route/script name validation.
13. Add idempotency and audit events for publish, delete, domain creation/removal, and role changes.
14. Add Content Security Policy, secure response headers, and clickjacking controls appropriate to the embedded preview model.
15. Separate staging and production bindings so staging cannot mutate production.
16. Bootstrap the first `super_admin` through a one-time owner-approved migration, then require an existing super-admin audit event for role changes.
17. Store rate-limit state in a dedicated Durable Object keyed by a hash of IP plus account/session where applicable; do not rely on per-isolate memory.

### Additional risks

- User enumeration and weak password policy.
- No email verification/reset.
- Long request denial-of-service potential.
- Large base64 request and database payloads.
- DNS import data should continue to be treated as untrusted input.
- Domain deletion has compensating logic but still requires alerting on partial failure.
- The zone-wide gateway route is security-sensitive; passthrough behavior requires regression tests.

---

## 16. Observability

Minimum before cutover:

- Workers Logs enabled for control-plane Worker, project Durable Object, and existing gateway.
- Structured JSON logs with request ID, deployment version, environment, route name, status, duration, user ID hash/reference, project ID, operation ID, and upstream category.
- Never log passwords, cookies, session tokens, authorization headers, secret values, image payloads, full prompts by default, or full API response bodies.
- Metrics/alerts for:
  - Authentication failures and rate limits.
  - D1 errors/latency.
  - ThinkAgent connect/reconnect/timeout/cancel failures.
  - Preview/deploy failure rates.
  - KV route update and compensation failures.
  - Custom hostname/SSL/routing verification failures.
  - Gateway 404/5xx and dispatch failures.
  - Durable Object queue depth and stuck operations.
- Audit events in D1 for security-sensitive mutations.
- Correlate control-plane request ID -> operation ID -> VibeSDK agent ID -> dispatch script name.
- Synthetic checks for `app.buildcustom.ai`, an existing hosted app, `buyermagnets.com`, its `www` redirect, and `app.buyermagnets.com`.
- If billing becomes active, Stripe webhook delivery/deduplication alerts.

Do not build a separate observability platform during migration. Start with Workers Logs, alerts, D1 audit events, and external synthetic checks.

---

## 17. Staging migration

Exact order:

1. Reconcile and push source to GitHub.
2. Add CI checks for typecheck, tests, Worker build, migration validation, and secret scanning.
3. Create a separate staging control-plane Worker and hostname.
4. Create a separate staging D1 database.
5. Create a separate staging Durable Object namespace.
6. Create a separate staging asset R2 bucket only if the R2 decision is approved.
7. Create staging session/auth secrets.
8. Create a new isolated migration-staging VibeSDK Worker with separate D1, R2, KV, Durable Object namespaces, Worker Loader/Sandbox bindings, logs, runtime secret, and service hostname.
9. Create a staging-only Workers for Platforms dispatch namespace and staging gateway/route KV for generated test applications.
10. Bind the staging control plane only to the isolated staging VibeSDK service and credential. Do not provide any production VibeSDK credential, service binding, dispatch binding, or management token.
11. Do not give staging production Cloudflare hostname-management credentials.
12. Import a sanitized development database snapshot into staging D1 without production `agent_id` values. Create all mutable staging workspace links through the isolated staging runtime.
13. Add server-side environment/provenance checks that reject any agent or script identifier not owned by the staging runtime/dispatch namespace.
14. Run auth/session/authorization tests.
15. Create a staging project, generate its isolated workspace, edit it, list/read files, preview it, restore it, cancel an operation, and deploy it to the staging-only dispatch namespace.
16. Verify hosted staging routing and metadata.
17. Use mocked Cloudflare for SaaS responses for destructive domain tests; use only an owner-approved staging hostname for end-to-end verification.
18. Attempt to use a production `agent_id`, production runtime URL, production runtime credential, production KV key, and production dispatch script from staging; every attempt must fail before an upstream mutation.
19. Confirm staging cannot change production workspaces, previews, custom hostnames, KV, dispatch scripts, DNS, billing, email, or control-plane state.
20. Run load/timeout tests for multi-minute runtime operations and cancellation.
21. Verify project-aware SEO suggestions, fallback behavior, cache expiry, and that the model key is never returned or logged.
22. Test Worker route precedence: `app.buildcustom.ai/*` must reach the control-plane Worker before the protected gateway `*/*` route, while `*.apps.buildcustom.ai/*` and all customer SaaS hostnames must continue reaching the gateway.
23. Record a go/no-go review.

Resources that may be shared read-only:

- Source repository.
- VibeSDK SDK package/protocol.
- Public templates if immutable.

Resources that must be isolated:

- Control-plane D1, sessions, Durable Objects, Workflows, secrets, route KV, app hostname, logs, and any future billing/email integrations.
- The complete mutable VibeSDK test stack: Worker/service, runtime secret, D1, R2, KV, all runtime Durable Object namespaces, Worker Loader/Sandbox bindings, generated-app dispatch namespace, generated test Workers, and staging gateway routes.

---

## 18. Data migration

### Exact order

1. Identify and sign off on the authoritative source database.
2. Inventory exact production rows and compare external Cloudflare objects.
3. Freeze schema changes.
4. Create an encrypted, access-controlled PostgreSQL backup and deterministic table exports.
5. Apply the final D1 schema to a new database.
6. Transform types while preserving IDs and references.
7. Import parent tables, then child tables.
8. Validate exact row counts.
9. Run `PRAGMA foreign_key_check`.
10. Validate all unique mappings.
11. Parse every JSON field and verify expected shapes.
12. Compare hashes of normalized exported/imported rows.
13. Verify every project mapping:
    - user
    - agent ID
    - deployment script
    - hosted slug
    - releases
    - domain claims
14. Compare every custom hostname ID/status with live Cloudflare.
15. Compare every hosted slug and hostname route with KV.
16. Run application-level read tests.
17. Repeat from a fresh database until deterministic.

### Production execution

1. Announce a short control-plane maintenance window. Existing generated apps remain online.
2. Disable control-plane writes and new login/session creation on Replit.
3. Wait for in-flight project operations to finish or cancel safely.
4. Take final backup/export.
5. Import to a fresh production D1.
6. Run all automated and manual verification.
7. If any invariant fails, keep Replit active, discard the new D1 target, fix the importer, and retry later.

### Read-only shadow verification

Before public cutover, replay only safe reads against Replit and Cloudflare and compare normalized results:

1. `/api/auth/me` for an owner-only migration session.
2. Project list and individual project metadata.
3. Runtime links, status shape, file path list, turns, and releases.
4. Publishing settings and SEO metadata.
5. Domain claims and lifecycle state.
6. Templates, pages, and posts.

Exclude volatile timestamps, connection-state fields, and signed/transient URLs from equality. Compare row/reference invariants rather than raw ordering. No shadow request may create sessions, agent messages, previews, deployments, domains, KV writes, or Cloudflare API mutations. Store the comparison report with endpoint, principal, normalized hash, differences, and timestamp.

### Rollback

Before DNS cutover, rollback is simply continued Replit operation. After cutover but before any Cloudflare-side writes, point `app.buildcustom.ai` back and restore old frontend/API traffic. If new control-plane writes occur after cutover, use the rollback plan in section 21; do not split-brain write to both stores.

---

## 19. Production cutover

Exact order:

1. Approve staging evidence, security checklist, backup restoration test, and rollback rehearsal.
2. Lower the `app.buildcustom.ai` DNS TTL in advance if it is not already automatic/proxied.
3. Deploy the production control-plane Worker with production D1/DO/assets/secrets, but do not route public traffic.
4. Run direct Worker hostname smoke tests.
5. Enter maintenance/read-only mode on Replit.
6. Drain or cancel in-flight agent/domain/deploy operations.
7. Perform final export/import and verification.
8. Create an explicit cutover checkpoint containing old DNS/route target, Worker version, D1 database ID, migration report, and timestamp.
9. Route an owner-only canary hostname or Cloudflare Access-protected path to the production control-plane Worker. Do not expose general traffic yet.
10. Enable writes only for the owner canary session. Every canary mutation must use an idempotency key and write complete before/after/side-effect records to the migration ledger.
11. Test sign-in, session rotation, project listing, existing runtime reconnect, files, one preview, one build edit on a designated test project, restore, SEO suggestions, and publish.
12. Reverse or explicitly accept the canary changes, then rerun data/KV/domain invariants.
13. Configure route precedence so `app.buildcustom.ai/*` reaches the control-plane Worker ahead of the protected gateway `*/*` route. Verify `*.apps.buildcustom.ai/*` and customer hostnames still reach the gateway.
14. Route `app.buildcustom.ai` to the Cloudflare control-plane Worker.
15. Do not move `buildcustom.ai` marketing Pages hosting in the same change.
16. Verify certificate, HTTP behavior, existing hosted apps, and existing custom domains without changing their DNS.
17. Open Cloudflare writes to all authenticated users. Replit remains read-only and must reject mutations to avoid split brain.
18. Observe for at least the approved stabilization period.
19. Perform the Replit shutdown test.

Current DNS evidence: `app.buildcustom.ai` is a proxied placeholder/Worker-origin record. The implementation phase must capture its exact pre-cutover route/record and rollback target before modifying it.

---

## 20. Replit shutdown test

1. Confirm backups and rollback target are current.
2. Stop the Replit production deployment.
3. Disable the Cloudflare production Worker's ability to access Replit PostgreSQL; ideally no `DATABASE_URL` is bound.
4. Confirm no production secret remains required from Replit.
5. Open `app.buildcustom.ai` in a clean browser.
6. Sign in and verify `/api/auth/me`.
7. List existing projects.
8. Open an existing project and reconnect to its ThinkAgent workspace.
9. List and read real files.
10. Create a new project.
11. Run plan mode.
12. Approve/run a build and observe operation status.
13. Preview the application.
14. Make a conversational edit.
15. Verify a new builder turn/revision reference.
16. Restore a prior revision into preview.
17. Publish a staging-approved production test project.
18. Visit its `*.apps.buildcustom.ai` URL.
19. Visit an existing generated application that was published before migration.
20. Visit `buyermagnets.com`.
21. Verify `www.buyermagnets.com` redirects to the root while preserving path/query.
22. Visit `app.buyermagnets.com`.
23. Log out; confirm the session is revoked.
24. Log back in.
25. Request project-aware SEO suggestions and verify generated and fallback behavior.
26. Attempt cross-user project, turn, release, deployment, and domain access; expect denial.
27. Verify Cloudflare logs show no Replit hostname, database, or secret dependency.
28. Run synthetic checks continuously through the stabilization period.
29. Keep Replit stopped for the owner-approved soak period. Success means the platform continues indefinitely, not only for one smoke test.

---

## 21. Rollback plan

Design rule: Replit remains intact and read-only until Cloudflare production is proven, but it is not a safe post-write fallback because its current authentication boundary is known to permit browser-supplied identity.

### Trigger conditions

- Authentication/session failure.
- D1 integrity or missing-data failure.
- ThinkAgent/realtime incompatibility.
- Preview/deploy failure above threshold.
- Domain management or KV routing corruption.
- Elevated cross-tenant/security risk.
- Unrecoverable Worker deployment issue.

### Procedure

1. Stop Cloudflare control-plane writes immediately.
2. Record the exact failure time and current Worker/D1 versions.
3. Before the first Cloudflare session or mutation is created:
   - Route `app.buildcustom.ai` back to the Replit target.
   - Re-enable Replit writes.
4. At the creation of the first owner canary session, permanently close DNS rollback to the current Replit application. The canary login is the exact point of no return because Replit cannot represent or enforce the hardened session boundary.
5. After that boundary, roll back only within Cloudflare:
   - Route traffic to the last known-good control-plane Worker version.
   - Keep the current D1 database if schema-compatible, or restore the pre-migration export into a new D1 database and reconcile ledgered writes forward.
   - Use `mutation_ledger` and `mutation_side_effects` to resume, compensate, or verify incomplete KV, Cloudflare hostname, and VibeSDK effects.
   - Never re-enable the old Replit application as a writer.
6. Do not roll back or alter VibeSDK, dispatch namespaces, gateway, generated apps, or custom hostnames unless evidence proves the failure is in those systems.
7. Verify authentication, hosted apps, and custom domains after rollback.
8. Publish an incident summary and new go/no-go criteria before retrying.

### Rollback point of no return

DNS rollback to the current Replit application is allowed only before the first Cloudflare session or mutation. After the owner begins the canary login, incidents roll forward or version-roll back entirely on Cloudflare. The implementation runbook must record that event timestamp and the maximum accepted data loss (target RPO: zero for ledgered control-plane writes).

### Data that can change after cutover

- Users/profile/password/session records.
- Projects and metadata.
- Agent link creation.
- Builder turns/releases.
- Hosted slug and deployment metadata.
- Domain claims and lifecycle state.
- Route KV mappings.

These mutations require audit events and idempotency to make rollback reconciliation possible.

---

## 22. Post-migration cleanup

### Keep temporarily

- Replit production code and PostgreSQL backup in read-only standby.
- Replit deployment configuration for the approved rollback period.
- All legacy/unknown Cloudflare resources.
- Old database exports and migration reports under secure retention.

### Remove after soak and owner approval

- Replit production deployment.
- Replit `DATABASE_URL` dependency.
- Replit production secrets for BuildCustom.
- Replit production CORS origins.
- Node/Express production entrypoint and PostgreSQL runtime dependencies if no longer needed for local tooling.
- `x-user-id` client/server code.
- Legacy admin credential flow.
- Boot-time schema mutation.

### Do not remove in this migration

- Current VibeSDK/ThinkAgent/SpaceDO resources.
- Existing dispatch namespaces or user Workers.
- Existing gateway, routes, route KV, hosted wildcard, fallback origin.
- Existing custom hostnames, DNS, SSL, or domain metadata.
- Legacy/unknown Cloudflare resources.
- Replit as an optional development environment, provided production has no dependency on it.

---

## 23. File-by-file implementation plan

### Modify

| File/area | Future change |
|---|---|
| `shared/schema.ts` | Split shared application types from PostgreSQL schema; add D1-compatible schema and sessions/audit/operations. |
| `server/routes.ts` | Port route handlers to Worker router modules; centralize auth/authorization; remove advisory locks and browser identity trust. |
| `server/storage.ts` | Replace PostgreSQL Drizzle adapter with D1 repository; keep logical interface where useful. |
| `server/runtime-adapter.ts` | Make Worker-compatible; move session/operation serialization to project Durable Object; preserve SDK behavior. |
| `server/custom-domains.ts` | Replace Node DNS/UDP path where needed; retain domain lifecycle logic and safe verification semantics. |
| `server/published-routes.ts` | Replace Cloudflare REST KV writes with direct KV binding; preserve record formats. |
| `server/project-preview-image.ts` | Use Browser Rendering binding or an isolated screenshot service. |
| `server/seo-suggestions.ts` | Port the direct model call and replace process-memory caching, or explicitly retire project-aware suggestions. |
| `server/index.ts` | Retire from production after Worker parity; keep only if needed for local compatibility. |
| `client/src/lib/auth.ts` | Remove localStorage user identity and `x-user-id`; use `/api/auth/me` and cookie sessions. |
| `client/src/lib/queryClient.ts` | Use same-origin credentials, CSRF/origin strategy, and normalized errors. |
| Admin client pages | Remove `isAuthenticated` localStorage gate; use server role. |
| `vite.config.ts` | Separate Replit development plugins from production Worker build. |
| `vite-plugin-meta-images.ts` | Remove Replit-domain production metadata rewriting; use explicit environment URLs. |
| `client/src/lib/api.ts` | Remove hardcoded Replit production API URL or convert to same-origin if still used. |
| `package.json` | Add Worker build/deploy/migration/test scripts; remove obsolete production dependencies after cutover. |
| Tests | Add auth, authorization, D1, DO serialization, migration, cutover, and no-Replit-dependency suites. |

### Create

- `wrangler.jsonc` or environment-specific Wrangler configuration.
- Worker entrypoint and route modules.
- D1 repository/schema/migrations.
- Project operation Durable Object.
- Session/auth middleware.
- Audit-event and idempotency utilities.
- PostgreSQL export/D1 import tooling with verification report.
- GitHub Actions CI, staging deploy, and approved production deploy workflows.
- Staging/production smoke tests and synthetic-check definitions.
- Runbooks for migration, cutover, rollback, and shutdown test.
- Mutation-ledger export/reconciliation tooling and read-only shadow comparison tooling.

### Leave untouched unless a proven compatibility issue appears

- `infrastructure/buildcustom-apps-gateway.js`.
- Existing VibeSDK Worker source/configuration outside this repository.
- Workers for Platforms dispatch/user Workers.
- Cloudflare for SaaS hostname objects.
- Customer DNS.
- Test1/generated application code.
- Workspace/revision/Artifact data.

---

## 24. Cloudflare resource plan

### Reuse

- `buildcustom.ai` zone.
- Existing marketing Pages project.
- Existing VibeSDK runtime and all active bindings.
- `buildcustom-vibesdk-staging` dispatch namespace for current production apps, despite the name.
- `buildcustom-apps-gateway`.
- `buildcustom-app-routes` KV.
- `*.apps.buildcustom.ai`.
- `fallback.buildcustom.ai`.
- Existing SaaS custom hostnames and certificates.
- Existing customer zones/DNS.

### Create during implementation, not during this audit

- Production control-plane Worker + static assets.
- Staging control-plane Worker + static assets.
- Production and staging control-plane D1 databases.
- Production and staging project Durable Object namespaces.
- An isolated migration-staging VibeSDK Worker/service with separate runtime authentication.
- Separate migration-staging VibeSDK D1, R2, KV, all required Durable Object namespaces, Worker Loader/Sandbox bindings, and logs.
- Staging route KV, staging gateway routes, and a staging-only generated-app dispatch namespace.
- Optional production/staging control-plane R2 asset buckets.
- Worker observability/alerts and synthetic checks.
- Least-privilege production/staging API tokens.

### Leave untouched

- All Legacy and Unknown resources in section 3.
- Existing VibeSDK D1/R2/KV/DO resources.
- Existing generated user Workers.
- Current gateway routes until a separately reviewed routing change is required.

### Naming gate

The current active runtime and dispatch namespace contain “staging” in their names. Do not rename them during migration. Renaming risks breaking bindings and mappings without delivering control-plane independence. Document the naming debt and address it only in a later, isolated migration.

---

## 25. Manual actions required from the owner

1. Confirm which database is the authoritative source for current BuildCustom users, projects, domains, and runtime links.
2. Review and authorize pushing the 84 local commits not present on `origin/main`.
3. Approve GitHub branch protection and production environment approval rules.
4. Approve creation of isolated staging and production control-plane Cloudflare resources.
5. Create or authorize least-privilege Cloudflare deployment and runtime API tokens; enter values through secret management only.
6. Confirm who owns production DNS approval for `app.buildcustom.ai`.
7. Confirm whether marketing `buildcustom.ai` remains on Pages during this migration. Recommendation: yes.
8. Confirm the email/password session architecture or choose an identity provider in a separate explicit decision. Recommendation: preserve current accounts initially.
9. Confirm the short maintenance-window strategy. Recommendation: use it at the observed scale.
10. Confirm the rollback retention and soak period before Replit production is dismantled.
11. Confirm whether any Stripe/billing system exists outside this repository.
12. Approve a staging-only test hostname and generated-app publish target.
13. Be available for go/no-go approval immediately before DNS cutover.
14. Approve final Replit shutdown only after the complete acceptance checklist passes.

No secret value should be pasted into an issue, migration document, repository file, or chat log.

---

## 26. Final acceptance checklist

### Source and deployment

- [ ] GitHub contains the complete reviewed source history.
- [ ] Protected branch and required CI checks are active.
- [ ] Staging and production deploy from GitHub without Replit.
- [ ] Production artifact/version and migrations are reproducible.

### Control plane

- [ ] BuildCustom frontend is served by Cloudflare.
- [ ] BuildCustom API is served by Cloudflare.
- [ ] D1 is the only production control-plane database.
- [ ] No production request uses Replit Postgres.
- [ ] No production secret is required from Replit.
- [ ] No production browser/server request uses a Replit hostname.

### Authentication/security

- [ ] Identity is server validated.
- [ ] No browser-supplied user ID is trusted.
- [ ] Session cookies are HttpOnly, Secure, SameSite, expiring, rotatable, and revocable.
- [ ] Logout invalidates the server session.
- [ ] Every admin endpoint requires an authorized role.
- [ ] Project, turn, release, deployment, domain, and workspace ownership checks pass.
- [ ] Cross-user/IDOR tests fail closed.
- [ ] CORS, Origin/CSRF, rate limiting, and secret boundaries are verified.
- [ ] Generated apps cannot access control-plane credentials or data.

### Data

- [ ] Authoritative source database is documented.
- [ ] Pre-migration backup was restored successfully in a rehearsal.
- [ ] Exact row counts match.
- [ ] Foreign keys and unique mappings pass.
- [ ] All IDs and external references are preserved.
- [ ] Project-agent-deployment-domain reconciliation is complete.

### VibeSDK and projects

- [ ] Existing projects list correctly.
- [ ] Existing `agent_id` mappings reconnect.
- [ ] Real files load.
- [ ] Plan mode remains non-mutating.
- [ ] Build generation works.
- [ ] Conversational edits affect the same workspace.
- [ ] Preview works.
- [ ] Cancellation and timeout recovery work.
- [ ] Revisions/restores work.
- [ ] ThinkAgent remains the native agent; no second agent layer exists.
- [ ] Staging generation, edits, files, preview, restore, cancellation, and deploy use only staging-created workspaces in an isolated VibeSDK stack.
- [ ] Staging has no credential, service binding, dispatch binding, or management token capable of mutating the active production VibeSDK runtime.
- [ ] Production `agent_id` and dispatch script access from staging fail closed.

### Publishing and domains

- [ ] New publish works through the existing Workers for Platforms path.
- [ ] Existing generated apps stayed live throughout migration.
- [ ] Existing hosted `*.apps.buildcustom.ai` URLs work.
- [ ] `buyermagnets.com` works.
- [ ] `www.buyermagnets.com` redirects correctly.
- [ ] `app.buyermagnets.com` works.
- [ ] SSL is active.
- [ ] Multi-hostname purpose/role routing works.
- [ ] Existing customers did not reconnect domains.
- [ ] No protected gateway, dispatch, VibeSDK, or hostname resource was replaced.

### Operations

- [ ] Structured logs, audit events, alerts, and synthetic checks are active.
- [ ] Rollback was rehearsed.
- [ ] Replit production is stopped.
- [ ] Replit database access is disabled.
- [ ] Replit production secrets are removed or no longer referenced.
- [ ] Full shutdown test passes in a clean browser.
- [ ] Approved soak period passes with Replit still off.
- [ ] BuildCustom can continue operating indefinitely with Replit production offline.

---

## Decision gates before implementation

1. Authoritative source database.
2. Session/authentication implementation.
3. Workflow and Durable Object compatibility with the VibeSDK SDK, including reconnect, retry, cancellation, and five-minute operations.
4. R2 migration for image bytes.
5. Short maintenance window approval.
6. GitHub history/source reconciliation.
7. Staging/production resource creation and least-privilege credentials.

Until these gates are approved, this document remains a migration design only.