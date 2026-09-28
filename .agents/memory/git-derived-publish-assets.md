---
name: Git-derived publish assets
description: Why first-publication file requirements must follow the authoritative Git tree rather than an older project's layout.
---

An immutable publication's file requirements must be derived from the current authoritative Git tree and its HTML references. A valid first-generation project may put CSS inline and have no separate stylesheet. Preserve byte-for-byte verification of each authoritative file that exists, and fail when HTML references an absent asset.

**Why:** A preserved new-user project had committed, previewable HTML containing its acceptance marker but could not publish because a validator copied the known-good older project's assumption that every public tree has a separate stylesheet. The conversation's zero-changed-files label was synthesized reporting metadata and not evidence of a missing Git commit.

**How to apply:** When extending Publish or adding generated-app templates, compare the exact revision tree with HTML asset references before enforcing required files. Do not relax Git revision checks, candidate-first verification, or rendered-asset checks to work around differing templates.