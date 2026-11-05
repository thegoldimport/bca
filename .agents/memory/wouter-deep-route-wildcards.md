---
name: Wouter deep-route wildcards
description: Wouter's regexparam matcher treats `:name*` as one path segment rather than a multi-segment catch-all.
---

For Wouter routes that must match nested paths, use a standalone wildcard segment such as `/app/*`. Do not use `/app/:rest*` as a catch-all; regexparam parses it as one non-slash segment, so deeper routes fall through to NotFound.

**Why:** A deployed deep Admin URL returned 404 even though its inner route and component existed; the outer matcher did not accept multiple path segments.

**How to apply:** When changing a Wouter route that receives nested URLs, test the actual route string with `regexparam.parse(...).pattern` against a path containing multiple segments.
