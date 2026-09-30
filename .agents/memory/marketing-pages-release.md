---
name: Marketing Pages release
description: Safe release boundary for the separate GitHub-connected marketing Pages site.
---

Marketing production releases now use GitHub main → GitHub Actions clean npm build → Wrangler direct upload → the existing Cloudflare Pages project. Its older Pages Git integration remains connected as source metadata, but automatic push-triggered deployments are disabled. A direct-upload release does not update the connected GitHub production branch; maintain GitHub as the canonical source.

**Why:** The Pages project previously built automatically from GitHub while Actions also uploaded a separate build from the same push, leaving two competing production deployments. The clean-install blocker was private Replit package URLs in the lockfile, not a need for a second build authority. Keeping automatic Pages Git builds disabled avoids duplicate or surprising promotions.

**How to apply:** Before future marketing releases, build and test the exact GitHub commit, let the Actions workflow deploy it, and verify the live hashed asset plus signup links and absence of the retired waitlist flow. Avoid direct/manual Pages uploads unless they are deliberately reconciled back to GitHub. Keep Replit production running until a separately approved final shutdown.