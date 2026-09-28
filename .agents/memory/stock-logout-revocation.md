---
name: Stock runtime logout revocation
description: Why a successful logout response is insufficient evidence of revoked VibeSDK sessions.
---

For a clean stock VibeSDK runtime, require a post-logout request using the **pre-logout** credential to fail. HTTP 200 from logout, a cleared browser cookie, or a successful new login is not sufficient evidence of session revocation. In the pinned launch baseline, normal registration does not supply the cookie that the logout handler needs to identify and revoke the session; a copied access token therefore remains usable. Also require token subject and stored session owner to agree, and ensure a successful logout proves the owner-scoped revocation actually changed the stored session rather than silently updating zero rows.

**Why:** Private production acceptance found two registered sessions, zero revoked sessions, and HTTP 200 from an authenticated profile request using a pre-logout cookie after logout. A later public-gate acceptance found the same failure even for a normal fresh login: logout cleared browser cookies and returned success, but the old credential still received authenticated HTTP 200 at both the product and runtime. A security review also found that an owner-scoped database update can silently affect zero rows if token subject and session owner disagree. Cookie deletion and a success response miss these failures.

**How to apply:** Before asserting launch auth acceptance, verify the server-side session is revoked and the old credential fails; include missing/mismatched/no-op row tests. Do not silently patch a locked stock+approved-patch baseline; request authorization for any additional source deviation, then re-run the isolated auth test.