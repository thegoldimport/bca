---
name: Customer-loop testing
description: Test BuildCustom through normal customer chat, preview, publish, and release restoration rather than repairing generated apps externally.
---

Test BuildCustom as the product a customer actually uses. Let its coding agent diagnose and repair generated-app mistakes through normal customer chat. Intermediate build, preview, and API failures are not automatically platform failures; allow normal self-correction and internal continuations.

**Why:** The user explicitly changed the testing philosophy: imperfect generated code is acceptable if the normal customer repair loop works. Infrastructure work must not replace the product's own coding workflow.

**How to apply:** Follow the authorized customer instructions exactly. Do not manually edit generated source, manipulate checkpoints or lifecycle state, or add diagnostics to make a test app pass. If completed work still fails, report customer-visible symptoms and await the next authorized conversational fix. Stop for actual platform blockers, ownership/security failures, corruption, or release-safety violations. Publish and restore only through the normal customer UI when authorized.