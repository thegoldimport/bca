---
name: Local remote D1 bootstrap
description: Local Wrangler Worker remote D1 bindings can fail independently of Wrangler's remote D1 CLI.
---

A localhost-only Wrangler Worker configured with a remote D1 binding is not automatically a viable private account-bootstrap path. In this launch environment the registration request reached normal runtime logic but the first D1 query failed; a separate read-only local Worker probe using the same remote binding also returned a Cloudflare internal error. Wrangler's remote D1 CLI could read the same database, so CLI access did not validate the Worker binding path.

**Why:** Retrying an ambiguous normal registration or opening a public registration window would risk duplicate or unauthorized accounts. The remote database must be checked for the intended account after a failed attempt before any alternative is considered.

**How to apply:** Test local remote-binding viability with a read-only Worker probe before requesting credentials or sending a registration request. Keep the public runtime registration gate closed; if the private binding fails, stop and seek a separately approved private bootstrap rather than writing a password directly into D1.