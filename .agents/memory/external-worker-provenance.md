---
name: External Worker provenance
description: Interpreting a deleted Wrangler upload checkout and matching compiled VibeSDK artifacts.
---

Treat a compiled method-body match and identical hashed asset names as strong structural evidence, not a unique Git revision or lockfile match.

**Why:** A surviving Wrangler log identified the upload's temporary working directory and exact deployment version, but the directory and build manifest were gone. The protected bundle matched isolated public-candidate rollback methods and the logged client-asset names; many public commits shared the touched source blobs and root lock, so no single commit was proven.

**How to apply:** Consult `docs/vibesdk-source-archaeology.md` before building a production-parity candidate. Seek an upload-time source/archive record, compare full build inputs, and retain the production stop gate until source-to-bundle provenance or an explicitly reviewed alternate compatibility proof exists.