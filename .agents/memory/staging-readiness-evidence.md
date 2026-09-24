---
name: Staging readiness evidence
description: Interpreting immediate managed-hostname publish failures without mistaking SPA test assertions for propagation.
---

Do not classify an immediate generated-app failure as Cloudflare propagation solely because a marker is absent from raw HTML. In a JavaScript SPA, the HTML can be a healthy shell while the marker lives in the referenced script and appears only after browser rendering. Separate timestamped route, HTML, required asset status/MIME, and rendered-content checks before naming a late layer.

**Why:** Instrumented staging publishes had valid route checks, HTML, CSS, and JavaScript on the first post-response sample; the diagnostic initially produced a false negative by requiring the Home marker in raw HTML. Cache HIT alone did not show staleness: the observed HTML was configured to revalidate, and route identity responses were uncached. An earlier failed run lacked simultaneous layer timestamps, so its precise cause remains unproven.

**How to apply:** Parse actual local asset references without treating navigation links or inline script strings as assets. Check marker presence in source separately from visible browser-rendered content. If all sampled layers are already ready, report that observation rather than retroactively attributing an older failure to a particular propagation layer.