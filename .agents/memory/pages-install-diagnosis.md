---
name: Pages install diagnosis
description: Evidence limits for npm clean-install failures in both Cloudflare Pages and GitHub Actions.
---

An npm `clean-install` failure ending in “Exit handler never called” is not enough to identify a dependency or lockfile defect. Clean checkouts succeeded with the exact failing Pages command under both its reported Node 22.22.0/npm 10.9.2 pair and Node 22.22.0/npm 10.9.4. Both the Git-integrated Pages build and a later GitHub Actions `npm ci` failed with the same npm error after roughly a minute, before compiling or uploading. The referenced npm debug files are inside ephemeral CI runners and were not exposed in either build log, so the common underlying failure remains unknown. Do not describe the problem as isolated to Pages.

**Why:** Pages v3 chooses its own package-manager version unless explicitly configured with `NPM_VERSION`; it selected npm 10.9.2 despite npm 10.9.4 in `package.json` engines. Engine metadata is not a Pages version-selection mechanism. An exact npm engine requirement enforced by `engine-strict` could make a later Pages job fail with `EBADENGINE` independently of the original issue. Pages supports `SKIP_DEPENDENCY_INSTALL` to bypass its automatic install, but running the same npm command manually is not evidence of a fix.

**How to apply:** Before claiming either CI failure is fixed, collect the failing runner's npm debug log or reproduce its mechanism under comparable CI conditions. Avoid strict npm engine checks unless the Pages npm version is guaranteed; a successful local clean install does not prove remote CI will work.