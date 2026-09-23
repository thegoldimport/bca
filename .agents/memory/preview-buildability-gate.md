---
name: Preview buildability gate
description: Distinguish invalid test projects from restore-specific preview failures in isolated VibeSDK investigations.
---

Do not classify a `Build failed` event during restore as a restore or deployment defect until the exact target app was proven to preview successfully before restore, a distinct B previewed successfully, and the restored committed tree matched A.

**Why:** An isolated marker-only app had no Worker entry point or Wrangler configuration, so its build failure was ambiguous. A separate normal Think-generated app with source, config and assets previewed successfully as A and B; after a forward restore to the identical full A tree, preview succeeded again. The deleted marker-only Worker's detailed build response was not captured, so a locally reproduced bundler entry-point error is evidence about buildability, not its historical server log.

**How to apply:** Verify preview output and committed tree before restore, then compare restored full tree, session state and preview. For Think's SpaceDO preview path, the bundler executes inside SpaceDO rather than the sandbox's `bun run build` path; check `details` on the raw deploy result when available. Do not claim an unrecorded historical error detail was observed.