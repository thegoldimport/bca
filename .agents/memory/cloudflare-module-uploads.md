---
name: Cloudflare module uploads
description: Multipart requirements for safely updating an existing Cloudflare module Worker.
---

For module-format Worker uploads, set `main_module` in multipart metadata and give the JavaScript file part that exact filename. Preserve the existing bindings explicitly in the upload metadata. For the versions API, `inherit` bindings accept only the literal `version_id: "latest"`; a pinned UUID is rejected even when it is the currently serving version. Check the serving version immediately before upload and compare the new version's resources before deployment.

**Why:** Cloudflare returns validation error 10021 (“No such module”) when the form field is named like the module but its uploaded filename does not match `main_module`. It also rejects JavaScript imports with “Cannot use import statement outside a module” unless module parts use `application/javascript+module`. Replacing a script without its current bindings can disconnect KV or dispatch namespaces. Downloaded Workers can contain binary WASM parts; text-decoding and re-encoding their multipart response corrupts the bytes.

**How to apply:** Read the existing Worker settings first, reuse its bindings and compatibility date, and preserve every original module as bytes, changing only the intended JavaScript part. Upload with the module MIME type and a multipart filename that exactly matches `main_module`; verify parity before activating the uploaded version.