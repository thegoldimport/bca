---
name: Cloudflare control-plane migration
description: Durable architecture and safety decisions for moving BuildCustom production control-plane ownership off Replit.
---

Move only the BuildCustom control plane to Cloudflare. Preserve the existing ThinkAgent/VibeSDK, SpaceDO/Artifacts, Workers for Platforms, gateway/KV routing, generated Workers, hosted URLs, Cloudflare for SaaS hostnames, and customer DNS.

Use D1 for relational control-plane data, a per-project Durable Object for serialization, and Cloudflare Workflows for durable multi-minute runtime operations. Use server-validated HttpOnly sessions; never preserve browser-supplied identity as a compatibility path.

Migration staging requires a completely separate mutable VibeSDK stack, including runtime Worker, credentials, D1/R2/KV, Durable Objects, Worker Loader/Sandbox bindings, and generated-app dispatch namespace. The active resources containing “staging” in their names are production and cannot be used for staging mutation tests.

The first Cloudflare canary session is the point of no return for DNS rollback to the current Replit application. After that event, failures must roll forward or version-roll back entirely on Cloudflare because restoring Replit would reintroduce its insecure authentication boundary.

**Why:** The proven publishing/runtime system already lives on Cloudflare and must not be rebuilt. The current Replit control plane combines PostgreSQL-only behavior, process-memory coordination, and browser-trusted identity. A broad migration would add unnecessary risk, while post-write rollback to that identity model would be a security regression.

**How to apply:** Treat `docs/cloudflare-control-plane-migration-audit.md` as the approved design candidate. Keep implementation blocked on its explicit owner gates, use isolated staging, preserve all external IDs/mappings, and require full shutdown-test evidence before removing Replit standby.