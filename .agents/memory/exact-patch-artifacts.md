---
name: Exact patch artifacts
description: Preserve whitespace when freezing a unified diff from a pinned source checkout.
---

For a byte-exact patch artifact, produce the diff in a temporary file, read its contents without terminal-output normalization, then verify it with `git apply --check` against the pinned base.

**Why:** Capturing a `diff -u` command through the sandbox's shell callback changed tab and line-ending bytes in the returned text. The resulting patch looked correct in summaries but failed to apply. Reading the temporary diff file as file content preserved the source whitespace and passed the application check.

**How to apply:** Use the original source files to generate a local temporary diff, not a copied tool-output transcript. Recheck the artifact's checksum and dry-run application before calling it a reproducible patch.

For long-running remote provisioning, preserve an accepted patch in the workspace before relying on a temporary checkout.

**Why:** A container reset erased temporary source checkouts and patch files while separately created Cloudflare resources persisted. Reconstructing the accepted patch was possible, but its byte identity had to be proven again before deployment.

**How to apply:** Keep a checksum-verified patch artifact alongside the launch configuration. If the build environment resets, reconcile remote resource state first and reacquire the pinned upstream checkout; do not repeat remote creates or deploy from an unverified replacement diff.