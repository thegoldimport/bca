---
name: BuildCustom transactional email provider
description: Approved provider choice and onboarding boundary for transactional email, beginning with password recovery.
---

Use Cloudflare Email Service with a native Workers send_email binding for BuildCustom transactional email. Do not choose another mail provider for password recovery.

**Why:** The product owner explicitly approved Cloudflare Email Service as the transactional foundation and rejected adding an external provider. A reachable Email Sending limits API is not proof that the sending domain is onboarded or verified; the domain must be ready before delivery can be implemented or claimed working.

**How to apply:** Before adding the binding or recovery email sending, check the sending domain in Cloudflare's Email Service dashboard. If onboarding or terms require an account-owner action, stop and request that action; do not hand-create speculative DNS records or work around the account gate.

Cloudflare REST sends and local simulated sends do not prove that the production-style native Workers binding can send. In this Replit environment, a local Wrangler Worker with a remote `send_email` binding hit a workerd TLS certificate-trust failure before returning a send result. A standalone Worker running on Cloudflare can isolate the native binding without changing the production runtime or control plane.

**Why:** The local failure was a transport problem on the development path, not evidence of recipient rejection. A successful `EMAIL.send()` returns a message ID but does not prove inbox receipt; the sending quota can also lag the send response.

**How to apply:** For future delivery investigations, distinguish API acceptance, binding success, Email Sending activity, recipient-server acceptance, and actual inbox receipt. Do not automatically retry an uncertain send. Keep an isolated test Worker sender-restricted and non-public on its ordinary workers.dev route.