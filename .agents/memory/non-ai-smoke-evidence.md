---
name: Non-AI smoke evidence
description: Separate outgoing instructions from incoming replay and preserve a one-login session until all read-only checks finish.
---

Do not classify an incoming socket frame as a new AI request from a raw keyword match. Record direction and safe event-shape metadata; count outgoing instructions independently from incoming state/history. Block platform telemetry separately from project/generated-app mutations.

**Why:** A read-only smoke authenticated the correct owner and confirmed revision and idle status, but a broad received-frame regex and a Cloudflare telemetry preflight stopped the harness. Its receipt did not retain enough event-shape information to classify the incoming frames, and automatic profile deletion prevented completion without another login.

**How to apply:** Treat incoming unknowns as unknown, not proof of model invocation or harmless replay. Keep approved owner-session recovery state protected until the complete smoke receipt is finalized; preserve one-time login/mutation counters. A partial harness result is not a product failure or a full smoke PASS.

For short non-AI acceptance, use the normal authenticated customer path without creating or modifying a verification framework. Do not let optional observers or screenshots stop otherwise-working UI checks.

**Why:** Direct browser interaction completed the same owner's existing project successfully despite the earlier harness stops. Cloudflare telemetry and received-message keywords were not evidence of a customer-facing regression.

**How to apply:** Exercise only read-only UI controls, observe actual outbound customer instructions independently, and report generated-app API/runtime errors separately from platform telemetry.