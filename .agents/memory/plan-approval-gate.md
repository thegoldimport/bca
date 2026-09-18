---
name: Plan approval gate
description: Product requirement and runtime boundary for BuildCustom Builder Plan mode.
---

Plan mode must use the same configured ThinkAgent model, conversation, and project context as normal builds, but every tool must be disabled for that turn. It must return text for human approval without writing, committing, deploying, or previewing.

**Why:** The purpose is to prevent wasted implementation work before a human approves the approach, not to substitute a cheaper or weaker planning model.

**How to apply:** Keep planning as a native ThinkAgent turn with `activeTools: []` and `toolChoice: none`. Store the returned plan in the Builder UI and include it in the next normal, tool-enabled VibeSDK request only after the user sends that build request.