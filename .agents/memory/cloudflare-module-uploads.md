---
name: Cloudflare module uploads
description: Multipart requirements for safely updating an existing Cloudflare module Worker.
---

For module-format Worker uploads, set `main_module` in multipart metadata and give the JavaScript file part that exact filename. Preserve the existing bindings explicitly in the upload metadata.

**Why:** Cloudflare returns validation error 10021 (“No such module”) when the form field is named like the module but its uploaded filename does not match `main_module`. Replacing a script without its current bindings can also disconnect KV or dispatch namespaces.

**How to apply:** Read the existing Worker settings first, reuse its bindings and compatibility date, then upload the source file with a multipart filename that exactly matches `main_module`.