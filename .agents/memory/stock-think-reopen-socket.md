---
name: Stock Think reopen socket
description: Native existing-agent connection behavior and reliable private acceptance evidence
---

An existing VibeSDK ThinkAgent chat connects its WebSocket on reopen without sending a generation prompt. It requests conversation state, stays connected while mounted, retries closes, and disconnects on unmount. BuildCustom should preserve this no-prompt behavior, not replace it with HTTP-only reopen or manufacture a prompt for a transport check.

**Why:** Comparison against the exact pinned upstream stock source resolved an ambiguous acceptance gate: a BuildCustom HTTP-only idle reopen differed from stock. A successful WebSocket handshake alone was not enough to prove the correct agent state; the native connection and conversation-state frames establish the transport while server-side owner/project mapping establishes agent identity. The native connection frame need not expose an agent ID to the browser. Also, a preview document can be ready before its stylesheet finishes loading.

**How to apply:** On future native editor changes, keep owner-scoped ticket acquisition in the bridge, send only conversation-state requests on idle reopen, hand off to generation without overlapping sockets, and bound unstable reconnect loops. In live acceptance, verify a 101 handshake plus native state frames, no suggestion/inference, unchanged authoritative revision and release list, and a loaded preview stylesheet; do not assume a frame-level agent ID or immediate CSS readiness.