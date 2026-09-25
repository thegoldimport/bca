---
name: Staging publish recovery safety
description: Prevent recovery requests from becoming repeat deployments and verify stock script identities through the lab gateway.
---

Rule: An operation that must never redeploy needs a distinct route that older control-plane versions reject. Do not distinguish recovery from Publish only by a new request-body flag on the existing deploy route.

**Why:** During a staging Worker rollout, a recovery request with a new body flag reached an older handler and followed its destructive deploy path. A successful deployment command can be repeated even when the caller intended only to reconcile metadata.

**How to apply:** Make a recovery-only path fail closed in older versions, verify ownership and source content, and never retry the stock deploy while investigating an uncertain result. Check dispatch history if an old route may have received the request.

Rule: Treat a stock platform URL as a script-identity hint only after exact hostname validation; verify the actual script on the lab dispatch hostname.

**Why:** When stock's custom preview domain is unset, its success state can contain a synthetic Worker-subdomain URL that does not serve the dispatched app, even though the upload succeeded.

**How to apply:** Derive the dispatch hostname from the validated script identity, compare served files to the authoritative revision, and verify the customer hostname before recording a release.