# Canonical source and release checkpoint

## OVERALL STATUS: SMOKE FAILED

Git reconciliation, reconstruction, release audit and deployment passed.
Full Project 8 verification is incomplete because the smoke harness stopped,
not because an application regression was established. No second login,
application repair, generation, resend or Publish was attempted.

## GIT BEFORE

- Branch: `main`
- Local HEAD: `1ac2faaa44e04f0168818a90a4f3ae506a00e6d8`
- Origin/main: `11a8efdefcfc4e3e731222ef52e343f349b3ef83`
- Ahead / behind: 46 / 3
- Staged / unstaged: none / none at initial inspection
- Untracked: current request attachment only
- Authoritative source at risk: ignored runtime checkout required the complete
  committed ten-patch chain; the older eight-patch recipe was not sufficient.
- Temporary files excluded: runtime checkout, dependency/build caches, browser
  profiles, local acceptance helpers, upload bundles, install/build logs and
  current pasted task request. Existing referenced historical evidence retained.

## RECONCILIATION

- Remote commits reviewed: marketing release workflow; install diagnostics;
  normalization of 201 root lockfile registry URLs.
- Three-way preview: conflict-free, exact proposed tree confirmed during merge.
- Accepted executable source preserved: YES. Root application files unchanged;
  all runtime source hashes and all eight candidate Worker module bytes match.
- Runtime patch chain preserved: all ten pinned patches and hashes committed.
- Commits created: `966cb055840052a8804de51e310e54200b7036c1`
  and `6a8e6dc7dd5e32ee976f3e92f4be363240a598a7`.
- Source pushed to `thegoldimport/bca`, branch `main`.
- Audited source commit: `6a8e6dc7dd5e32ee976f3e92f4be363240a598a7`.
- `[skip ci]` used to suppress unrelated marketing release.
- Default Git credential failed; existing workspace GitHub credential succeeded
  without disclosure. No history rewrite, discarded work or product auth edit.

## RECONSTRUCTION

- Fresh canonical checkout from GitHub, not the existing ignored runtime.
- Pinned upstream: `9da158d82c597a0e8f4bf033cdccd1053fb6fb15`.
- Ten patches applied cleanly; 860 runtime source paths and hashes match.
- Frozen runtime lock hash unchanged.
- Runtime and control builds: PASS.
- Both Worker dry-runs: PASS, complete seven-runtime/one-control module graph.
- All eight fresh module bytes match the already-tested candidate.
- Production frontend assets: exact original manifest match after supplying
  `PUBLIC_APP_URL=https://app.buildcustom.ai`; the initial mismatch was only
  generated social-image metadata using the ambient Replit dev hostname.
- 250-credit configuration: present.
- Native resource-terminal status and terminal controller UI: accepted source
  identity preserved, no redesign or new implementation.
- Complete split-module audit: PASS. Main export pairs match; non-main
  executable ASTs match; WASM and bundler runtime byte-identical.
- Audit helper recognition corrected for an internal hyphen in an actual
  eight-character base64url fingerprint. Unknown imports still fail closed.
- Actual executable mismatch: NONE.
- Extensive previously accepted suites were not repeated. Only focused release
  operator tests, source identity, builds, dry-runs and release checks ran.

## DEPLOYMENT

| Component | Previous / rollback | New | Rollout |
|---|---|---|---|
| Runtime | `f4488693-4424-46a3-9834-30b214645449` | `5a964dd5-db65-4cde-83f8-22a17f4d909f` | 100% |
| Control | `363353cd-76d3-4eb1-9df0-5bdd9a859083` | `dd40f46c-cd23-4e82-8679-83460169570f` | 100% |

- Old empty-target failed checkpoint reconciled once before upload.
- Both inactive candidates verified before activation.
- Gateways changed: NO. Both serving versions reconfirmed unchanged.
- Generated-app production routing changed: NO.
- Production variables, confirmed through version-specific GET:
  - `THINK_OPERATION_MAX_CREDITS=250`
  - `THINK_OPERATION_MAX_CONTINUATIONS=4`
  - `THINK_OPERATION_MAX_ELAPSED_MS=900000`
- Native maxSteps: 25; total Think turns: 5, established by identical accepted
  source/config, not a new model invocation.
- Already-started operation snapshots remain unchanged; new operations receive
  refreshed limits. No new operation was submitted in this task.
- Rollback versions remain available. No rollback was executed.

### Receipt retention limitation

The temporary canonical checkout and its detailed audit/staging JSON disappeared
when the local preview workflow restarted. Retained PASS logs and source/module
manifests were not lost. The live read-only recovery receipt reconfirms both
active versions, 100% rollouts, exact bytes of all eight modules, production
variables and unchanged gateways. It is labeled recovery evidence, not the
lost original audit receipt. No audit, upload or activation was repeated.

See `canonical-live-release-receipt.json`, updated `resource-envelope-release.json`,
and `resource-envelope-failed-preflight-before-canonical.json`.

## PROJECT 8 SMOKE

- Browser: fresh owner session; lost earlier browser was not treated as retained.
- Owner login: PASS, one POST, one click, HTTP 200, zero retries.
- Owner: same expected owner confirmed.
- Agent: `c9b4c828-07d1-41aa-a6bb-2c858b29c09e`, confirmed.
- Revision: `020de27f52eb0273554e1004cb12eb9f2977aa7a`, confirmed.
- Runtime status: HTTP 200; `shouldBeGenerating=false`, generation `idle`.
- Editor load: attempted; complete rendered verification not established.
- Input: NOT VERIFIED.
- Preview: NOT VERIFIED.
- Original 12 leads: NOT VERIFIED in this smoke.
- Lead details: NOT VERIFIED.
- Persisted note: NOT VERIFIED.
- Activity Timeline: NOT VERIFIED.
- Generated API / malformed URL / CORS / releases: NOT VERIFIED to completion.
- Outgoing AI instructions: none observed; no matching send or HTTP generation
  was recorded. Two incoming raw-keyword detections cannot establish a new
  request or be conclusively labeled historical replay.
- Project/generated API mutations, note/lead submissions and Publish: ZERO.
- Result: FAIL_STOPPED, verification incomplete.

The first browser preflight stopped on blocked Cloudflare RUM before any login.
The sole subsequent normal login passed. Its harness then stopped on two broad
incoming socket matches and a Cloudflare RUM OPTIONS request. The session profile
was removed by its own cleanup; another login was not attempted. Neither an auth
regression nor an application failure was established.

Receipts: `canonical-resource-project8-smoke.json` (pre-login preflight),
`canonical-resource-project8-owner-smoke.json` (sole authenticated partial smoke).

## GITHUB SOURCE OF TRUTH

- Repository / branch: `thegoldimport/bca` / `main`.
- Accepted executable source and complete reconstruction inputs: committed.
- Reproducible from committed source: YES, proved for the audited source commit.
- Important accepted executable source only in ephemeral Replit state: NO.
- Final receipt-only commit is a descendant of the audited source commit;
  final local/remote hash and synchronization are reported separately.
- Local public preview restarted and visually verified. This public screenshot
  does not establish the uncompleted signed-in Project 8 UI checks.

## SCOPE

- AUTH CHANGED: NO
- PROJECT 8 AI REQUEST SENT: NO observed outgoing request
- PROJECT 9: NO
- PROJECT 5: UNTOUCHED
- GENERATED-APP PRODUCTION PUBLISH: NO
- GATEWAY / GENERATED-APP PRODUCTION ROUTING CHANGED: NO

## EXACT NEXT STEP

Stop. Full non-AI Project 8 verification remains incomplete. Any continuation
needs a separately authorized normal owner-session recovery and a read-only
harness that distinguishes outgoing instructions from incoming state/history
and platform telemetry. No source repair, AI instruction or Publish is implied.