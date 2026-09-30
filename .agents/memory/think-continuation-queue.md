---
name: Think continuation queue
description: An installed Think lifecycle-hook and RPC-streaming trap for multi-turn coding operations.
---

In the installed Think version, `onChatResponse` is awaited before the enclosing queued chat RPC is released, despite a comment claiming the lock has been released. Awaiting `continueLastTurn()` from that hook enqueues behind itself and deadlocks. Also, `continueLastTurn()` generates a separate assistant message through the internal broadcast stream, not the parent RPC callback used by VibeSDK's chat forwarder.

**Why:** Reading only the hook comment and continuation API suggests a simple native loop, but the actual queue and streaming call paths contradict that design.

**How to apply:** Before designing automatic continuation, inspect the installed package's queue and callback paths. Chain only after the original RPC resolves or schedule without awaiting the current hook, and ensure every internal turn remains observable under the customer's single operation.