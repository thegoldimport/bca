# Cloudflare control-plane parity matrix

Baseline: current `client/` calls and `server/routes.ts` compared with `cloudflare/worker.ts` before this parity implementation. This is an implementation checklist, not permission to modify production resources. `P` means an endpoint exists but behavior, response, authorization, or side effects need work; `M` means absent; `A` means already present. Paths with `:id` are project-scoped unless noted.

| Current frontend API (method and path) | Baseline | Required parity work |
|---|---|---|
| POST `/api/auth/register` | P | Preserve configured registration gate and secure session model. |
| POST `/api/auth/login`; GET `/api/auth/me`; POST `/api/auth/logout` | A | Verify cookie session and client logout behavior. |
| PUT `/api/auth/profile`; PUT `/api/auth/password` | A | Verify ownership and session checks. |
| GET `/api/projects`; GET `/api/projects/:id` | P | Preserve preview/image and deployment metadata needed by UI. |
| POST `/api/projects`; PUT `/api/projects/:id` | P | Preserve input and template-created project contracts. |
| DELETE `/api/projects/:id` | P | Clean up only the owned project's published route/domain records and isolated route KV, with rollback on failure. |
| GET `/api/projects/:id/runtime/status` | P | Include current preview-image/status response fields. |
| GET `/api/projects/:id/runtime/files`; GET `/files/content?path=` | A | Keep VibeSDK-owned files through the narrow adapter. |
| GET `/api/projects/:id/runtime/console` | M | Return the existing synthetic status/console format. |
| POST `/api/projects/:id/runtime/messages` | P | Validate builder contract and preserve staging mutation gate. |
| GET `/api/projects/:id/runtime/turns`; POST `/turns/:turnId/restore` | A | Preserve historical turns and native restore. |
| POST `/api/projects/:id/runtime/previews`; POST `/stop` | A | Preserve native VibeSDK operations and gate. |
| POST `/api/projects/:id/runtime/deployments` | P | Preserve release, route, deployment, and hosting behavior using isolated resources. |
| GET `/api/projects/:id/runtime/releases`; POST `/releases/:releaseId/restore` | A | Preserve native restore and release history. |
| GET/PUT `/api/projects/:id/runtime/publishing-settings` | P | Validate slug/provider and route/domain interactions. |
| GET `/api/projects/:id/runtime/custom-domain`; GET `/domains` | M | Read domain claims and connection state. |
| POST/DELETE `/api/projects/:id/runtime/custom-domain`; POST `/custom-domain/refresh` | M | Preserve lifecycle and protected production-hostname boundary. |
| POST `/api/projects/:id/runtime/custom-domain/inspect`; POST `/import-dns`; POST `/configure` | M | Preserve DNS migration wizard, source labels, and validation. |
| POST/DELETE `/api/projects/:id/runtime/application-domain`; POST `/application-domain/refresh` | M | Preserve application-hostname claims and status. |
| GET `/api/projects/:id/blog-posts`; POST `/blog-posts`; PUT/DELETE `/blog-posts/:postId` | M | Owner-scoped CRUD, response serialization. |
| GET/PUT `/api/projects/:id/autoblogger` | M | Owner-scoped settings only; no automation scheduler exists in current Express route. |
| GET `/api/projects/:id/seo`; GET `/seo/suggestions`; PUT `/seo` | M | Owner-scoped settings, suggestions, public URL contract. |
| POST/DELETE `/api/projects/:id/seo/social-image` | M | Store/clear validated image without returning private image data. |
| GET `/api/public/projects/:id/preview-image`; GET `/social-image` | M | Public binary image routes for crawlers, no session required. |
| GET `/api/projects/:id/pages`; POST `/pages`; PUT/DELETE `/pages/:pageId` | M | Owner-scoped page CRUD (including page ownership on update/delete). |
| GET `/api/templates`; GET `/api/templates/:slug` | M | List/detail from D1; preserve JSON-array tags. |
| POST `/api/waitlist` | M | Public submission and validation. |
| POST `/api/admin/login`; GET `/api/admin/waitlist`; DELETE `/api/admin/waitlist/:id` | M | Replace legacy shared admin password/localStorage flag with secure cookie and server-side role checks. |

Additional Express-only routes are classified as **development-only** only when no current product frontend calls them; none of the `M` rows above is exempt on that basis. `client/src/lib/api.ts` currently sends waitlist/admin requests to a Replit URL on non-Replit hosts: **remove this production dependency after same-origin endpoints exist**. Replit Node hosting, PostgreSQL export, and Vite dev plugins are migration/development tools, not Cloudflare runtime features.

Safety boundary: implementation and mutation tests use the isolated staging D1, KV, VibeSDK service, and staging gateway only. No production D1, active VibeSDK namespace, generated production Worker, Buyer Magnets hostname, or `app.buildcustom.ai` change is authorized.

## Result after staging implementation

`Implemented` means the route is wired through the Cloudflare Worker and its relevant product flow was exercised or unit-tested; it does **not** imply all related external integrations are configured. `Partial` means a current-product behavior remains unverified or deliberately blocked.

| Baseline API rows | Final status | Remaining qualification |
|---|---|---|
| Auth login/me/logout/profile/password | Implemented | Secure D1-backed cookie; login/me/logout exercised with the Replit server stopped. |
| Auth register | Partial | Endpoint implemented; registration remains intentionally closed by staging configuration. |
| Project list/create/read/update | Implemented | D1 owner scope and preview-image URL field. |
| Project deletion | Partial | Staging D1, route KV, preview KV, and hostname mapping cleanup exercised; live SaaS-hostname teardown requires isolated staging zone credentials. |
| Runtime status/files/content/turns, console | Implemented | Status/console exercised on an ungenerated project; generated-agent files require separate isolated agent testing. |
| Runtime messages/preview/stop/turn restore/release restore | Partial | Adapter code remains wired and unit tested; live generated-agent mutations were not run against this acceptance account. |
| Runtime deploy/release/publishing-settings | Partial | Release and isolated route KV writes exist; no isolated staging gateway routes a public managed URL, and live publishing was not executed. Published slug changes are blocked. |
| Blog CRUD, autoblogger GET/PUT | Implemented | Owner-scoped staging CRUD exercised; no autoblogger scheduler exists in the current Express implementation. |
| SEO GET/PUT/social-image POST/DELETE | Implemented with limitation | Staging CRUD exercised; published KV metadata refresh tested. New publish does not capture a public preview screenshot. |
| SEO suggestions | Partial | Bounded VibeSDK file reads and provider call implemented; staging lacks a dedicated `GOOGLE_AI_STUDIO_API_KEY` Worker secret and a generated-agent end-to-end test. |
| Public preview/social images | Implemented with limitation | Binary serving and validation tested; newly published preview capture is absent. |
| Pages CRUD; templates list/detail | Implemented | Owner-scoped staging page CRUD; existing D1 templates served. |
| Public waitlist; admin login/waitlist list/delete/status | Implemented | Admin now uses D1 role and secure cookie, not the legacy shared password. |
| Custom/application domain list/status, DNS inspect/import/configure | Partial | Staging metadata APIs wired; DNS wizard paths are unit-tested but not end-to-end exercised on an isolated customer hostname. |
| Custom/application domain add/remove/refresh | Blocked | Explicit 503 for Cloudflare for SaaS mutation without a separately scoped staging zone/credential. The account-wide credential is not an isolation boundary. |
| Replit API fallback | Removed | Admin and waitlist are same-origin; no compiled staging frontend request targets the Replit API. |

No D1 schema migration was required: the baseline D1 migration already contains the tables and fields used here. The project did **not** re-import PostgreSQL, deploy the frozen VibeSDK fixes, or attach a production hostname.