---
name: Preview form sandbox scope
description: Least-privilege sandbox decision for BuildCustom generated-app preview forms.
---

Allow form submission only in the interactive generated-app preview iframe; retain its opaque origin and script permission without adding same-origin, navigation, popups, or other capabilities. Noninteractive preview thumbnails should not acquire form-submission permission.

**Why:** A valid, enabled generated CRM form received a trusted browser click, but Chromium blocked submission before any submit event because the interactive iframe lacked `allow-forms`. Adding that one capability to the interactive preview restored the form boundary without weakening unrelated thumbnail embeds or parent-document isolation.

**How to apply:** When reviewing preview sandbox changes, distinguish the editor iframe from read-only thumbnails. Preserve existing permission tokens and add only what the specific interaction needs; verify the parent document and authenticated product APIs remain unreadable from the opaque preview.