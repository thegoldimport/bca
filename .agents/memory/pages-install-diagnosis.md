---
name: Pages install diagnosis
description: Evidence limits and toolchain constraints for a Cloudflare Pages clean-install failure.
---

A Pages `npm clean-install` failure ending in “Exit handler never called” is not enough to identify a dependency or lockfile defect. Clean checkouts succeeded with the exact failing Pages command under both its reported Node 22.22.0/npm 10.9.2 pair and Node 22.22.0/npm 10.9.4. A subsequent GitHub-triggered Pages build still failed with the npm error under 22.22.0/10.9.2. The npm debug files named by Pages logs were not available through the deployment-log API, so the underlying failure remained unknown. Pinning Node via `.nvmrc` improves repeatability but is not a cure by itself.

**Why:** Pages v3 chooses its own package-manager version unless explicitly configured with `NPM_VERSION`; it selected npm 10.9.2 despite npm 10.9.4 in `package.json` engines. Engine metadata is not a Pages version-selection mechanism. An exact npm engine requirement enforced by `engine-strict` could make a later Pages job fail with `EBADENGINE` independently of the original issue. Pages supports `SKIP_DEPENDENCY_INSTALL` to bypass its automatic install, but running the same npm command manually is not evidence of a fix.

**How to apply:** Before claiming the Pages failure is fixed, collect the failing job's npm debug log or reproduce its mechanism in a fresh checkout under the actual Pages Node/npm versions. Avoid strict npm engine checks unless the Pages npm version is guaranteed; validate a full clean install and build without changing the live Pages settings during local preparation.