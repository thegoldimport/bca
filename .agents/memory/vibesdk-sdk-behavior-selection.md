---
name: VibeSDK SDK behavior selection
description: Difference between the SDK's legacy AgenticClient and the normal browser's Think behavior.
---

The SDK's `AgenticClient` name does not select the current ThinkAgent lifecycle. A normal browser app chooses `think`; an isolated Think reproduction should explicitly request that behavior through the general client and disable automatic HTTP retries when creation can consume rate-limit slots.

**Why:** A test mistakenly used `AgenticClient`, triggered a template-catalog failure on the older behavior, and retries consumed the disposable user's creation quota before a real ThinkAgent was created.

**How to apply:** Check the behavior returned in the agent creation start event before claiming the real Think/SpaceDO stack ran. Do not substitute a different SDK behavior or seed synthetic state to get around initialization failures.