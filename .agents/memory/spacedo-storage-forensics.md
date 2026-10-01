---
name: SpaceDO storage forensics
description: Read-only Think/Space SQL boundaries, live files versus Git, and native stream evidence interpretation.
---

Cloudflare's account-level Durable Object SQL query API can read a specific SQLite-backed SpaceDO's persisted file table without adding a public route or deploying a Worker. Restrict queries to SELECT, verify `rows_written: 0`, and independently confirm the target namespace, project-to-agent mapping, and `.git/HEAD` against the owner-authorized committed snapshot. Native `gitStatus` and `gitDiff` methods are not called by this API; derive an equivalent diff by comparing the live file contents to Git HEAD and label it accordingly. This does not apply unchanged to an Artifacts-backed or R2-backed filesystem.

**Why:** Owner-facing file routes can return only committed content while a failed coding turn leaves real edits in the persistent SpaceDO. Treating those routes as working-tree status concealed malformed pending code.

**How to apply:** During an explicitly authorized read-only incident review, use the least-privileged operator credential available, target only the confirmed object's namespace and name, avoid logging file contents or credentials, and never use a SQL write or a deploy just to inspect pending edits.

Check the SQL result's own error field as well as HTTP status and the outer success flag. Cloudflare can return HTTP 200 and outer success with a rejected query in the nested result. Its SQL authorizer protects `_cf_KV`; do not bypass that boundary or infer lifecycle state from an empty rejected response.

**Why:** A protected-storage query looked successful at the transport layer while the actual SQL result was an authorization error. Permitted workspace/message metadata remained independently readable.

**How to apply:** Require no nested SQL error and zero rows written. If private lifecycle storage is unavailable, label that limitation and use actual customer-path/tool results rather than inventing a COMPLETE state.

Installed Think's resumable stream journal can mix single JSON chunk objects with packed arrays of JSON-encoded chunk strings. Decode the segment and then each string before checking chunk types. Extract only operational metadata/error fields, never reasoning/text deltas. A native general error can terminate the stream before that error chunk is persisted; no stored error chunk is not proof of a successful stream.

**Why:** Directly extracting a type from packed rows produced null and concealed the actual step/tool counts. The stream's persisted status still authoritatively recorded an error without a stored error message.

**How to apply:** Check the installed agents stream decoder when interpreting journal rows, count decoded step/tool types, and independently verify stream status, owner-visible revision/preview, and finish evidence.