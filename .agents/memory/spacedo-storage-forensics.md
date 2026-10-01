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

Cloudflare account query/v2 can return successful SELECT result objects with `columns`, `rows`, and `meta.rows_written: 0` but **without a nested `success` property**. Treat an absent nested success as valid only if the expected result count and row/column shape are present, there is no root or nested error or explicit `success: false`, and every nested query reports zero writes.

**Why:** Requiring `queryResult.success === true` misclassified a successful, scoped workspace HEAD read as a SpaceDO failure, hiding a real pre-existing seed commit from a one-shot acceptance harness.

**How to apply:** Normalize the actual query/v2 result envelope before classifying storage health; do not equate a parser assertion with an unavailable Durable Object. Keep native customer revision reads authoritative for acceptance rather than making direct storage inspection a prerequisite.

Installed Think's resumable stream journal can mix single JSON chunk objects with packed arrays of JSON-encoded chunk strings. Decode the segment and then each string before checking chunk types. Extract only operational metadata/error fields, never reasoning/text deltas. A native general error can terminate the stream before that error chunk is persisted; no stored error chunk is not proof of a successful stream.

**Why:** Directly extracting a type from packed rows produced null and concealed the actual step/tool counts. The stream's persisted status still authoritatively recorded an error without a stored error message.

**How to apply:** Check the installed agents stream decoder when interpreting journal rows, count decoded step/tool types, and independently verify stream status, owner-visible revision/preview, and finish evidence.

When an operator API result is projected through a tool response, a long file-content field can be replaced with a `--- TRUNCATED ---` marker while the surrounding SQL still reports success and zero writes. Do not run syntax checks or calculate hashes on such a projection as if it were the complete file. Read long values in bounded SQL substrings, verify their combined character length against SQL's `length(content)`, and compare the reconstructed byte hash to prior evidence before interpreting it.

**Why:** A live workspace inspection initially produced syntactically plausible but incomplete copies of three generated modules. The full copies only matched the preserved fixture hashes after bounded reassembly.

**How to apply:** For read-only SpaceDO forensic exports that cross an API/tool output limit, keep each projected field small and validate total length, encoding, and hash. A syntax result from a truncated export is not evidence of the live file's syntax.

Cloudflare's retained Worker logs can correlate a host Durable Object and a Think Durable Object by shared trace on the original RPC, but scheduled/alarm work may continue under separate trace IDs after that RPC is reported canceled. A provider Gateway HTTP 200 can likewise coexist with a later native Think stream error.

**Why:** The original RPC's canceled outcome preceded a persisted workspace write and terminal stream error, while all correlated provider requests succeeded. Neither the RPC outcome nor the provider status alone identified the original exception.

**How to apply:** Correlate narrowly by the confirmed object IDs and invocation time, project only safe metadata from logs and provider `streamed_data`, and report an unknown cause if no scoped exception or nested cause is retained. Never print raw WebSocket URLs, gateway response bodies, or reasoning fields.