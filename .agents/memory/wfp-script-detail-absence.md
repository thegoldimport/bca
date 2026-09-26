---
name: Workers for Platforms script-detail absence
description: The script-detail API and shared gateway report nonexistent dispatch scripts differently.
---

The Workers for Platforms script-detail GET can return HTTP 200 and `success: true` for an unused script name. Its result contains the dispatch namespace but `script: null`. An occupied name returns a matching `result.script.id`. A shared dispatch gateway may instead return HTTP 500 for an unused name; neither HTTP status by itself establishes script existence.

**Why:** A status-only create-once preflight would have rejected a genuinely absent release script before upload, while a gateway status-only preflight could not distinguish absence from a broken existing script.

**How to apply:** Inspect the authoritative account API response envelope and matching namespace/script identity before a one-time dispatch upload. Treat malformed or unexpected responses as unknown and fail closed. Do not use the gateway's HTTP 500 as proof of absence.