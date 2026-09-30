---
name: SpaceDO storage forensics
description: A read-only operator method for distinguishing live SpaceDO files from committed Git snapshots.
---

Cloudflare's account-level Durable Object SQL query API can read a specific SQLite-backed SpaceDO's persisted file table without adding a public route or deploying a Worker. Restrict queries to SELECT, verify `rows_written: 0`, and independently confirm the target namespace, project-to-agent mapping, and `.git/HEAD` against the owner-authorized committed snapshot. Native `gitStatus` and `gitDiff` methods are not called by this API; derive an equivalent diff by comparing the live file contents to Git HEAD and label it accordingly. This does not apply unchanged to an Artifacts-backed or R2-backed filesystem.

**Why:** Owner-facing file routes can return only committed content while a failed coding turn leaves real edits in the persistent SpaceDO. Treating those routes as working-tree status concealed malformed pending code.

**How to apply:** During an explicitly authorized read-only incident review, use the least-privileged operator credential available, target only the confirmed object's namespace and name, avoid logging file contents or credentials, and never use a SQL write or a deploy just to inspect pending edits.