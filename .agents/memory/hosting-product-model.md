---
name: Hosting product model
description: Customer-facing hosting and domain choices for BuildCustom.Ai publishing.
---

Every plan includes BuildCustom.Ai managed hosting, SSL, CDN, and an automatic BuildCustom.Ai project subdomain. Plan limits are Free: 1 live project, Launch: 5 at $9/month, Pro: 25 at $19/month, and Agency: 100 at $49/month. Custom domains start on paid plans. External hosting remains available.

**Why:** Workers for Platforms keeps hosting costs predictable enough to bundle hosting aggressively. AI generation and model usage are the unpredictable variable costs and must be metered separately. Infrastructure vendors must remain hidden from customer-facing copy.

**How to apply:** Default publishing UI to one editable `project.apps.buildcustom.ai` address and a publish action. Hide custom-domain hosting and DNS controls until “Add a custom domain” is selected. Enforce live-project limits on first publish, not republish. Require Launch or higher only for BuildCustom-hosted custom domains; external hosting stores its origin and remains available independently.