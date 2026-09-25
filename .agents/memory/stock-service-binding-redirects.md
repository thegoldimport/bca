---
name: Stock service-binding redirects
description: Redirect handling differs for staging Worker-to-Worker stock runtime requests.
---

For owner-bound requests through the stock runtime service binding, `redirect: "error"` caused the staging fetch to fail before returning a response. `redirect: "manual"` worked; safety still requires explicit rejection of 3xx responses and unexpected response origins.

**Why:** A stock CSRF bootstrap succeeded over the public owner-authorized route but failed through the staging service binding until redirect handling changed, while other bound reads were healthy.

**How to apply:** When adding a pinned Worker-to-Worker runtime request, use manual redirect handling with explicit status and origin checks. Do not replace the service binding with a public fetch or forward owner credentials to a redirected destination.