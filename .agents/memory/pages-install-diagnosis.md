---
name: Pages install diagnosis
description: Internal package-firewall URLs in npm lockfiles can break external CI even when installs inside Replit succeed.
---

An npm `clean-install` failure ending in “Exit handler never called” is not enough to identify an npm bug. Clean checkouts inside Replit succeeded with the exact failing Pages command under both Node 22.22.0/npm 10.9.2 and Node 22.22.0/npm 10.9.4. GitHub Actions' preserved npm log showed that tarball URLs persisted in the lockfile targeted `package-firewall.replit.internal`, which the runner could not resolve (`ENOTFOUND` across repeated attempts). npm's exit-handler message followed those failed fetches; no lifecycle child or stack trace was recorded. The Cloudflare Pages run had the same symptom and source, but its private debug log was unavailable, so its exact mechanism was not separately proven.

**Why:** A Replit-internal registry URL in a committed lockfile is reachable from the development environment but not necessarily from an independent build runner. Pinning Node/npm, moving the same npm command into a custom Pages step, or retrying cannot correct that URL. Pages v3 also ignores npm engine metadata for its own version selection; the version mismatch was a separate issue, not the diagnosed GitHub CI cause.

**How to apply:** For external builds, inspect the hostnames of lockfile `resolved` tarball URLs; keep versions and integrity hashes unchanged when making a separately approved portable-URL correction. Validate installs in external CI rather than relying on a successful Replit-local install. Do not claim an independent Pages root cause without its log.