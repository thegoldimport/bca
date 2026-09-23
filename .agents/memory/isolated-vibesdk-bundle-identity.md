---
name: Isolated VibeSDK bundle identity
description: Avoid accidentally deploying unchanged workspace-package code from a shared dependency directory during isolated canaries.
---

When an isolated VibeSDK checkout borrows `node_modules` from another checkout, its local Worker imports of workspace packages may resolve to the borrowed checkout's source or dist, not to the isolated candidate. Verify the dry-run Worker bundle contains a unique marker from the intended changed SpaceDO code before deploying, or explicitly alias that workspace package to the rebuilt candidate package.

**Why:** A disposable test Worker built with the fixed checkout still ran the unmodified SpaceDO because the shared `node_modules` pointed its workspace-package symlink at the original baseline. The first live canary reproduced the old mixed tree, while a later dry-run inspection revealed the new restore guard was absent. Only a verified candidate-package alias yielded a true fixed-code canary.

**How to apply:** For future isolated canaries using shared dependencies, inspect package symlink targets and the built Worker bundle before consuming a model run. A deployment succeeding or showing a new Worker version does not prove the intended source was bundled.