---
name: Pages install diagnosis
description: Evidence limits and toolchain constraints for a Cloudflare Pages clean-install failure.
---

A Pages `npm clean-install` failure ending in “Exit handler never called” is not enough to identify a dependency or lockfile defect. A clean checkout succeeded under the same Node/npm pair reported by the failed Pages job. The original npm debug log was not available, so the underlying failure remained unknown. Pinning Node via `.nvmrc` improves repeatability but is not proof of a cure.

**Why:** Pages chooses its own package-manager version unless explicitly configured to override it; `package.json` engine metadata is not a Pages version-selection mechanism. An exact npm engine requirement enforced by `engine-strict` could make a later Pages job fail with `EBADENGINE` independently of the original issue.

**How to apply:** Before claiming the Pages failure is fixed, collect the failing job's npm debug log or reproduce its mechanism in a fresh checkout under the actual Pages Node/npm versions. Avoid strict npm engine checks unless the Pages npm version is guaranteed; validate a full clean install and build without changing the live Pages settings during local preparation.