---
name: Nameserver activation verification
description: Safety rule for recognizing customer nameserver changes without waiting on stale recursive DNS caches.
---

Treat the parent registry delegation as the source of truth, then require direct authoritative answers from every expected nameserver before activating a domain migration. Recursive resolver results may be displayed, but must never authorize activation.

**Why:** Recursive resolvers can retain the old delegation after the registrar and authoritative provider already recognize the change. Accepting them delays customers; trusting a single fresh resolver creates a false-activation risk.

**How to apply:** Require strict parent-server consensus on the exact expected nameserver set, confirm the expected servers answer authoritatively for the zone, bound all network checks, and fail closed if direct verification is unavailable.