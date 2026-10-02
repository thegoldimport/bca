---
name: Public generated API acceptance
description: Public HTML success and immutable route verification do not prove the generated backend works.
---

Validate generated API content in a signed-out visitor context at the actual public app hostname, independently of private-preview acceptance and publication success.

**Why:** An initial immutable publication returned success and the expected revision-specific route, while the public CRM's leads API returned HTTP 200 with an HTML document instead of JSON. The UI rendered with zero leads; the unchanged private preview still returned twelve leads. This was a public backend failure, not isolated production data or optional observer failure.

**How to apply:** Check media type, body shape, and rendered data, not HTTP status alone. Separate intentional preview/public persistence isolation from an API that serves HTML. Stop before further edits or publishing after such a failure; do not retry a mutation or infer a root cause without authorization.