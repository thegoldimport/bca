import {
  classifyBoundedResponse,
  classifyRegistrationMatrix,
  evaluateLogoutAcceptance,
  evaluateSignupAcceptance,
  safeMatrixBody,
  safeRawResponseText,
  sanitizeError,
  sanitizeText,
} from "./task12u-registration-operator.mjs";

const BOUNDED_CASES = [
  { name: "duplicate-existing-email", identity: "existing", expectedCount: 1 },
  { name: "case-variant-duplicate-existing-email", identity: "existing", expectedCount: 1 },
  { name: "invalid-email", identity: "invalid-email", expectedCount: 0 },
  { name: "weak-password", identity: "weak-password", expectedCount: 0 },
  { name: "missing-password", identity: "missing-password", expectedCount: 0 },
  { name: "invalid-request-shape", identity: "invalid-shape", expectedCount: 0 },
];
const MATRIX_CASES = ["valid", "invalid", "missing"].flatMap(originState =>
  ["valid", "missing", "invalid"].map(csrfState => ({
    name: `registration-origin-${originState}-csrf-${csrfState}`,
    originState,
    csrfState,
  })));
const LIFECYCLE_CASES = [
  ...BOUNDED_CASES.map(item => item.name),
  ...MATRIX_CASES.map(item => item.name),
  "pre-signup-identity-counts",
  "single-public-ui-signup",
  "duplicate-new-account-exact",
  "duplicate-new-account-case-variant",
  "new-user-auth-authority",
  "new-user-logout-revocation",
  "old-credential-replay",
  "new-user-fresh-login",
  "existing-user-auth-authority",
  "existing-user-logout-revocation",
  "existing-user-old-credential-replay",
  "existing-user-fresh-login",
  "browser-network-audit",
];
const SECRET_KEY = /(?:password|token|secret|authorization|cookie|credential|api.?key|email)/i;
function cloneSafe(value, depth = 0, seen = new WeakSet()) {
  if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
    return value ?? null;
  }
  if (typeof value === "string") return sanitizeText(value);
  if (typeof value !== "object" || depth > 8) return "[OMITTED]";
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map(item => cloneSafe(item, depth + 1, seen));
  const output = {};
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY.test(key)) {
      output[key] = "[REDACTED]";
    } else if (key === "rawText" && typeof item === "string") {
      output[key] = safeRawResponseText(item);
    } else if (key === "error" && item instanceof Error) {
      output[key] = sanitizeError(item);
    } else {
      output[key] = cloneSafe(item, depth + 1, seen);
    }
  }
  return output;
}

function errorFor(name, message, details = {}) {
  const error = new Error(message);
  error.name = name;
  Object.assign(error, details);
  return error;
}

function countFor(counts, identity) {
  const evidence = counts?.[identity];
  return {
    product: Number(evidence?.product?.count ?? -1),
    runtime: Number(evidence?.runtime?.count ?? -1),
    legacyHashNull: evidence?.product?.legacyHashNull === true,
  };
}

function countsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function reconciliationReadsSucceeded(readErrors) {
  return readErrors === null || Array.isArray(readErrors) && readErrors.length === 0;
}

function normalizedProjectIds(projects) {
  if (!Array.isArray(projects)) return null;
  const ids = projects.map(project => Number(project?.id));
  if (ids.some(id => !Number.isFinite(id))) return null;
  return ids.sort((left, right) => left - right);
}

function projectOwnershipMatches(before, after) {
  const beforeIds = normalizedProjectIds(before);
  const afterIds = normalizedProjectIds(after);
  return beforeIds !== null && afterIds !== null
    && JSON.stringify(beforeIds) === JSON.stringify(afterIds);
}

function responseSummary(response) {
  return {
    status: response?.status ?? null,
    fetchStarted: response?.fetchStarted === true,
    responseReceived: response?.responseReceived === true,
    rawText: typeof response?.rawText === "string" ? response.rawText : "",
    parsedBody: response?.parsedBody ?? null,
    parseError: response?.parseError ?? null,
  };
}

function classifyReconciledSignup(observation, action, preCounts) {
  const product = observation?.counts?.product;
  const runtime = observation?.counts?.runtime;
  const productAuth = observation?.productAuth;
  const runtimeAuth = observation?.runtimeAuth;
  const ids = [
    observation?.productD1Id,
    observation?.runtimeD1Id,
    productAuth?.userId,
    runtimeAuth?.userId,
  ];
  const available = observation?.readErrors === null
    || Array.isArray(observation?.readErrors) && observation.readErrors.length === 0;
  const exactOne = product?.count === 1 && runtime?.count === 1 && product?.legacyHashNull === true;
  const identityMapping = ids.every(id => id !== null && id !== undefined)
    && new Set(ids.map(String)).size === 1;
  const authenticated = productAuth?.status === 200 && productAuth?.authenticated === true
    && runtimeAuth?.status === 200 && runtimeAuth?.authenticated === true
    && String(productAuth?.userId) === String(observation?.productD1Id)
    && String(runtimeAuth?.userId) === String(observation?.runtimeD1Id);
  const sessionActive = observation?.runtimeSession?.exists === true
    && observation.runtimeSession.ownerMatches === true && observation.runtimeSession.revoked === false;
  const confirmed = available && exactOne && identityMapping && authenticated && sessionActive;
  if (confirmed) return { classification: "SUCCESS", confirmed, identityMapping, exactOne, authenticated, sessionActive };

  const noMutation = available && product?.count === 0 && runtime?.count === 0
    && productAuth?.authenticated === false && runtimeAuth?.authenticated === false;
  const definiteBoundedFailure = action?.outcome === "FAIL"
    && classifyBoundedResponse({
      status: action?.response?.status ?? null,
      parsedBody: action?.response?.parsedBody ?? null,
      parseError: action?.response?.parseError ?? null,
      expectedCount: preCounts.product,
      observedCount: product?.count === runtime?.count ? product?.count : -1,
      noAutomaticLogin: productAuth?.authenticated !== true && runtimeAuth?.authenticated !== true,
    }) === "PASS";
  const afterClick = observation.countsAfterClick ?? { disposable: observation.counts };
  const unchanged = countFor(afterClick, "disposable")
    .product === preCounts.product
    && countFor(afterClick, "disposable")
      .runtime === preCounts.runtime;
  if (noMutation && unchanged && definiteBoundedFailure) {
    return { classification: "FAIL", confirmed, identityMapping, exactOne, authenticated, sessionActive };
  }
  return { classification: "UNKNOWN", confirmed, identityMapping, exactOne, authenticated, sessionActive };
}

/**
 * The authoritative registration-acceptance sequence. Every environment-specific
 * operation is supplied by `io`; adapters return observations, never PASS/FAIL.
 *
 * I/O contract:
 * - initialize(config), getCsrf(state), countIdentities(subject),
 *   countProductSessions({ owner }), sendBounded(input), sendMatrix(input),
 *   productAuth({ owner }), runtimeAuth({ owner }), signupAction(input),
 *   reconcileSignup(input), dashboard(),
 *   login({ owner }), logout({ owner }), runtimeSession({ owner }),
 *   replayProductCredential({ owner }), replayRuntimeCredential({ owner }),
 *   freshLogin({ owner }), networkAudit(), writeCredentialHandoff(),
 *   cleanup(), writeCheckpoint(snapshot), emitDiagnostic(record).
 * - signupAction is called at most once. Its result is { outcome:
 *   "SUCCESS"|"FAIL"|"UNCERTAIN", response?, error? }. An exception after the
 *   call begins is treated as uncertain and is reconciled; it is never retried.
 * - reconcileSignup returns raw read observations for identity counts, auth,
 *   and session. The runner decides the outcome from explicit evidence below.
 * - login({ owner: "existing" }) returns loginStatus, dashboardReached,
 *   dashboardStatus, and projects: [{ id }]. dashboard() supplies reached,
 *   status, and projects for the already-authenticated new user.
 * - owner-scoped auth/session/replay/logout methods return the same raw evidence
 *   fields used by Task 12U's logout evaluator. freshLogin({ owner }) returns
 *   productStatus/productUserId, runtimeStatus/runtimeAuthenticated/runtimeUserId,
 *   dashboardReached/dashboardStatus, and projects.
 * - writeCredentialHandoff({ owner: "new" }) performs a one-time atomic handoff
 *   and returns { written: true }; it is called only after acceptance passes
 *   and cleanup succeeds, and its secret material must never enter artifacts.
 * - writeCheckpoint must atomically persist the shared artifact schema.
 */
export async function runRegistrationAcceptance(io, config = {}) {
  const required = [
    "initialize", "navigate", "getCsrf", "countIdentities", "countProductSessions",
    "sendBounded", "sendMatrix",
    "productAuth", "runtimeAuth", "signupAction", "reconcileSignup", "dashboard", "login",
    "logout", "runtimeSession", "replayProductCredential", "replayRuntimeCredential",
    "freshLogin", "networkAudit", "writeCredentialHandoff", "cleanup",
    "writeCheckpoint", "emitDiagnostic",
  ];
  for (const name of required) {
    if (typeof io?.[name] !== "function") {
      throw new TypeError(`Registration acceptance adapter is missing ${name}()`);
    }
  }

  const startedAt = io.now?.() ?? new Date().toISOString();
  const ledger = {
    schemaVersion: 1,
    status: "RUNNING",
    startedAt,
    completedAt: null,
    phase: "initialize",
    current: { operation: "initialize", nextCheckpoint: "phase-start" },
    signup: { state: "PRE_CLICK", actionCount: 0 },
    cases: [],
    operations: [],
    persistenceErrors: [],
    cleanupErrors: [],
  };
  let currentCase = null;
  let sequence = 0;
  let originalFailure = null;
  let persistenceBroken = false;

  async function checkpoint(label) {
    ledger.current.lastCompletedCheckpoint = ledger.current.lastCompletedCheckpoint || null;
    ledger.current.nextCheckpoint = label;
    const snapshot = cloneSafe(ledger);
    try {
      await io.writeCheckpoint(snapshot);
      ledger.current.lastCompletedCheckpoint = label;
      ledger.current.nextCheckpoint = null;
    } catch (error) {
      persistenceBroken = true;
      const diagnostic = {
        type: "artifact-write-failure",
        phase: ledger.phase,
        caseName: currentCase?.caseName ?? null,
        operation: ledger.current.operation,
        originalResult: originalFailure ? sanitizeError(originalFailure) : { status: ledger.status },
        artifactWriteError: sanitizeError(error),
      };
      ledger.persistenceErrors.push(diagnostic);
      try { await io.emitDiagnostic(cloneSafe(diagnostic)); } catch { /* fallback is best effort */ }
      const artifactWriteFailure = errorFor("ArtifactWriteError",
        "Acceptance checkpoint could not be persisted", {
          phase: ledger.phase, caseName: currentCase?.caseName ?? null,
          operation: ledger.current.operation, cause: error,
        });
      if (!originalFailure) {
        originalFailure = artifactWriteFailure;
      }
      throw artifactWriteFailure;
    }
  }

  async function operation(name, run) {
    ledger.current.operation = name;
    ledger.current.nextCheckpoint = `${name}:started`;
    const record = {
      phase: ledger.phase, caseName: currentCase?.caseName ?? null,
      operation: name, status: "STARTED", startedAt: io.now?.() ?? new Date().toISOString(),
    };
    ledger.operations.push(record);
    if (!persistenceBroken) await checkpoint(`${name}:before`);
    try {
      const result = await run();
      record.status = "COMPLETED";
      record.completedAt = io.now?.() ?? new Date().toISOString();
      record.observation = cloneSafe(result);
      if (!persistenceBroken) await checkpoint(`${name}:after`);
      return result;
    } catch (error) {
      record.status = "FAIL";
      record.completedAt = io.now?.() ?? new Date().toISOString();
      record.error = sanitizeError(error);
      record.responseReceived = error?.responseReceived === true;
      if (error?.evidence !== undefined) record.evidence = cloneSafe(error.evidence);
      if (!persistenceBroken) {
        try { await checkpoint(`${name}:failed`); } catch (writeError) {
          if (!originalFailure) originalFailure = error;
          if (writeError !== originalFailure) ledger.persistenceErrors.push({
            type: "artifact-write-failure", operation: name, artifactWriteError: sanitizeError(writeError),
          });
        }
      }
      throw error;
    }
  }

  async function runCase(phase, caseName, body) {
    sequence += 1;
    ledger.phase = phase;
    const record = {
      phase, caseName, sequence, status: "RUNNING",
      startedAt: io.now?.() ?? new Date().toISOString(),
      lastCompletedCheckpoint: null,
      nextCheckpoint: "case:start",
    };
    currentCase = record;
    ledger.cases.push(record);
    await checkpoint("case:start");
    try {
      await body(record);
      record.status = "PASS";
      record.completedAt = io.now?.() ?? new Date().toISOString();
      record.lastCompletedCheckpoint = "case:complete";
      record.nextCheckpoint = null;
      await checkpoint("case:complete");
      currentCase = null;
      return record;
    } catch (error) {
      record.status = error?.classification === "UNKNOWN" ? "UNKNOWN" : "FAIL";
      record.completedAt = io.now?.() ?? new Date().toISOString();
      record.error = sanitizeError(error);
      record.phase = error?.phase || phase;
      record.operation = error?.operation || ledger.current.operation;
      record.lastCompletedCheckpoint = ledger.current.lastCompletedCheckpoint;
      record.nextCheckpoint = ledger.current.nextCheckpoint;
      if (error?.evidence !== undefined) record.evidence = cloneSafe(error.evidence);
      originalFailure ||= error;
      throw error;
    }
  }

  function failCase(message, details = {}) {
    throw errorFor(details.name || "AcceptanceAssertionError", message, {
      phase: ledger.phase,
      caseName: currentCase?.caseName,
      operation: ledger.current.operation,
      ...details,
    });
  }

  async function boundedCase({ name, identity, expectedCount }) {
    await runCase("bounded-validation", name, async record => {
      const before = await operation("counts-before", () => io.countIdentities(identity));
      const csrf = await operation("csrf-acquisition", () => io.getCsrf({ state: "valid", caseName: name }));
      const response = await operation("registration-request", () =>
        io.sendBounded({ caseName: name, identity, csrf, expectedCount }));
      const after = await operation("counts-after", () => io.countIdentities(identity));
      const observedBefore = countFor({ [identity]: before }, identity);
      const observedAfter = countFor({ [identity]: after }, identity);
      const result = classifyBoundedResponse({
        status: response?.status ?? null,
        parsedBody: response?.parsedBody ?? null,
        parseError: response?.parseError ?? null,
        expectedCount,
        observedCount: observedAfter.product === observedAfter.runtime ? observedAfter.product : -1,
        noAutomaticLogin: response?.noAutomaticLogin !== false,
      });
      record.evidence = {
        request: { caseName: name, fetchStarted: response?.fetchStarted === true },
        response: responseSummary(response),
        countsBefore: observedBefore,
        countsAfter: observedAfter,
        countsUnchanged: countsMatch(observedBefore, observedAfter),
        classification: result,
      };
      if (result !== "PASS" || !countsMatch(observedBefore, observedAfter)) {
        failCase(`Bounded validation failed (${result})`, {
          name: "BoundedRegistrationAssertionError",
          classification: result === "UNKNOWN" ? "UNKNOWN" : "FAIL",
          evidence: record.evidence,
        });
      }
    });
  }

  async function matrixCase({ name, originState, csrfState }) {
    await runCase("origin-csrf-matrix", name, async record => {
      const before = {};
      for (const identity of ["existing", "invalid-email", "disposable"]) {
        before[identity] = await operation(`counts-before:${identity}`, () => io.countIdentities(identity));
      }
      const csrf = await operation("csrf-acquisition", () => io.getCsrf({ state: csrfState, caseName: name }));
      const response = await operation("matrix-request", () => io.sendMatrix({
        originState, csrfState, csrf, caseName: name,
      }));
      const after = {};
      for (const identity of ["existing", "invalid-email", "disposable"]) {
        after[identity] = await operation(`counts-after:${identity}`, () => io.countIdentities(identity));
      }
      const body = safeMatrixBody(response?.rawText ?? "");
      const classification = classifyRegistrationMatrix(originState, csrfState,
        response?.status ?? null, body);
      const unchanged = ["existing", "invalid-email", "disposable"]
        .every(identity => countsMatch(countFor({ [identity]: before[identity] }, identity),
          countFor({ [identity]: after[identity] }, identity)));
      record.evidence = {
        originState, csrfState, response: responseSummary(response),
        responseClassification: body.classification, countsBefore: cloneSafe(before),
        countsAfter: cloneSafe(after), countsUnchanged: unchanged, classification,
      };
      if (classification !== "PASS" || !unchanged) {
        failCase(`Origin/CSRF matrix failed (${classification})`, {
          name: "RegistrationMatrixAssertionError",
          classification: classification === "UNKNOWN" ? "UNKNOWN" : "FAIL",
          evidence: record.evidence,
        });
      }
    });
  }

  let signupDashboard = null;
  const logoutEvidenceByOwner = {};
  async function executeLifecycle() {
    ledger.phase = "initialize";
    await checkpoint("phase:initialize");
    const preconditions = await operation("initialize", () => io.initialize(config));
    if (preconditions?.ready !== true) {
      failCase("Acceptance prerequisites are not satisfied", {
        name: "AcceptancePreconditionError", evidence: preconditions,
      });
    }
    await operation("navigate-to-signup", () => io.navigate({ target: "signup" }));

    for (const bounded of BOUNDED_CASES) await boundedCase(bounded);
    for (const matrix of MATRIX_CASES) await matrixCase(matrix);

    await runCase("pre-signup", "pre-signup-identity-counts", async record => {
      const counts = await operation("identity-counts-before-signup", () =>
        io.countIdentities("disposable"));
      record.evidence = { counts: countFor({ disposable: counts }, "disposable") };
      if (record.evidence.counts.product !== 0 || record.evidence.counts.runtime !== 0) {
        failCase("Disposable identity already exists before signup", {
          name: "SignupPreconditionError", evidence: record.evidence,
        });
      }
      ledger.preSignupCounts = record.evidence.counts;
    });

    await runCase("signup", "single-public-ui-signup", async record => {
      if (ledger.signup.actionCount !== 0) {
        failCase("Signup action was already consumed", { name: "SignupActionInvariantError" });
      }
      ledger.signup.state = "CLICK_STARTED";
      await checkpoint("signup:click-started");
      let action;
      try {
        action = await operation("single-signup-action", () => {
          if (ledger.signup.actionCount !== 0) {
            failCase("Signup action was already consumed", { name: "SignupActionInvariantError" });
          }
          ledger.signup.actionCount += 1;
          return io.signupAction({ actionNumber: ledger.signup.actionCount });
        });
        ledger.signup.state = "CLICK_OUTCOME_OBSERVED";
      } catch (error) {
        action = {
          outcome: "UNCERTAIN",
          response: { status: null, fetchStarted: true, responseReceived: false },
          error: sanitizeError(error),
        };
        ledger.signup.actionError = action.error;
        ledger.signup.state = "RECONCILING";
      }
      const beforeCounts = ledger.preSignupCounts;
      const reconciliation = await operation("signup-reconciliation", () =>
        io.reconcileSignup({ identity: "disposable", action }));
      let dashboardReached = false;
      try {
        const dashboard = await operation("signup-dashboard", () => io.dashboard());
        signupDashboard = dashboard;
        dashboardReached = dashboard?.reached === true;
      } catch (error) {
        record.dashboardError = sanitizeError(error);
      }
      reconciliation.dashboardReached = dashboardReached;
      const outcome = classifyReconciledSignup(reconciliation, action, beforeCounts);
      const response = action.response || {};
      const successResponseObserved = action.outcome !== "SUCCESS"
        || Number.isInteger(response.status) && response.status >= 200 && response.status < 300
          && response.responseReceived === true && response.responseBodyReadable !== false;
      const evalEvidence = {
        clickCount: ledger.signup.actionCount,
        requestCount: action.requestCount ?? reconciliation.requestCount ?? null,
        responseStatus: response.status ?? null,
        responseBodyReadable: response.responseBodyReadable,
        dashboardReached: reconciliation.dashboardReached === true,
        productCount: reconciliation.counts?.product?.count,
        runtimeCount: reconciliation.counts?.runtime?.count,
        legacyHashNull: reconciliation.counts?.product?.legacyHashNull,
        productStatus: reconciliation.productAuth?.status,
        productD1Id: reconciliation.productD1Id,
        runtimeD1Id: reconciliation.runtimeD1Id,
        productMeId: reconciliation.productAuth?.userId,
        runtimeAuthenticated: reconciliation.runtimeAuth?.authenticated,
        runtimeCheckId: reconciliation.runtimeAuth?.userId,
        productLocalSessionCount: reconciliation.productLocalSessionCount,
        reconciliationSucceeded: reconciliationReadsSucceeded(reconciliation.readErrors),
        sessionEvidenceAvailable: reconciliation.runtimeSession !== undefined,
        runtimeSessionExists: reconciliation.runtimeSession?.exists,
        runtimeSessionOwnerMatches: reconciliation.runtimeSession?.ownerMatches,
        runtimeSessionActive: reconciliation.runtimeSession?.revoked === false,
      };
      const sharedEvaluation = evaluateSignupAcceptance(evalEvidence);
      record.evidence = {
        action: cloneSafe(action), reconciliation: cloneSafe(reconciliation),
        reconciliationClassification: outcome.classification,
        reconciliationRules: {
          success: "both identity counts are exactly one, product legacy hash is null, all four identity IDs match, product/runtime auth are authenticated and IDs match, runtime session exists and is active, and all reads succeeded",
          fail: "both identities are definitely absent, both auth states are unauthenticated, counts match the pre-signup zero counts, and action returned a definite 4xx rejection",
          unknown: "all other evidence combinations or reconciliation read errors",
        },
        sharedSignupEvaluation: sharedEvaluation,
        actionCount: ledger.signup.actionCount,
      };
      if (outcome.classification === "SUCCESS" && ledger.signup.actionCount === 1
        && evalEvidence.clickCount === 1 && evalEvidence.requestCount === 1
        && sharedEvaluation.assertions.identityMappingMatches
        && sharedEvaluation.assertions.productCountOne
        && sharedEvaluation.assertions.runtimeCountOne
        && sharedEvaluation.assertions.dashboardReached
        && sharedEvaluation.assertions.runtimeIdentityPresent
        && sharedEvaluation.assertions.productIdentityPresent
        && sharedEvaluation.assertions.productLocalSessionCountZero
        && sharedEvaluation.assertions.reconciliationSucceeded
        && successResponseObserved
        && (action.outcome === "SUCCESS" || action.outcome === "UNCERTAIN")) {
        ledger.signup.state = "SIGNUP_CONFIRMED";
        record.classification = "SUCCESS";
        ledger.signup.reconciliation = "SUCCESS";
        return;
      }
      const classification = outcome.classification === "SUCCESS" ? "FAIL" : outcome.classification;
      ledger.signup.state = classification === "UNKNOWN" ? "SIGNUP_UNKNOWN" : "SIGNUP_FAILED";
      ledger.signup.reconciliation = classification;
      failCase(`Signup reconciliation classified ${classification}`, {
        name: classification === "UNKNOWN" ? "SignupOutcomeUnknownError" : "SignupAcceptanceError",
        classification,
        evidence: record.evidence,
      });
    });

    for (const [caseName, variant] of [
      ["duplicate-new-account-exact", "exact"],
      ["duplicate-new-account-case-variant", "case-variant"],
    ]) {
      await runCase("new-user-duplicate-rejection", caseName, async record => {
        const before = await operation("duplicate-counts-before", () => io.countIdentities("disposable"));
        const csrf = await operation("duplicate-csrf", () => io.getCsrf({ state: "valid", caseName }));
        const response = await operation("duplicate-registration-request", () =>
          io.sendBounded({ caseName, identity: "disposable", variant, csrf, expectedCount: 1 }));
        const after = await operation("duplicate-counts-after", () => io.countIdentities("disposable"));
        const classification = classifyBoundedResponse({
          status: response?.status ?? null,
          parsedBody: response?.parsedBody ?? null,
          parseError: response?.parseError ?? null,
          expectedCount: 1,
          observedCount: after?.product?.count === after?.runtime?.count ? after.product.count : -1,
          noAutomaticLogin: response?.noAutomaticLogin !== false,
        });
        record.evidence = { response: responseSummary(response), before: cloneSafe(before),
          after: cloneSafe(after), classification };
        if (classification !== "PASS"
          || after?.product?.count !== 1 || after?.runtime?.count !== 1
          || !countsMatch(before, after)) {
          failCase(`New-user duplicate rejection failed (${classification})`, {
            name: "NewUserDuplicateAssertionError",
            classification: classification === "UNKNOWN" ? "UNKNOWN" : "FAIL",
            evidence: record.evidence,
          });
        }
      });
    }

    let authority;
    await runCase("new-user-authority", "new-user-auth-authority", async record => {
      const counts = await operation("authority-counts", () => io.countIdentities("disposable"));
      const productAuth = await operation("product-auth", () => io.productAuth({ owner: "new" }));
      const runtimeAuth = await operation("runtime-auth", () => io.runtimeAuth({ owner: "new" }));
      const runtimeSession = await operation("runtime-session-before-logout",
        () => io.runtimeSession({ owner: "new" }));
      const productLocalSessionCount = await operation("product-local-session-count",
        () => io.countProductSessions({ owner: "new" }));
      authority = { counts, productAuth, runtimeAuth, runtimeSession, productLocalSessionCount };
      const sharedEvaluation = evaluateSignupAcceptance({
        clickCount: 1, requestCount: 1, responseStatus: 201, responseBodyReadable: true,
        dashboardReached: signupDashboard?.reached === true,
        productCount: counts?.product?.count, runtimeCount: counts?.runtime?.count,
        legacyHashNull: counts?.product?.legacyHashNull,
        productStatus: productAuth?.status, productD1Id: counts?.product?.id,
        runtimeD1Id: counts?.runtime?.id, productMeId: productAuth?.userId,
        runtimeAuthenticated: runtimeAuth?.authenticated, runtimeCheckId: runtimeAuth?.userId,
        productLocalSessionCount,
        sessionEvidenceAvailable: true,
        runtimeSessionExists: runtimeSession?.exists,
        runtimeSessionOwnerMatches: runtimeSession?.ownerMatches,
        runtimeSessionActive: runtimeSession?.revoked === false,
      });
      const preLogoutEvaluation = evaluateLogoutAcceptance({
        stage: "pre-logout",
        loginStatus: productAuth?.status,
        dashboardReached: signupDashboard?.reached === true,
        dashboardStatus: signupDashboard?.status,
        projectsArray: Array.isArray(signupDashboard?.projects),
        productIdentityPresent: productAuth?.status === 200
          && productAuth?.authenticated === true && productAuth?.userId != null,
        productIdentityMatches: String(productAuth?.userId) === String(counts?.product?.id),
        runtimeAuthenticated: runtimeAuth?.status === 200 && runtimeAuth?.authenticated === true,
        runtimeIdentityMatches: String(runtimeAuth?.userId) === String(counts?.runtime?.id),
        sessionExists: runtimeSession?.exists,
        sessionOwnerMatches: runtimeSession?.ownerMatches,
        sessionRevoked: runtimeSession?.revoked,
        productLocalSessionCount,
      });
      record.evidence = {
        ...cloneSafe(authority), sharedSignupEvaluation: sharedEvaluation,
        preLogoutEvaluation,
      };
      if (!sharedEvaluation.passed || !preLogoutEvaluation.passed) {
        failCase(`New user authority failed: ${sharedEvaluation.errorMessage || preLogoutEvaluation.errorMessage}`, {
          name: sharedEvaluation.errorName || preLogoutEvaluation.errorName || "NewUserAuthorityError",
          evidence: record.evidence,
        });
      }
    });

    async function runOwnerLogoutLifecycle({ owner, identity, authorityState, caseNames }) {
      await runCase("logout-revocation", caseNames.logout, async record => {
        const logout = await operation(`${owner}-logout-action`, () => io.logout({ owner }));
        const session = await operation(`${owner}-runtime-session-after-logout`,
          () => io.runtimeSession({ owner }));
        logoutEvidenceByOwner[owner] = {
          logoutStatus: logout?.status,
          browserCredentialCleared: logout?.browserCredentialCleared === true,
          responseBodyReadable: logout?.responseBodyReadable,
          sessionExists: session?.exists,
          sessionOwnerMatches: session?.ownerMatches,
          sessionRevoked: session?.revoked,
        };
        record.evidence = { logout: cloneSafe(logout), session: cloneSafe(session) };
        if (logout?.status !== 204 || logout?.browserCredentialCleared !== true
          || logout?.responseBodyReadable === false || session?.exists !== true
          || session?.ownerMatches !== true || session?.revoked !== true) {
          failCase(`${owner} user logout did not clear credentials and revoke its runtime session`, {
            name: "RuntimeSessionNotRevokedError", evidence: record.evidence,
          });
        }
      });

      await runCase("old-credential-replay", caseNames.replay, async record => {
        const productReplay = await operation(`${owner}-old-product-credential-replay`,
          () => io.replayProductCredential({ owner }));
        const runtimeReplay = await operation(`${owner}-old-runtime-credential-replay`,
          () => io.replayRuntimeCredential({ owner }));
        const evidence = {
          stage: "after-logout",
          ...logoutEvidenceByOwner[owner],
          oldProductStatus: productReplay?.status,
          oldProductParseSucceeded: productReplay?.parseSucceeded === true,
          oldProductBodyIsNull: productReplay?.bodyIsNull === true,
          oldRuntimeStatus: runtimeReplay?.status,
          oldRuntimeParseSucceeded: runtimeReplay?.parseSucceeded === true,
          oldRuntimeAuthenticated: runtimeReplay?.authenticated,
        };
        const result = evaluateLogoutAcceptance(evidence);
        logoutEvidenceByOwner[owner] = evidence;
        record.evidence = {
          productReplay: cloneSafe(productReplay), runtimeReplay: cloneSafe(runtimeReplay),
          evaluation: result,
        };
        if (!result.passed) {
          failCase(`${owner} user logout/revocation failed: ${result.errorMessage}`, {
            name: result.errorName || "LogoutAcceptanceError", evidence: record.evidence,
          });
        }
      });

      await runCase("fresh-login", caseNames.fresh, async record => {
        const fresh = await operation(`${owner}-fresh-login`, () => io.freshLogin({ owner }));
        const currentCounts = await operation(`${owner}-fresh-login-counts`,
          () => io.countIdentities(identity));
        const freshProjectIds = normalizedProjectIds(fresh?.projects);
        const priorProjectIds = authorityState.projectIds;
        const projectOwnershipStable = owner === "existing"
          ? projectOwnershipMatches(authorityState.login?.projects, fresh?.projects)
          : fresh?.projectOwnershipStable !== false
            && (priorProjectIds === null || projectOwnershipMatches(
              signupDashboard?.projects, fresh?.projects));
        const evidence = {
          ...logoutEvidenceByOwner[owner],
          stage: "complete",
          freshProductIdentityPresent: fresh?.productStatus === 200 && fresh?.productUserId != null,
          freshProductIdentityMatches: String(fresh?.productUserId)
            === String(authorityState.counts.product.id),
          freshRuntimeAuthenticated: fresh?.runtimeStatus === 200
            && fresh?.runtimeAuthenticated === true
            && String(fresh?.runtimeUserId) === String(authorityState.counts.runtime.id),
          freshDashboardReached: fresh?.dashboardReached === true
            && fresh?.dashboardStatus === 200 && Array.isArray(fresh?.projects),
          countsOne: currentCounts?.product?.count === 1 && currentCounts?.runtime?.count === 1,
          projectOwnershipStable,
        };
        const result = evaluateLogoutAcceptance(evidence);
        record.evidence = {
          fresh: cloneSafe(fresh), counts: cloneSafe(currentCounts),
          previousProjectIds: priorProjectIds, freshProjectIds, evaluation: result,
        };
        if (!result.passed) failCase(`${owner} user fresh login failed: ${result.errorMessage}`, {
          name: result.errorName || "FreshLoginAcceptanceError", evidence: record.evidence,
        });
      });
    }

    await runOwnerLogoutLifecycle({
      owner: "new", identity: "disposable", authorityState: {
        ...authority,
        login: signupDashboard,
        projectIds: normalizedProjectIds(signupDashboard?.projects),
      },
      caseNames: {
        logout: "new-user-logout-revocation",
        replay: "old-credential-replay",
        fresh: "new-user-fresh-login",
      },
    });

    let existingAuthority;
    await runCase("existing-user-authority", "existing-user-auth-authority", async record => {
      const login = await operation("existing-user-login-before-logout",
        () => io.login({ owner: "existing" }));
      const counts = await operation("existing-user-authority-counts",
        () => io.countIdentities("existing"));
      const productAuth = await operation("existing-user-product-auth",
        () => io.productAuth({ owner: "existing" }));
      const runtimeAuth = await operation("existing-user-runtime-auth",
        () => io.runtimeAuth({ owner: "existing" }));
      const runtimeSession = await operation("existing-user-runtime-session-before-logout",
        () => io.runtimeSession({ owner: "existing" }));
      const productLocalSessionCount = await operation("existing-user-product-session-count",
        () => io.countProductSessions({ owner: "existing" }));
      existingAuthority = {
        login, counts, productAuth, runtimeAuth, runtimeSession,
        productLocalSessionCount, projectIds: normalizedProjectIds(login?.projects),
      };
      const evaluation = evaluateLogoutAcceptance({
        stage: "pre-logout",
        loginStatus: login?.loginStatus,
        dashboardReached: login?.dashboardReached === true,
        dashboardStatus: login?.dashboardStatus,
        projectsArray: Array.isArray(login?.projects),
        productIdentityPresent: productAuth?.status === 200
          && productAuth?.authenticated === true && productAuth?.userId != null,
        productIdentityMatches: String(productAuth?.userId) === String(counts?.product?.id),
        runtimeAuthenticated: runtimeAuth?.status === 200 && runtimeAuth?.authenticated === true,
        runtimeIdentityMatches: String(runtimeAuth?.userId) === String(counts?.runtime?.id),
        sessionExists: runtimeSession?.exists,
        sessionOwnerMatches: runtimeSession?.ownerMatches,
        sessionRevoked: runtimeSession?.revoked,
        productLocalSessionCount,
      });
      record.evidence = { ...cloneSafe(existingAuthority), evaluation };
      if (!evaluation.passed || counts?.product?.count !== 1 || counts?.runtime?.count !== 1
        || existingAuthority.projectIds === null || existingAuthority.projectIds.length === 0) {
        failCase(`Existing-user logout precondition failed: ${evaluation.errorMessage || "project or identity evidence missing"}`, {
          name: evaluation.errorName || "ExistingUserAuthorityError",
          evidence: record.evidence,
        });
      }
    });

    await runOwnerLogoutLifecycle({
      owner: "existing", identity: "existing", authorityState: existingAuthority,
      caseNames: {
        logout: "existing-user-logout-revocation",
        replay: "existing-user-old-credential-replay",
        fresh: "existing-user-fresh-login",
      },
    });

    await runCase("network-audit", "browser-network-audit", async record => {
      const audit = await operation("network-audit", () => io.networkAudit());
      record.evidence = cloneSafe(audit);
      if (audit?.forbiddenHostnameCount !== 0) {
        failCase("Forbidden customer host observed in browser network audit", {
          name: "ForbiddenCustomerHostError", evidence: record.evidence,
        });
      }
    });
  }

  try {
    await executeLifecycle();
    ledger.status = "PASS";
  } catch (error) {
    originalFailure ||= error;
    const classification = error?.classification === "UNKNOWN" ? "UNKNOWN" : "FAIL";
    ledger.status = classification;
    if (currentCase && currentCase.status !== "PASS") {
      currentCase.nextCheckpoint = ledger.current.nextCheckpoint || "final-artifact";
      currentCase.lastCompletedCheckpoint = ledger.current.lastCompletedCheckpoint;
      ledger.current.nextCheckpoint = currentCase.nextCheckpoint;
    }
    ledger.error = {
      ...sanitizeError(originalFailure),
      phase: originalFailure?.phase || ledger.phase,
      caseName: originalFailure?.caseName || currentCase?.caseName || null,
      operation: originalFailure?.operation || ledger.current.operation,
      lastCompletedCheckpoint: ledger.current.lastCompletedCheckpoint,
      nextCheckpoint: ledger.current.nextCheckpoint,
    };
    if (currentCase?.status === "RUNNING") {
      currentCase.status = classification;
      currentCase.error ||= sanitizeError(originalFailure);
      if (originalFailure?.evidence !== undefined) currentCase.evidence = cloneSafe(originalFailure.evidence);
      currentCase.completedAt = io.now?.() ?? new Date().toISOString();
    }
    const failedSequence = currentCase?.sequence ?? sequence;
    for (let index = failedSequence; index < LIFECYCLE_CASES.length; index += 1) {
      if (!ledger.cases.some(item => item.sequence === index + 1)) {
        const caseName = LIFECYCLE_CASES[index];
        ledger.cases.push({
          phase: "acceptance", caseName, sequence: index + 1,
          status: "NOT_RUN", startedAt: null, completedAt: null,
        });
      }
    }
  } finally {
    const acceptanceStatus = ledger.status;
    if (currentCase) currentCase = null;
    const acceptancePassed = acceptanceStatus === "PASS";
    ledger.acceptance = {
      status: acceptanceStatus,
      completedAt: io.now?.() ?? new Date().toISOString(),
    };
    ledger.handoff = {
      status: acceptancePassed ? "PENDING" : "SKIPPED",
      completedAt: null,
      ...(acceptancePassed ? {} : { reason: "acceptance-not-pass" }),
    };
    let durablePassArtifact = false;
    let cleanupSucceeded = true;
    if (acceptancePassed) ledger.status = "RUNNING";
    ledger.phase = "cleanup";
    try {
      await operation("cleanup", () => io.cleanup());
    } catch (error) {
      cleanupSucceeded = false;
      const cleanupFailure = errorFor("CleanupError", "Acceptance cleanup failed", {
        phase: ledger.phase, operation: "cleanup", cause: error,
      });
      const cleanupError = sanitizeError(cleanupFailure);
      ledger.cleanupErrors.push(cleanupError);
      if (!originalFailure) {
        originalFailure = cleanupFailure;
      }
      if (acceptancePassed && ledger.status === "RUNNING") {
        ledger.status = "FAIL";
        ledger.error = {
          ...sanitizeError(originalFailure || cleanupFailure),
          phase: ledger.phase,
          caseName: null,
          operation: "cleanup",
          lastCompletedCheckpoint: ledger.current.lastCompletedCheckpoint,
          nextCheckpoint: ledger.current.nextCheckpoint,
        };
      }
      if (acceptancePassed) {
        ledger.handoff.status = "SKIPPED";
        ledger.handoff.reason = "cleanup-failed";
      }
      try {
        await io.emitDiagnostic({
          type: "cleanup-failure",
          status: ledger.status,
          primaryError: ledger.error ?? null,
          cleanupError,
        });
      } catch { /* best effort */ }
    }

    if (!persistenceBroken) {
      if (acceptancePassed && cleanupSucceeded) {
        ledger.phase = "completion";
        ledger.status = "PASS";
      } else if (acceptancePassed) {
        ledger.status = "FAIL";
        ledger.handoff.status = "SKIPPED";
        ledger.handoff.reason = "cleanup-failed";
      }
      ledger.completedAt = io.now?.() ?? new Date().toISOString();
      try {
        ledger.current.operation = "final-artifact";
        await checkpoint("final-artifact");
        durablePassArtifact = acceptancePassed && cleanupSucceeded;
      } catch (error) {
        if (acceptancePassed) ledger.status = "FAIL";
        ledger.finalArtifactError = sanitizeError(error);
        if (acceptancePassed && cleanupSucceeded) {
          ledger.handoff.status = "SKIPPED";
          ledger.handoff.reason = "final-artifact-failed";
        }
        if (!ledger.error) {
          ledger.error = {
            ...sanitizeError(originalFailure || error),
            phase: ledger.phase,
            caseName: null,
            operation: "final-artifact",
            lastCompletedCheckpoint: ledger.current.lastCompletedCheckpoint,
            nextCheckpoint: ledger.current.nextCheckpoint,
          };
        }
      }
    }

    if (acceptancePassed && durablePassArtifact && ledger.status === "PASS") {
      ledger.phase = "credential-handoff";
      ledger.handoff.status = "STARTED";
      let handoffObservation = null;
      let handoffCallStarted = false;
      try {
        if (ledger.signup.state !== "SIGNUP_CONFIRMED" || ledger.signup.actionCount !== 1) {
          throw errorFor("CredentialHandoffPreconditionError",
            "Credential handoff requires one confirmed signup", {
              phase: ledger.phase, operation: "credential-handoff",
            });
        }
        handoffObservation = await operation("credential-handoff-write", async () => {
          handoffCallStarted = true;
          handoffObservation = await io.writeCredentialHandoff({ owner: "new" });
          return handoffObservation;
        });
        if (handoffObservation?.written !== true) {
          throw errorFor("CredentialHandoffError", "Credential handoff was not written", {
            phase: ledger.phase, operation: "credential-handoff",
          });
        }
        ledger.handoff = {
          status: "WRITTEN",
          completedAt: io.now?.() ?? new Date().toISOString(),
          acknowledgment: cloneSafe(handoffObservation),
        };
        ledger.completedAt = io.now?.() ?? new Date().toISOString();
        await checkpoint("handoff-acknowledgment");
      } catch (error) {
        const acknowledgmentUnknown = handoffObservation?.written === true
          && error?.name === "ArtifactWriteError";
        const handoffFailure = handoffCallStarted && !handoffObservation
          ? errorFor("CredentialHandoffError", "Credential handoff failed", {
            phase: ledger.phase, operation: "credential-handoff", cause: error,
          })
          : error;
        originalFailure ||= handoffFailure;
        ledger.handoff.status = acknowledgmentUnknown ? "ACKNOWLEDGMENT_UNKNOWN"
          : handoffCallStarted ? "FAIL" : "NOT_ATTEMPTED";
        ledger.handoff.error = sanitizeError(handoffFailure);
        ledger.status = acknowledgmentUnknown ? "UNKNOWN" : "FAIL";
        ledger.error = {
          ...sanitizeError(originalFailure),
          phase: originalFailure?.phase || ledger.phase,
          caseName: null,
          operation: originalFailure?.operation || ledger.current.operation,
          lastCompletedCheckpoint: ledger.current.lastCompletedCheckpoint,
          nextCheckpoint: ledger.current.nextCheckpoint,
        };
        if (!acknowledgmentUnknown && !persistenceBroken) {
          try {
            ledger.completedAt = io.now?.() ?? new Date().toISOString();
            await checkpoint("handoff-acknowledgment");
          } catch { /* checkpoint emitted a structured fallback diagnostic */ }
        }
        if (handoffCallStarted && !acknowledgmentUnknown) {
          try {
            await io.emitDiagnostic({
              type: "credential-handoff-failure",
              status: ledger.status,
              acceptanceStatus: ledger.acceptance.status,
              error: ledger.handoff.error,
            });
          } catch { /* best effort */ }
        }
      }
    }
  }
  return ledger;
}