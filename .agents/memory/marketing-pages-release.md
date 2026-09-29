---
name: Marketing Pages release
description: Safe release boundary for the separate GitHub-connected marketing Pages site.
---

For a narrow marketing change, preserve the current successful Pages deployment's full file inventory and change only the intended browser asset, with a new hashed filename and updated HTML reference. Keep the previous hashed asset available during cache convergence. A direct-upload Pages release does not update the connected GitHub production branch.

**Why:** The live marketing site is a separate Pages project, while the current workspace also builds a much larger application bundle. Uploading that worktree as the marketing site would risk changing unrelated marketing behavior. The GitHub-connected Pages build history included failures after its last successful marketing release, so a direct upload of a complete, verified baseline was used to limit the change.

**How to apply:** Before future marketing releases, compare the live Pages deployment and its file manifest with the source checkout, verify signup links and absence of the retired waitlist flow, and reconcile the GitHub build so a later successful push does not inadvertently replace a direct-upload release.