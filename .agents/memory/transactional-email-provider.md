---
name: BuildCustom transactional email provider
description: Approved provider choice and onboarding boundary for transactional email, beginning with password recovery.
---

Use Cloudflare Email Service with a native Workers send_email binding for BuildCustom transactional email. Do not choose another mail provider for password recovery.

**Why:** The product owner explicitly approved Cloudflare Email Service as the transactional foundation and rejected adding an external provider. A reachable Email Sending limits API is not proof that the sending domain is onboarded or verified; the domain must be ready before delivery can be implemented or claimed working.

**How to apply:** Before adding the binding or recovery email sending, check the sending domain in Cloudflare's Email Service dashboard. If onboarding or terms require an account-owner action, stop and request that action; do not hand-create speculative DNS records or work around the account gate.