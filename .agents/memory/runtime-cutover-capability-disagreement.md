---
name: Runtime cutover capability disagreement
description: Guarded production runtime activation yielded a false live registration capability despite correct version and binding checks.
---

In a single guarded public-signup activation, deployment readback showed the intended runtime version at 100% and the old version at 0%. The candidate configuration recheck had shown registration enabled, but both a targeted version-override capability request and an ordinary live capability request failed the required `registrationEnabled=true` observation. Existing-user authentication passed. The runtime was restored to the closed version without activating the control candidate or retrying.

**Why:** Cloudflare deployment and binding readbacks alone did not prove the live runtime capability. The preserved operator journal summarized the failed checks but not their raw response bodies; the underlying cause and whether timing contributed are unknown.

**How to apply:** Keep candidate configuration, targeted capability, and ordinary live capability as separate required gates. Do not reinterpret a failed live gate as a harmless delay or retry the same authorized attempt. A later diagnosis needs independently captured raw safe responses and version identity before any separately authorized cutover.