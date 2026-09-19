---
name: Custom-domain Live gate
description: End-to-end routing requirement for declaring primary and redirect custom hostnames Live.
---

Never mark a custom domain Live based only on provider hostname status, SSL status, or an internal route mapping. Probe the public customer hostname and require proof that traffic reaches the expected project.

**Why:** Internal mapping checks can pass while stale DNS, custom-origin errors, or gateway routing still sends customers to an old site or an error page.

**How to apply:** For a primary hostname, require a no-store customer-host response containing the expected project identity and route context. For a secondary hostname, require an exact permanent redirect to the primary that preserves the probe path and query. Keep the status at Connecting on any mismatch or timeout.