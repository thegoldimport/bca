---
name: Customer browser reconnects
description: Preserve viewport when reconnecting to an existing authenticated browser for customer acceptance checks.
---

Treat the browser viewport as part of the acceptance fixture, not an incidental connection default.

**Why:** Puppeteer reconnects reset an existing page to the default small viewport unless configured otherwise. That shrank the embedded CRM into its mobile layout and hid desktop navigation, initially making a working Leads Database control look unavailable.

**How to apply:** Use `defaultViewport: null` when connecting to the existing browser, then set the intended viewport explicitly when needed. Check the rendered iframe dimensions and visible navigation before classifying a missing control as an application defect. Preserve the authenticated customer session rather than launching a replacement session.