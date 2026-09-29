import assert from "node:assert/strict";
import test from "node:test";
import { runRegistrationAcceptance } from "./lib/task12v-registration-runner.mjs";

const genericMessage = "Could not create your account. Check your details.";
export const expectedRegistrationCases = [
  "duplicate-existing-email", "case-variant-duplicate-existing-email", "invalid-email",
  "weak-password", "missing-password", "invalid-request-shape",
  ...["valid", "invalid", "missing"].flatMap(origin =>
    ["valid", "missing", "invalid"].map(csrf => `registration-origin-${origin}-csrf-${csrf}`)),
  "pre-signup-identity-counts", "single-public-ui-signup",
  "duplicate-new-account-exact", "duplicate-new-account-case-variant",
  "new-user-auth-authority", "new-user-logout-revocation", "old-credential-replay",
  "new-user-fresh-login", "existing-user-auth-authority", "existing-user-logout-revocation",
  "existing-user-old-credential-replay", "existing-user-fresh-login",
  "browser-network-audit",
];

export function createFakeRegistrationIO({
  scenario = "success",
  failCheckpoint = null,
  cleanupFailure = false,
  handoffFailure = false,
} = {}) {
  let productCreated = false;
  let runtimeCreated = false;
  const sessionRevoked = { new: false, existing: false };
  let signupActionCount = 0;
  let handoffCount = 0;
  let time = 0;
  const checkpoints = [];
  const diagnostics = [];
  const calls = [];
  const productId = "fixture-user-44";
  const runtimeId = "fixture-user-44";

  function counts(identity) {
    const existing = identity === "existing";
    const created = identity === "disposable";
    const productCount = existing ? 1 : created && productCreated ? 1 : 0;
    const runtimeCount = existing ? 1 : created && runtimeCreated ? 1 : 0;
    return {
      product: {
        count: productCount,
        legacyHashNull: true,
        id: productCount ? (created ? productId : "existing-user-1") : null,
      },
      runtime: {
        count: runtimeCount,
        id: runtimeCount ? (created ? runtimeId : "existing-user-1") : null,
      },
    };
  }

  function http(status, body, extra = {}) {
    return {
      status,
      rawText: JSON.stringify(body),
      parsedBody: body,
      parseError: null,
      fetchStarted: true,
      responseReceived: true,
      responseBodyReadable: true,
      safeHeaders: { contentType: "application/json", cfRay: "fixture-ray" },
      ...extra,
    };
  }

  const io = {
    checkpoints,
    diagnostics,
    calls,
    get signupActionCount() { return signupActionCount; },
    get handoffCount() { return handoffCount; },
    now() {
      time += 1;
      return `2026-09-29T00:00:${String(time % 60).padStart(2, "0")}.000Z`;
    },
    async writeCheckpoint(snapshot) {
      if (snapshot.current?.nextCheckpoint === failCheckpoint) {
        throw Object.assign(new Error("fixture artifact disk failure"), { name: "EIO" });
      }
      const encoded = JSON.stringify(snapshot);
      checkpoints.push(JSON.parse(encoded));
    },
    async emitDiagnostic(record) { diagnostics.push(structuredClone(record)); },
    async initialize() {
      calls.push("initialize");
      return { ready: true, productRegistrationEnabled: true, runtimeRegistrationEnabled: true };
    },
    async navigate({ target }) { calls.push(`navigate:${target}`); return { reached: true }; },
    async getCsrf({ state }) {
      calls.push(`csrf:${state}`);
      return { state, present: state !== "missing", token: "[fixture-only]" };
    },
    async countIdentities(identity) {
      calls.push(`counts:${identity}`);
      return counts(identity);
    },
    async countProductSessions({ owner }) {
      calls.push(`product-local-session-count:${owner}`);
      return 0;
    },
    async sendBounded({ caseName, identity }) {
      calls.push(`bounded:${caseName}`);
      if (scenario === "bounded-network-error" && caseName === "invalid-email") {
        const error = Object.assign(new TypeError("fixture socket failure before response"), {
          evidence: { fetchStarted: true, responseReceived: false },
          responseReceived: false,
        });
        throw error;
      }
      if (scenario === "invalid-email-502" && caseName === "invalid-email") {
        return http(502, { message: "Gateway failure" });
      }
      const expectedCount = identity === "existing" || identity === "disposable" ? 1 : 0;
      return http(400, { message: genericMessage }, {
        noAutomaticLogin: true,
        fixtureExpectedCount: expectedCount,
      });
    },
    async sendMatrix({ originState, csrfState }) {
      calls.push(`matrix:${originState}:${csrfState}`);
      let status = originState === "valid"
        ? csrfState === "valid" ? 400 : 403
        : 400;
      let message = originState === "valid" ? genericMessage : "ORIGIN_REJECTED";
      if (scenario === "invalid-origin-generic-400" && originState === "invalid") {
        status = 400;
        message = genericMessage;
      }
      if (scenario === "missing-csrf-wrong-status"
        && originState === "valid" && csrfState === "missing") {
        status = 400;
      }
      return http(status, { message });
    },
    async productAuth({ owner }) {
      calls.push(`product-auth:${owner}`);
      if (owner === "existing") {
        return { status: 200, authenticated: true, userId: "existing-user-1" };
      }
      return productCreated
        ? { status: 200, authenticated: true, userId: productId }
        : { status: 200, authenticated: false, userId: null };
    },
    async runtimeAuth({ owner }) {
      calls.push(`runtime-auth:${owner}`);
      if (owner === "existing") {
        return { status: 200, authenticated: true, userId: "existing-user-1" };
      }
      return runtimeCreated
        ? { status: 200, authenticated: true, userId: runtimeId }
        : { status: 200, authenticated: false, userId: null };
    },
    async signupAction() {
      calls.push("signup-action");
      signupActionCount += 1;
      if (signupActionCount > 1) throw new Error("signup action called more than once");
      if (scenario === "definite-signup-failure"
        || scenario === "definite-signup-failure-no-after-click") {
        return {
          outcome: "FAIL",
          requestCount: 1,
          response: http(400, { message: genericMessage }),
        };
      }
      if (scenario === "uncertain-absent") {
        return {
          outcome: "UNCERTAIN", requestCount: 1,
          response: { status: null, fetchStarted: true, responseReceived: false },
        };
      }
      productCreated = true;
      if (scenario !== "signup-runtime-missing" && scenario !== "uncertain-conflicting") {
        runtimeCreated = true;
      }
      if (scenario === "signup-timeout-after-mutation") {
        throw Object.assign(new Error("fixture browser response wait timed out"), {
          name: "TimeoutError",
          evidence: { fetchStarted: true, responseReceived: false },
          responseReceived: false,
        });
      }
      const uncertain = ["signup-runtime-missing", "uncertain-conflicting", "uncertain-succeeded"]
        .includes(scenario);
      return uncertain ? {
        outcome: "UNCERTAIN", requestCount: 1,
        response: { status: null, fetchStarted: true, responseReceived: false },
      } : {
        outcome: "SUCCESS", requestCount: 1,
        response: http(201, { success: true }),
      };
    },
    async reconcileSignup() {
      calls.push("signup-reconcile");
      const identityCounts = counts("disposable");
      const productAuth = productCreated
        ? { status: 200, authenticated: true, userId: productId }
        : { status: 200, authenticated: false, userId: null };
      const runtimeAuth = runtimeCreated
        ? { status: 200, authenticated: true, userId: runtimeId }
        : { status: 200, authenticated: false, userId: null };
      const observation = {
        counts: identityCounts,
        countsAfterClick: { disposable: identityCounts },
        productD1Id: identityCounts.product.id,
        runtimeD1Id: identityCounts.runtime.id,
        productAuth,
        runtimeAuth,
        runtimeSession: {
          exists: runtimeCreated, ownerMatches: runtimeCreated,
          revoked: runtimeCreated ? sessionRevoked.new : null,
        },
        productLocalSessionCount: 0,
        readErrors: null,
        requestCount: 1,
      };
      if (scenario === "definite-signup-failure-no-after-click") {
        delete observation.countsAfterClick;
      }
      if (scenario === "signup-runtime-auth-missing") {
        delete observation.runtimeAuth;
      }
      if (scenario === "signup-runtime-session-missing") {
        delete observation.runtimeSession;
      }
      if (scenario === "production-shaped-success") {
        observation.readErrors = [];
      }
      if (scenario === "signup-read-errors") {
        observation.readErrors = [{ operation: "runtime-session", message: "fixture read failed" }];
      }
      if (scenario === "signup-read-errors-missing") {
        delete observation.readErrors;
      }
      return observation;
    },
    async dashboard() {
      calls.push("dashboard:new");
      return {
        reached: true, status: 200, loginStatus: 200,
        projects: [{ id: 501, owner: productId }],
      };
    },
    async login({ owner }) {
      calls.push(`login:${owner}`);
      return {
        loginStatus: 200, dashboardReached: true, dashboardStatus: 200,
        projects: [{ id: 701, owner: "existing-user-1" }],
      };
    },
    async logout({ owner }) {
      calls.push(`logout:${owner}`);
      sessionRevoked[owner] = (scenario === "logout-not-revoked" && owner === "new")
        || (scenario === "existing-logout-not-revoked" && owner === "existing")
        ? false : true;
      return { status: 204, browserCredentialCleared: true, responseBodyReadable: true };
    },
    async runtimeSession({ owner }) {
      calls.push(`runtime-session:${owner}`);
      if (owner === "existing") {
        return { exists: true, ownerMatches: true, revoked: sessionRevoked.existing };
      }
      return {
        exists: runtimeCreated, ownerMatches: runtimeCreated,
        revoked: runtimeCreated ? sessionRevoked.new : null,
      };
    },
    async replayProductCredential({ owner }) {
      calls.push(`replay-product:${owner}`);
      return { status: 200, parseSucceeded: true, bodyIsNull: true };
    },
    async replayRuntimeCredential({ owner }) {
      calls.push(`replay-runtime:${owner}`);
      return { status: 200, parseSucceeded: true, authenticated: false };
    },
    async freshLogin({ owner }) {
      calls.push(`fresh-login:${owner}`);
      const isExisting = owner === "existing";
      const existingProjectId = scenario === "existing-project-ownership-changed" ? 702 : 701;
      return {
        productStatus: 200, productUserId: isExisting ? "existing-user-1" : productId,
        runtimeStatus: 200, runtimeAuthenticated: true,
        runtimeUserId: isExisting ? "existing-user-1" : runtimeId,
        dashboardReached: true, dashboardStatus: 200,
        projects: [{ id: isExisting ? existingProjectId : 501, owner: isExisting ? "existing-user-1" : productId }],
        projectOwnershipStable: true,
      };
    },
    async networkAudit() { calls.push("network-audit"); return { forbiddenHostnameCount: 0 }; },
    async cleanup() {
      calls.push("cleanup");
      if (cleanupFailure) throw Object.assign(new Error("fixture cleanup failed"), { name: "BrowserCloseError" });
    },
    async writeCredentialHandoff({ owner }) {
      calls.push(`credential-handoff:${owner}`);
      handoffCount += 1;
      if (handoffFailure) throw Object.assign(new Error("fixture handoff failed"), { name: "HandoffWriteError" });
      return { written: true, permissions: "0600", oneTime: true };
    },
  };
  return io;
}

export async function runFixture(options = {}) {
  const io = createFakeRegistrationIO(options);
  const result = await runRegistrationAcceptance(io, { fixture: true });
  return { result, io };
}

// This source-level guard ensures fixture tests stay attached to the one runner,
// rather than regressing into a test-only sequence.
test("the offline contract executes the authoritative runner", async () => {
  const { result, io } = await runFixture();
  assert.equal(result.status, "PASS");
  assert.equal(result.cases.length, expectedRegistrationCases.length);
  assert.ok(result.cases.every(item => item.status === "PASS"));
  assert.equal(io.handoffCount, 1);
  assert.ok(io.calls.indexOf("network-audit") < io.calls.indexOf("credential-handoff:new"));
  assert.equal(result.acceptance.status, "PASS");
  assert.equal(result.handoff.status, "WRITTEN");
  const durablePass = io.checkpoints.find(snapshot =>
    snapshot.current?.nextCheckpoint === "final-artifact");
  assert.equal(durablePass.status, "PASS");
  assert.equal(durablePass.acceptance.status, "PASS");
  assert.equal(durablePass.handoff.status, "PENDING");
});

for (const [scenario, expectedCase, expectedPhase] of [
  ["invalid-email-502", "invalid-email", "bounded-validation"],
  ["invalid-origin-generic-400", "registration-origin-invalid-csrf-valid", "origin-csrf-matrix"],
  ["missing-csrf-wrong-status", "registration-origin-valid-csrf-missing", "origin-csrf-matrix"],
  ["signup-runtime-missing", "single-public-ui-signup", "signup"],
  ["logout-not-revoked", "new-user-logout-revocation", "logout-revocation"],
  ["bounded-network-error", "invalid-email", "bounded-validation"],
]) {
  test(`shared runner preserves required failure diagnostics: ${scenario}`, async () => {
    const { result, io } = await runFixture({ scenario });
    assert.equal(result.status, scenario === "signup-runtime-missing" ? "UNKNOWN" : "FAIL");
    const failed = result.cases.find(item => item.caseName === expectedCase);
    assert.ok(failed, `failed case ${expectedCase} recorded`);
    assert.equal(failed.phase, expectedPhase);
    assert.match(failed.status, /^(?:FAIL|UNKNOWN)$/);
    assert.ok(result.cases.some(item => item.status === "NOT_RUN"));
    assert.equal(io.signupActionCount,
      ["signup-runtime-missing", "logout-not-revoked"].includes(scenario) ? 1 : 0);
    assert.notEqual(result.error?.message, "Error");
    assert.ok(io.checkpoints.length > 0);
    assert.equal(io.handoffCount, 0);
  });
}

test("network failure retains operation, cause, no-response evidence, and checkpoint", async () => {
  const { result } = await runFixture({ scenario: "bounded-network-error" });
  const failed = result.cases.find(item => item.caseName === "invalid-email");
  assert.equal(failed.operation, "registration-request");
  assert.equal(failed.error.name, "TypeError");
  assert.match(failed.error.message, /fixture socket failure/);
  assert.equal(failed.evidence.responseReceived, false);
  assert.equal(failed.evidence.fetchStarted, true);
  assert.ok(failed.lastCompletedCheckpoint);
  assert.ok(failed.nextCheckpoint);
});

test("uncertain signup with confirmed mutation succeeds without retry", async () => {
  const { result, io } = await runFixture({ scenario: "uncertain-succeeded" });
  assert.equal(result.status, "PASS");
  assert.equal(io.signupActionCount, 1);
  const signup = result.cases.find(item => item.caseName === "single-public-ui-signup");
  assert.equal(signup.evidence.reconciliationClassification, "SUCCESS");
  assert.equal(signup.evidence.action.response.responseReceived, false);
});

test("uncertain signup with absent mutation stops UNKNOWN without retry", async () => {
  const { result, io } = await runFixture({ scenario: "uncertain-absent" });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(io.signupActionCount, 1);
  assert.equal(result.signup.state, "SIGNUP_UNKNOWN");
  assert.ok(result.cases.some(item => item.caseName === "new-user-auth-authority" && item.status === "NOT_RUN"));
});

test("uncertain signup with conflicting evidence stops UNKNOWN without retry", async () => {
  const { result, io } = await runFixture({ scenario: "uncertain-conflicting" });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(io.signupActionCount, 1);
  const signup = result.cases.find(item => item.caseName === "single-public-ui-signup");
  assert.equal(signup.evidence.reconciliation.counts.product.count, 1);
  assert.equal(signup.evidence.reconciliation.counts.runtime.count, 0);
});

test("definite failed click with no mutation fails and never retries", async () => {
  const { result, io } = await runFixture({ scenario: "definite-signup-failure" });
  assert.equal(result.status, "FAIL");
  assert.equal(result.signup.state, "SIGNUP_FAILED");
  assert.equal(io.signupActionCount, 1);
  assert.ok(result.cases.some(item => item.caseName === "new-user-auth-authority" && item.status === "NOT_RUN"));
});

test("failed signup reconciles against final counts when countsAfterClick is absent", async () => {
  const { result, io } = await runFixture({ scenario: "definite-signup-failure-no-after-click" });
  assert.equal(result.status, "FAIL");
  assert.equal(result.signup.reconciliation, "FAIL");
  assert.equal(io.signupActionCount, 1);
  assert.equal(io.handoffCount, 0);
});

for (const scenario of ["signup-runtime-auth-missing", "signup-runtime-session-missing"]) {
  test(`missing ${scenario.endsWith("auth-missing") ? "runtime auth" : "runtime session"} evidence cannot confirm signup`, async () => {
    const { result, io } = await runFixture({ scenario });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.signup.state, "SIGNUP_UNKNOWN");
    assert.equal(io.signupActionCount, 1);
    assert.equal(io.handoffCount, 0);
  });
}

test("production-shaped empty readErrors array confirms successful reconciliation", async () => {
  const { result, io } = await runFixture({ scenario: "production-shaped-success" });
  assert.equal(result.status, "PASS");
  const signup = result.cases.find(item => item.caseName === "single-public-ui-signup");
  assert.deepEqual(signup.evidence.reconciliation.readErrors, []);
  assert.equal(signup.evidence.sharedSignupEvaluation.assertions.reconciliationSucceeded, true);
  assert.equal(io.handoffCount, 1);
});

for (const scenario of ["signup-read-errors", "signup-read-errors-missing"]) {
  test(`nonempty or missing reconciliation readErrors cannot confirm signup: ${scenario}`, async () => {
    const { result, io } = await runFixture({ scenario });
    assert.equal(result.status, "UNKNOWN");
    assert.equal(result.signup.state, "SIGNUP_UNKNOWN");
    assert.equal(io.handoffCount, 0);
  });
}

test("full run performs exactly one signup and all auth/session phases", async () => {
  const { result, io } = await runFixture();
  assert.equal(result.status, "PASS");
  assert.equal(io.signupActionCount, 1);
  assert.equal(io.handoffCount, 1);
  const names = result.cases.map(item => item.caseName);
  for (const name of [
    "duplicate-new-account-exact", "duplicate-new-account-case-variant",
    "new-user-auth-authority", "new-user-logout-revocation",
    "old-credential-replay", "new-user-fresh-login", "existing-user-auth-authority",
    "existing-user-logout-revocation", "existing-user-old-credential-replay",
    "existing-user-fresh-login", "browser-network-audit",
  ]) {
    assert.ok(names.includes(name), `lifecycle contains ${name}`);
  }
  for (const call of [
    "logout:new", "replay-product:new", "replay-runtime:new", "fresh-login:new",
    "login:existing", "logout:existing", "replay-product:existing",
    "replay-runtime:existing", "fresh-login:existing",
  ]) {
    assert.ok(io.calls.includes(call), `owner-parameterized operation ${call}`);
  }
});

test("checkpoint failure emits a structured fallback and preserves primary failure", async () => {
  const io = createFakeRegistrationIO({
    scenario: "invalid-email-502",
    failCheckpoint: "final-artifact",
  });
  const result = await runRegistrationAcceptance(io, { fixture: true });
  assert.equal(result.status, "FAIL");
  assert.equal(result.cases.find(item => item.caseName === "invalid-email").status, "FAIL");
  assert.equal(result.error.name, "BoundedRegistrationAssertionError");
  assert.equal(result.finalArtifactError.name, "ArtifactWriteError");
  assert.ok(io.diagnostics.some(item => item.type === "artifact-write-failure"));
  assert.equal(io.diagnostics.at(-1).originalResult.name, "BoundedRegistrationAssertionError");
});

test("success-path final artifact failure blocks handoff and preserves cleanup outcome", async () => {
  const artifactOnly = await runFixture({ failCheckpoint: "final-artifact" });
  assert.equal(artifactOnly.result.status, "FAIL");
  assert.equal(artifactOnly.result.error.name, "ArtifactWriteError");
  assert.equal(artifactOnly.result.handoff.status, "SKIPPED");
  assert.equal(artifactOnly.result.handoff.reason, "final-artifact-failed");
  assert.equal(artifactOnly.io.handoffCount, 0);

  const io = createFakeRegistrationIO({
    failCheckpoint: "final-artifact",
    cleanupFailure: true,
  });
  const result = await runRegistrationAcceptance(io, { fixture: true });
  assert.equal(result.status, "FAIL");
  assert.equal(result.acceptance.status, "PASS");
  assert.equal(result.error.name, "CleanupError");
  assert.equal(result.finalArtifactError.name, "ArtifactWriteError");
  assert.equal(result.cleanupErrors[0].name, "CleanupError");
  assert.equal(result.handoff.status, "SKIPPED");
  assert.equal(result.handoff.reason, "cleanup-failed");
  assert.equal(io.handoffCount, 0);
  const artifactDiagnostic = io.diagnostics.find(item => item.type === "artifact-write-failure");
  assert.equal(artifactDiagnostic.originalResult.name, "CleanupError");
  assert.ok(io.diagnostics.some(item =>
    item.type === "cleanup-failure" && item.primaryError?.name === "CleanupError"));
  assert.ok(io.checkpoints.every(snapshot => snapshot.status !== "PASS"));
});

test("cleanup failure remains secondary to acceptance failure", async () => {
  const { result, io } = await runFixture({ scenario: "invalid-email-502", cleanupFailure: true });
  assert.equal(result.status, "FAIL");
  assert.equal(result.error.name, "BoundedRegistrationAssertionError");
  assert.equal(result.cleanupErrors[0].name, "CleanupError");
  assert.ok(io.diagnostics.some(item => item.type === "cleanup-failure"));
  assert.equal(io.checkpoints.at(-1).status, "FAIL");
  assert.equal(io.checkpoints.at(-1).cleanupErrors[0].name, "CleanupError");
});

test("cleanup-only failure is reflected in the final persisted artifact", async () => {
  const { result, io } = await runFixture({ cleanupFailure: true });
  assert.equal(result.status, "FAIL");
  assert.equal(result.error.name, "CleanupError");
  assert.ok(result.cases.every(item => item.status === "PASS"));
  assert.equal(io.handoffCount, 0);
  assert.equal(result.handoff.status, "SKIPPED");
  assert.ok(io.checkpoints.every(snapshot => snapshot.status !== "PASS"));
  assert.equal(io.checkpoints.at(-1).current?.nextCheckpoint, "final-artifact");
  assert.equal(io.checkpoints.at(-1).status, "FAIL");
  assert.equal(io.checkpoints.at(-1).cleanupErrors[0].name, "CleanupError");
});

test("existing-user logout regression requires revocation and stable project ownership", async () => {
  const revokedFailure = await runFixture({ scenario: "existing-logout-not-revoked" });
  assert.equal(revokedFailure.result.status, "FAIL");
  assert.equal(revokedFailure.result.error.caseName, "existing-user-logout-revocation");
  assert.equal(revokedFailure.io.handoffCount, 0);

  const ownershipFailure = await runFixture({ scenario: "existing-project-ownership-changed" });
  assert.equal(ownershipFailure.result.status, "FAIL");
  const freshCase = ownershipFailure.result.cases.find(item =>
    item.caseName === "existing-user-fresh-login");
  assert.equal(freshCase.status, "FAIL");
  assert.equal(freshCase.evidence.evaluation.assertions.projectOwnershipStable, false);
  assert.equal(ownershipFailure.io.handoffCount, 0);
});

test("credential handoff is one-time, post-acceptance, and never attempted after failure", async () => {
  const failure = await runFixture({ scenario: "invalid-email-502" });
  assert.equal(failure.io.handoffCount, 0);
  assert.equal(failure.result.handoff.status, "SKIPPED");

  const writeFailure = await runFixture({ handoffFailure: true });
  assert.equal(writeFailure.result.status, "FAIL");
  assert.equal(writeFailure.result.acceptance.status, "PASS");
  assert.equal(writeFailure.result.handoff.status, "FAIL");
  assert.equal(writeFailure.result.error.name, "CredentialHandoffError");
  assert.equal(writeFailure.io.handoffCount, 1);
  assert.ok(writeFailure.io.checkpoints.some(snapshot =>
    snapshot.current?.nextCheckpoint === "final-artifact" && snapshot.status === "PASS"));
  assert.ok(writeFailure.io.checkpoints.some(snapshot =>
    snapshot.current?.nextCheckpoint === "handoff-acknowledgment"
      && snapshot.status === "FAIL" && snapshot.acceptance.status === "PASS"));
  assert.ok(writeFailure.io.calls.indexOf("network-audit")
    < writeFailure.io.calls.indexOf("credential-handoff:new"));
});

test("handoff acknowledgment persistence failure is UNKNOWN after durable acceptance PASS", async () => {
  const { result, io } = await runFixture({ failCheckpoint: "handoff-acknowledgment" });
  assert.equal(result.status, "UNKNOWN");
  assert.equal(result.acceptance.status, "PASS");
  assert.equal(result.handoff.status, "ACKNOWLEDGMENT_UNKNOWN");
  assert.equal(io.handoffCount, 1);
  assert.ok(io.checkpoints.some(snapshot =>
    snapshot.current?.nextCheckpoint === "final-artifact" && snapshot.status === "PASS"));
  assert.ok(io.diagnostics.some(item => item.type === "artifact-write-failure"));
});

test("signup response timeout reconciles once and never performs a second action", async () => {
  const { result, io } = await runFixture({ scenario: "signup-timeout-after-mutation" });
  assert.equal(result.status, "PASS");
  assert.equal(io.signupActionCount, 1);
  assert.equal(result.signup.actionError.name, "TimeoutError");
  assert.equal(result.signup.state, "SIGNUP_CONFIRMED");
});

test("fake adapter returns observations and contains no business classification", async () => {
  const io = createFakeRegistrationIO();
  const response = await io.sendMatrix({
    originState: "invalid", csrfState: "valid", csrf: { present: true },
    caseName: "registration-origin-invalid-csrf-valid",
  });
  assert.equal(response.status, 400);
  assert.equal(response.parsedBody.message, "ORIGIN_REJECTED");
  assert.equal(Object.hasOwn(response, "classification"), false);
});

test("the runner only depends on injected I/O and shared Task 12U evaluators", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./lib/task12v-registration-runner.mjs", import.meta.url), "utf8");
  assert.match(source, /from "\.\/task12u-registration-operator\.mjs"/);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /puppeteer|playwright/i);
  assert.match(source, /export async function runRegistrationAcceptance/);
});