---
name: GitHub Git transport fallback
description: Preserve canonical Git identities when local HTTPS authentication fails but the connected GitHub App works.
---

A rejected configured HTTPS Git credential does not prove the connected GitHub App is unusable. When that connection is healthy, its Git data API can publish exact existing Git objects rather than reconstructing changes as new commits.

**Why:** Local Git push was rejected while the managed GitHub App remained authorized. Importing the exact blobs, trees and commit objects preserved every local object identity and allowed the canonical branch to advance without force or replacement credentials.

**How to apply:** Check the connection independently, verify the expected remote base, preserve object identities and ancestry, update the ref without force, and read back the exact target SHA. Do not print credentials, alter secrets merely to bypass a stale local helper, or replace accepted commits with equivalent-looking API-generated commits.

Transfer objects serially with bounded HTTP 429 backoff. Keep large Base64 object bundles in workspace scratch storage and read them inside the network boundary; return hashes and counts, not full bundles.

**Why:** Parallel blob creation hit the connector proxy's rate limit despite healthy GitHub authorization. Passing a large Base64 shell result through the execution callback also failed serialization; reading the exported bundle directly inside the impure transfer preserved every object identity.

**How to apply:** Separate transport failures from credential failures. Retry only idempotent object creation, recheck the branch before its non-forced update, and verify the exact commit afterward.

Preserve the exact trailing newline in a commit message when importing it through GitHub's Git data API; do not trim the message.

**Why:** Removing the final newline produced a different commit SHA despite identical tree, parent, author, committer and timestamps. Sending the original message bytes preserved the local commit identity.

**How to apply:** Extract the message after the raw commit header separator without trimming. Compare the returned SHA before advancing any branch.