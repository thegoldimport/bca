---
name: Stock framework WebSocket envelopes
description: Native framework state can be encoded inside a string-valued frame type.
---

Stock WebSocket traffic can include an outer frame whose `type` value is itself a long JSON string containing a nested `cf_agent_state` envelope. Filtering only literal frame types beginning with `cf_agent_` misses it and may relay sensitive framework state to the browser.

**Why:** A controlled stock follow-up stream included several JSON-encoded framework state envelopes alongside ordinary Think progress frames. A type-counting harness also accidentally retained the whole envelope as a map key.

**How to apply:** Bound and inspect string-valued types before relaying or logging. Drop framework envelopes and implausibly long/nonliteral types; preserve ordinary literal Think progress events and redact credential-bearing state fields. Summarize unknown frames by safe labels, never by raw payload.