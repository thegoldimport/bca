---
name: GitHub Git transport fallback
description: Preserve canonical Git identities when local HTTPS authentication fails but the connected GitHub App works.
---

A rejected configured HTTPS Git credential does not prove the connected GitHub App is unusable. When that connection is healthy, its Git data API can publish exact existing Git objects rather than reconstructing changes as new commits.

**Why:** Local Git push was rejected while the managed GitHub App remained authorized. Importing the exact blobs, trees and commit objects preserved every local object identity and allowed the canonical branch to advance without force or replacement credentials.

**How to apply:** Check the connection independently, verify the expected remote base, preserve object identities and ancestry, update the ref without force, and read back the exact target SHA. Do not print credentials, alter secrets merely to bypass a stale local helper, or replace accepted commits with equivalent-looking API-generated commits.