# Operation resource configuration and terminal status

OVERALL STATUS: BLOCKED

Implementation and local checks passed. No production upload or activation occurred.

## CREDIT SEMANTICS

- **credit meaning:** Bookkeeping unit in the existing operation resource guard, not a token or dollar amount. A prepared model step reserves two credits.
- **reservation per model call:** 2 credits per beforeStep invocation, before the provider request.
- **every Think step:** Each model-producing prepared step reserves credits; tool/checkpoint-only activity does not reserve model credits.
- **unused reservation refund:** None. A later failure does not refund a successful reservation.
- **tool-only activity:** No model-credit charge; independent tool-call guard remains.
- **retries:** A new beforeStep reserves another 2. Automatic AI SDK HTTP retries within one prepared step share its reservation and can still incur provider usage.
- **internal continuation initialization:** No separate model credits. Subsequent model steps reserve 2 each.
- **finish_task:** No additional model-credit charge for the tool itself; its invoking model step is already charged.
- **guard purpose:** Abstract cost and loop protection, independent of exact provider/Gateway billing.
- **max model steps per Think turn:** 25
- **max Think turns:** 5
- **maximum configured model-step envelope:** 125
- **required credit arithmetic:** 25 × 5 × 2 = 250
- **previous budget:** 100 effective production credits; no explicit credit binding was present.
- **new budget:** 250 in candidate production configuration; NOT DEPLOYED. Live production remains 100.
- **safety margin:** 0
- **rationale:** No extra credits are required for tools, checkpoints, continuation initialization or finish_task bookkeeping.
- **Project 8 arithmetic:** 25 + 25 = 50 reservations; 50 × 2 = 100. The next reservation would be 102 > 100 and fails before a third-pass provider request.

## RESOURCE LIMITS

- **maxSteps:** 25
- **total Think turns:** 5
- **internal continuations:** 4
- **elapsed ceiling:** 900000 ms / 15 minutes, unchanged
- **credit ceiling:** Candidate 250; live 100 until guarded deployment
- **no-progress protection:** Unchanged; offline tests PASS
- **changed limits:** Only the production operation credit binding, 100 effective → 250 candidate. Fallback 100 remains for other environments.
- **existing-agent configuration:** Candidate refreshes env-derived resource limits before beginTask, preserving owner/provider/system/preview configuration. Already-started operation limits and consumed credits are not rewritten.

## TERMINAL RESOURCE STATE

- **authoritative state:** Existing native INCOMPLETE_RESOURCE_LIMIT; no new lifecycle or ledger.
- **owner API exposure:** Candidate optional top-level nativeTaskLifecycle {status, reason?, updatedAt}, read from existing native getTaskLifecycle. Enum-bounded status/reason; no summaries or prompts. Lookup/validation failure rejects status with 502. Not deployed.
- **UI behavior before:** Resource terminal was absent from the owner status contract; recovery/verifying could continue without that authoritative terminal signal.
- **UI behavior after:** Rendered candidate tests show ERROR/incomplete, not RECOVERING or COMPLETE. Stale prior-operation timestamps do not abort a newer explicit request.
- **input safety:** Available when explicit host idle is confirmed; remains disabled while shouldBeGenerating is true. Existing status polling confirms idle and stops on 401/403 without auth retries.
- **COMPLETE incorrectly shown:** NO in focused tests
- **automatic resend:** NO
- **revision/preview preserved:** PASS in offline fixtures and rendered controllers; no production project mutation performed.

## TESTS

- **focused:** PASS: configured envelope, 125 allowed / 126 rejected, retained usage and finite guards; status projection and terminal controller cases.
- **lifecycle:** PASS
- **recovery:** PASS
- **completion:** PASS
- **owner/status:** PASS
- **preview:** PASS
- **Task4B immutable publish:** PASS (offline regressions only; no production Publish)
- **Task6A auth/logout:** PASS
- **ownership isolation:** PASS
- **gateway:** PASS
- **root full regression run:** 288 passed; final guarded rendered-controller run 23 passed; owner/actual-policy-method unit run 5 passed. These runs overlap and are not summed.
- **runtime regression run:**  Test Files  22 passed (22);       Tests  173 passed (173)
- **typecheck:** PASS: root npm run check and runtime bun run typecheck
- **build:** PASS: root/control and runtime
- **Worker dry-run:** PASS: control and runtime
- **source reconstruction:** 860 canonical paths; pinned upstream + 9 accepted patches + resource patch; zero unexpected source differences; unchanged bun.lock.
- **auxiliary chunks:** PASS read-only AST audit. WASM and bundler runtime byte-identical. Four other JS chunks have equivalent executable ASTs after known chunk-reference/comment normalization.
- **verification boundary:** Native Worker harness cannot collect its transitive shell dependency. Actual policy method was compiled from current source and executed with a clearly simulated SDK config store; pure driver/source-wiring and rendered-controller tests supplement it. This is not a full native SDK persistence integration test.
- **local app verification:** Workflow running; public homepage screenshot rendered. Signed-in production UI was not verified after the browser was lost.

## DEPLOYMENT

- **components:** Minimum planned: buildcustom-vibesdk-launch and buildcustom-control-plane-launch, including updated control frontend assets. Gateways unchanged.
- **previous runtime version:** f4488693-4424-46a3-9834-30b214645449
- **previous control version:** 363353cd-76d3-4eb1-9df0-5bdd9a859083
- **new versions:** NONE
- **rollout:** NOT PERFORMED. Preflight failed before any upload; checkpoint targets is empty. Later read-only AST audit narrowed the split-chunk differences.
- **rollback:** Same prior runtime/control versions; both still serving at 100%.
- **blockers:** Release operator still requires a verified full-module-graph gate instead of its main-only raw-byte assumption. Workspace restart erased temporary upload bundles and the retained Chrome session. Re-establish release artifacts and controlled smoke evidence before any upload/activation.
- **Cloudflare mutations by this change:** NONE: no version upload, assets upload or deployment POST occurred.

## PROJECT 8 SMOKE

- **revision unchanged:** NOT REVERIFIED this turn; no generated source was modified. Expected accepted revision 020de27f52eb0273554e1004cb12eb9f2977aa7a.
- **login:** NOT RUN: retained authenticated Chrome session was lost in workspace restart.
- **preview:** NOT RUN after deployment because no deployment occurred; prior accepted preview PASS is not new evidence.
- **12 seeded leads:** NOT REVERIFIED; no lead mutation was performed.
- **lead details:** NOT REVERIFIED
- **persisted note:** NOT REVERIFIED; no duplicate note or other CRUD performed.
- **releases:** NOT REVERIFIED; no release created by this request.
- **new AI requests:** 0 production/customer requests; all generation/controller tests were offline simulated fixtures.

## AUTH 401

- **changed auth code:** NO auth/session validation changes, no weakening, no auth retry added.
- **current classification:** UNRESOLVED SEPARATE OBSERVATION; not diagnosed or linked to the credit guard.

## SCOPE CONTROLS

- **Project 8 edit resend:** NO
- **Project 8 generated source modification:** NO
- **Project 9:** NO
- **Project 5:** UNTOUCHED
- **production Publish:** NO
- **new customer/fixture creation:** NO

## Evidence

- validation: production/vibesdk-launch/resource-envelope-validation.json
- sourceParity: production/vibesdk-launch/resource-envelope-source-parity.json
- releaseAttempt: production/vibesdk-launch/resource-envelope-release.json
- chunkAudit: production/vibesdk-launch/resource-envelope-chunk-provenance.json
- runtimePatch: production/patches/resource-envelope-terminal-state.patch
- runtimePatchSha256: 5f2cb679111ed37be2af583cdde4a0790ce466ced3c685599190375dcc3773cb

STOPPED. No generation or Publish was performed.
