---
name: Registration bypass boundary
description: Closed control-plane signup does not close the separately exposed stock runtime registration path.
---

When evaluating restricted registration, check every reachable authentication authority, not only the product-facing signup route. Before the runtime-side gate was deployed, the private launch runtime advertised email authentication and allowed registration independently of the product-facing gate; runtime identities could then potentially sign into the control plane, whose product-user record is provisioned after verified login. A product-only signup gate therefore does not prove that account creation is closed. The runtime-side gate has since been deployed privately, but its live state must be checked again for future candidate versions.

**Why:** A cutover tester cannot be created through direct runtime registration while the runtime gate is open and then claim the registration interval is closed again: that route remains available to other callers until it is explicitly closed. The stock runtime's preexisting email-auth switch disables both registration and login, so it cannot independently close signup while keeping tester login working.

**How to apply:** Before certifying a closed-registration cutover, verify the deployed runtime's direct registration exposure and its registration-only gate, not just the control-plane UI/API. Do not silently change a frozen runtime or candidate Worker just to complete acceptance.