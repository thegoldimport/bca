---
name: Registration bypass boundary
description: Closed control-plane signup does not close the separately exposed stock runtime registration path.
---

When evaluating restricted registration, check every reachable authentication authority, not only the product-facing signup route. The private launch runtime currently advertises email authentication and exposes its own normal registration endpoint; accounts created there can potentially sign into the control plane, whose product-user record is provisioned after verified login. A product-only signup gate therefore does not prove that account creation is closed.

**Why:** A cutover tester cannot be created through direct runtime registration and then claim the registration interval is closed again: that runtime route remains available to other callers. The stock runtime's existing email-auth switch disables both registration and login, so it cannot independently close signup while keeping tester login working.

**How to apply:** Before certifying a closed-registration cutover, verify the deployed runtime's direct registration exposure and require a separately approved narrow runtime-side registration gate (or an equivalent enforceable boundary). Do not silently change a frozen runtime or candidate Worker just to complete acceptance.