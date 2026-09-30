---
name: Ignored-source release parity
description: Why a release reconstructed from tracked patches must match the entire accepted source, not just the new feature files.
---

When shipping changes from an ignored runtime checkout through tracked patches, compare the entire reconstructed release with the tested accepted source. Matching only the latest feature's files is insufficient.

**Why:** A lifecycle patch reproduced every one of its feature files exactly, while the older patch chain omitted registration error handling and auth tests already present in the checkout used for regression validation. Clean patch application and local tests on that checkout could therefore have permitted an auth regression in the reconstructed release.

**How to apply:** Classify complete-source differences before deployment, including functional changes, test changes, and comments/formatting. Preserve missing accepted behavior in the release inputs rather than quietly copying files or resolving provenance mismatches during a production rollout.