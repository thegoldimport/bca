# Cloudflare/VibeSDK architecture simplification review

Status: implementation and staging verification are in progress. This is an
architecture decision record for Task #53; it does not claim that the
simplified control plane or publish flow has passed its acceptance tests.

## Evidence and sources

The review uses the installed VibeSDK package and the current Cloudflare
reference documentation:

- Cloudflare, [AI Vibe Coding Platform reference
  architecture](https://developers.cloudflare.com/reference-architecture/diagrams/ai/ai-vibe-coding-platform/index.md).
- Cloudflare, [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms)
  and [How Workers for Platforms
  works](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/how-workers-for-platforms-works/index.md).
- Cloudflare, [Workers for Platforms
  API](https://developers.cloudflare.com/api/resources/workers_for_platforms).
- Installed `@cf-vibesdk/sdk` version `0.0.9` in
  `node_modules/@cf-vibesdk/sdk/package.json`.
- Installed SDK public exports and runtime protocol in
  `node_modules/@cf-vibesdk/sdk/dist/index.d.ts` and
  `node_modules/@cf-vibesdk/sdk/dist/index.js`.
- Existing implementation and evidence in
  `server/runtime-adapter.ts`, `docs/cloudflare-staging-report.md`,
  `cloudflare/staging/`, and `tests/`.

The Cloudflare reference architecture assigns generation and sandboxed
development to the coding platform, then deploys isolated applications as
Workers for Platforms User Workers. Workers for Platforms describes a
dispatch namespace as the container for customer Workers and a dynamic
dispatch Worker as the routing layer. BuildCustom therefore supplies the
account, product, authorization, and domain experience around those services;
it does not create a second coding platform.

## Decision matrix

| Component | Decision | Ownership and rationale |
| --- | --- | --- |
| ThinkAgent/native coding agent | **A — Official Cloudflare/VibeSDK** | Use the VibeSDK ThinkAgent as the only reasoning loop. BuildCustom brands and authorizes it but does not add a BuildCustom agent. |
| SpaceDO and agent/workspace state | **A — Official Cloudflare/VibeSDK** | VibeSDK owns the durable agent/workspace connection. BuildCustom stores only the stable `agent_id` mapping needed to reconnect. |
| Artifacts and generated project files | **A — Official Cloudflare/VibeSDK** | VibeSDK's workspace is authoritative. Do not copy source files into BuildCustom D1 or create a second file store. |
| Sandbox/code execution | **A — Official Cloudflare/VibeSDK** | Use the platform's sandbox and execution path; BuildCustom should only authorize the project action. |
| Preview | **A — Official Cloudflare/VibeSDK** | Use the SDK preview deployment and protected preview URL. BuildCustom records the URL/metadata needed by its UI. |
| Revisions/history | **A — Official Cloudflare/VibeSDK** | Use runtime commit/revision events and restore protocol where supported. BuildCustom stores release metadata needed for its product UI, not a duplicate revision engine. |
| Generated-app deployment | **A — Official Cloudflare/VibeSDK** | Use the supported VibeSDK platform deployment operation rather than a second uploader or deployment service. |
| Workers for Platforms | **A — Official Cloudflare** | Generated applications are individual User Workers in the appropriate namespace, not one namespace per customer. |
| Dispatch namespaces | **A — Official Cloudflare** | Keep separate staging and production namespaces in the existing account. Application target validation remains a narrow safety check. |
| Gateway/dynamic dispatch | **A — Official Cloudflare / existing infrastructure** | Preserve the existing gateway and route KV. BuildCustom owns the mapping from a published project to its hosted slug. |
| Cloudflare for SaaS/custom domains | **A — Official Cloudflare / existing infrastructure** | Preserve hostname, SSL, DNS, and routing mechanisms; BuildCustom owns domain UX, claims, and project authorization. |
| BuildCustom control-plane Worker and Static Assets | **B — Required BuildCustom SaaS layer** | This is the product API and dashboard boundary for accounts, sessions, projects, settings, authorization, and runtime metadata. |
| BuildCustom D1 | **B — Required BuildCustom SaaS layer** | Store users, sessions, projects, ownership, agent mappings, plans/entitlements, deployment metadata, domains, releases, and audit data. Do not store VibeSDK workspace state. |
| Control-plane R2 | **D — Unnecessary duplication for current scope** | The current small control-plane snapshot fits D1 and the only runtime R2 bucket is for VibeSDK templates. Create a control-plane R2 bucket only when measured binary growth requires it. |
| BuildCustom authentication | **B — Required BuildCustom SaaS layer** | Cloudflare/VibeSDK does not provide BuildCustom account identity. Keep opaque hashed sessions, HttpOnly/Secure/SameSite cookies, revocation, server-side identity, Origin checks, and rate limiting. |
| Project/domain/deployment ownership | **B — Required BuildCustom SaaS layer** | These are BuildCustom business permissions and must be enforced before calling VibeSDK or Cloudflare APIs. |
| Project-to-agent mapping | **B — Required BuildCustom SaaS layer** | A minimal mapping reconnects a BuildCustom project to the existing VibeSDK `agent_id`; it must preserve imported production mappings as read-only. |
| Cloudflare Workflow | **D — Remove unless acceptance evidence proves a need** | The current VibeSDK session owns long-running generation and reconnect state. A Workflow would add a second operation lifecycle and cannot make external SDK calls idempotent by itself. Retain only if a tested Worker-disconnect/retry requirement cannot be met by direct reconnect and a minimal status record. |
| BuildCustom project Durable Object | **D — Remove unless acceptance evidence proves a need** | The current lease serializes requests, but VibeSDK/SpaceDO already serializes agent workspace state. It can reject legitimate work and create lock divergence. Retain only for a demonstrated BuildCustom-only coordination rule not provided by VibeSDK. |
| Operation ledger | **B/C — Minimal status record only when needed** | A small record is justified for user-visible asynchronous status, cancellation authorization, idempotency, and audit. It must not become a second workspace/revision ledger. Synchronous SDK actions do not need an operation row. |
| Mutation ledger | **D — Unnecessary duplication** | D1 audit events and VibeSDK/runtime state are sufficient for current scope. Add a separate mutation ledger only after a concrete audit or recovery requirement is demonstrated. |
| Custom queues | **D — Unnecessary duplication** | No current requirement justifies a queue in addition to VibeSDK's durable session protocol and direct Worker request. |
| Publish broker | **D — Unnecessary duplication** | VibeSDK already implements the platform upload path. A generic broker would duplicate it and add an avoidable credential proxy. |
| Deployment adapter | **C — Required narrow adapter** | BuildCustom must select an authorized project/agent, target the staging namespace, translate product metadata, and call the supported VibeSDK operation. It must not proxy arbitrary Cloudflare API requests. |
| Session caching | **D — Unnecessary duplication** | D1 remains authoritative for revocation and expiry. In-memory SDK sessions may be an implementation optimization, but they are not durable state and cannot be the auth boundary. Reconnect with `agent_id` after eviction. |
| Duplicated project-file storage | **D — Remove** | VibeSDK workspace files are authoritative. BuildCustom should request file listings/content through the adapter and may cache derived display metadata only if required by the UI. |

## Why direct reconnect by `agent_id` is sufficient

The installed SDK exposes `VibeClient.connect(agentId)` and `BuildSession.connect`.
The SDK reconnects through the runtime's authenticated connect endpoint, obtains
a fresh short-lived WebSocket ticket, and hydrates workspace/state from the
runtime. This is the supported durable boundary:

1. BuildCustom persists the project ownership and `agent_id` mapping in D1.
2. A Worker request authenticates the BuildCustom session and verifies project
   ownership.
3. The narrow adapter calls `connect(agent_id)` against the isolated runtime.
4. The SDK obtains a fresh ticket and reconnects to the runtime's workspace.
5. Files, preview state, generation state, and runtime revisions remain owned
   by VibeSDK.

The previous process-memory `Map<number, BuildSession>` is not a durable
requirement. If a Worker instance is evicted, the next request reconnects by
`agent_id`; no BuildCustom session reference needs to survive eviction. A
minimal operation row remains appropriate only when the browser needs a
reconnectable status URL for a long request. It does not replace runtime state.

## Failure modes and retention criteria

### Workflow

Without a Workflow, a client disconnect can lose an in-flight HTTP response.
That is a UX concern, not proof that BuildCustom should own generation
orchestration: the runtime remains durable and can be reconnected by
`agent_id`. A Workflow also cannot safely retry a non-idempotent external
publish or build unless the runtime supplies an idempotency key and terminal
state. Retain it only after a staging test demonstrates a required durable
control-plane action that direct reconnect and a minimal status row cannot
provide.

### Project Durable Object

Without the project DO, two BuildCustom mutations can arrive concurrently.
VibeSDK/SpaceDO remains responsible for workspace serialization. A DO is
justified only if BuildCustom has an independent invariant, such as one
authorized publish per project, that the runtime cannot enforce. If retained,
the invariant and recovery test must be documented; a generic lease is not
enough.

### Operation row

Without a status row, a browser cannot query a durable BuildCustom operation
after a request disconnects, and duplicate POSTs are harder to reject. This is
the only custom state worth retaining for asynchronous product UX. It must be
guarded by terminal-state transitions and must never claim success before the
VibeSDK operation reports success.

## Credential and publishing decision

The owner has accepted Cloudflare's normal same-account Workers for Platforms
model. A trusted server-side VibeSDK deployment path may hold the account-level
credential required by the current dispatch upload API. The credential must:

- remain in a Worker secret/server-side runtime;
- never be bundled into browser assets;
- never be passed to generated code or user-controlled prompts/files;
- never be returned in a response or written to logs;
- be minimized to the permissions required by the supported deployment path;
- be guarded by BuildCustom authentication, project ownership, staging target
  checks, and audit records.

This is an application-level staging/production target boundary, not a claim
that Cloudflare's account-scoped token is namespace-scoped. No custom publish
broker is needed unless the supported VibeSDK path cannot be called directly.

## Scope and stop point

This review does not authorize attaching `app.buildcustom.ai`, modifying
production routes, changing customer applications/domains, shutting down
Replit, or provisioning generated-app databases/auth/storage. Implementation
must stop after isolated staging tests and a redacted evidence report.