---
name: Marketing Pages release
description: Safe release boundary for the separate GitHub-connected marketing Pages site.
---

Marketing production releases now use GitHub main → GitHub Actions clean npm build → Wrangler direct upload → the existing Cloudflare Pages project. Its older Pages Git integration remains connected as source metadata, but automatic push-triggered deployments are disabled. A direct-upload release does not update the connected GitHub production branch; maintain GitHub as the canonical source.

**Why:** The Pages project previously built automatically from GitHub while Actions also uploaded a separate build from the same push, leaving two competing production deployments. The clean-install blocker was private Replit package URLs in the lockfile, not a need for a second build authority. Keeping automatic Pages Git builds disabled avoids duplicate or surprising promotions.

**How to apply:** Before future marketing releases, build and test the exact GitHub commit, let the Actions workflow deploy it, and verify the live hashed asset plus signup links and absence of the retired waitlist flow. Avoid direct/manual Pages uploads unless they are deliberately reconciled back to GitHub. The separately approved Replit production shutdown has occurred; Replit remains an optional development workspace, not a production release target. Do not republish its former production deployment as part of marketing releases.

Source-only acceptance must prevent automatic release workflows before updating main, even when using the connected GitHub App's Git-data API rather than Git push. Disabling Pages Git builds does not disable GitHub Actions.

**Why:** A source-only runtime acceptance updated main through the Git-data API and unintentionally triggered a completed marketing production upload before cancellation was possible. An API ref update is not a safe bypass of push automation.

**How to apply:** Inspect every push-triggered workflow before committing or updating the canonical ref. Use an effective workflow-skip mechanism for explicitly approved source-only acceptance, or obtain approval for any necessary workflow-policy change before pushing. Checking and cancelling afterward is too late.