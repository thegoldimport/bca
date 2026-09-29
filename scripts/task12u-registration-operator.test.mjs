import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  classifyBoundedResponse,
  classifyRegistrationMatrix,
  evaluateLogoutAcceptance,
  evaluateSignupAcceptance,
  isExplicitExecute,
  parseResponseText,
  recordCaseResult,
  responseEvidence,
  safeRawResponseText,
  safeMatrixBody,
  sanitizeError,
  sanitizeText,
  writeAtomicArtifact,
} from "./lib/task12u-registration-operator.mjs";

const genericMessage = "Could not create your account. Check your details.";

// Full lifecycle success/failure scenarios run through the authoritative Task 12V runner:
// scripts/task12v-registration-runner.test.mjs.

test("live operator accepts only the exact standalone execute argument", () => {
  assert.equal(isExplicitExecute(["--execute"]), true);
  assert.equal(isExplicitExecute([]), false);
  assert.equal(isExplicitExecute(["--execute", "--offline"]), false);
  assert.equal(isExplicitExecute(["--execute=true"]), false);
});

test("live CLI is guarded and delegates sequencing to the Task 12V runner", async () => {
  const source = await readFile(new URL("./task12r-registration-acceptance.mjs", import.meta.url), "utf8");
  const adapter = await readFile(new URL("./lib/task12v-production-adapter.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(!isExplicitExecute\(process\.argv\.slice\(2\)\)\)/);
  assert.doesNotMatch(source, /process\.argv\.includes\(["']--execute["']\)/);
  assert.match(source, /runRegistrationAcceptance\(io\)/);
  assert.ok(source.indexOf("createTask12VProductionAdapter()")
    > source.indexOf("if (!isExplicitExecute(process.argv.slice(2)))"),
  "production adapter must only be constructed after the exact execute guard");
  assert.match(adapter, /signupResponseTask = page\.waitForResponse/);
  assert.match(adapter, /requireCondition\(!signupActionConsumed, "Signup action cannot be retried"\)/);
  assert.match(adapter, /async reconcileSignup\(\)/);
  assert.match(adapter, /access_token_hash=\?/);
});

function parse(raw) {
  const result = parseResponseText(raw);
  return { parsedBody: result.parsedBody, parseError: result.parseError };
}

test("bounded fixtures use actual shared classification rules", () => {
  const valid = parse(JSON.stringify({ message: genericMessage }));
  for (const name of [
    "duplicate-existing", "case-variant-existing", "invalid-email", "weak-password",
    "missing-password", "invalid-shape",
  ]) {
    assert.equal(classifyBoundedResponse({
      status: 400, ...valid, expectedCount: 0, observedCount: 0, noAutomaticLogin: true,
    }), "PASS", name);
  }
  assert.equal(classifyBoundedResponse({
    status: 502, ...valid, expectedCount: 0, observedCount: 0, noAutomaticLogin: true,
  }), "FAIL", "unexpected 502");
  const malformed = parse("<html>broken");
  assert.equal(classifyBoundedResponse({
    status: 400, ...malformed, expectedCount: 0, observedCount: 0,
  }), "FAIL");
  assert.equal(classifyBoundedResponse({
    status: 400, ...valid, expectedCount: 0, observedCount: 1,
  }), "FAIL", "count mismatch");
  assert.equal(classifyBoundedResponse({
    status: null, ...valid, expectedCount: 0, observedCount: 0,
  }), "UNKNOWN", "timeout/no response");
});

test("matrix fixtures enforce exact Origin/CSRF response semantics", () => {
  assert.equal(classifyRegistrationMatrix("valid", "valid", 400, safeMatrixBody(JSON.stringify({ message: genericMessage }))), "PASS");
  assert.equal(classifyRegistrationMatrix("valid", "missing", 403, safeMatrixBody(JSON.stringify({ message: genericMessage }))), "PASS");
  assert.equal(classifyRegistrationMatrix("valid", "invalid", 403, safeMatrixBody(JSON.stringify({ message: genericMessage }))), "PASS");
  for (const originState of ["invalid", "missing"]) {
    assert.equal(classifyRegistrationMatrix(originState, "valid", 400,
      safeMatrixBody('{"message":"ORIGIN_REJECTED"}')), "PASS");
    assert.equal(classifyRegistrationMatrix(originState, "valid", 400,
      safeMatrixBody(JSON.stringify({ message: genericMessage }))), "FAIL");
  }
  assert.equal(classifyRegistrationMatrix("valid", "missing", 400,
    safeMatrixBody(JSON.stringify({ message: genericMessage }))), "FAIL");
  assert.equal(classifyRegistrationMatrix("invalid", "valid", 400,
    safeMatrixBody('{"message":"Duplicate account"}')), "UNKNOWN");
});

test("response evidence retains only fail-closed raw representations and safe headers", () => {
  const evidence = responseEvidence({
    status: 502,
    headers: { "content-type": "text/html", "cf-ray": "ray-123", "set-cookie": "credential=secret" },
    rawText: "<html>not json</html>",
  });
  assert.equal(evidence.status, 502);
  assert.equal(evidence.rawText, "[REDACTED non-JSON response; length=21]");
  assert.ok(evidence.parseError);
  assert.deepEqual(evidence.safeHeaders, { cfRay: "ray-123", contentType: "text/html" });
  const malformed = parseResponseText("{malformed");
  assert.equal(malformed.rawText, "[REDACTED non-JSON response; length=10]");
  assert.ok(malformed.parseError);
  const empty = parseResponseText("");
  assert.equal(empty.rawText, "[REDACTED non-JSON response; length=0]");
  assert.equal(empty.parseError.name, "SyntaxError");
  assert.equal(typeof empty.parseError.message, "string");
  assert.equal(typeof empty.parseError.stack, "string");
  const responseReadFailure = responseEvidence({
    status: 503,
    headers: { "content-type": "application/json", "cf-ray": "partial-ray" },
    rawText: "partial-body",
    fetchStarted: true,
    responseReceived: true,
    error: Object.assign(new Error("fixture response body read failure"), { name: "BodyReadError" }),
  });
  assert.equal(responseReadFailure.status, 503);
  assert.equal(responseReadFailure.responseReceived, true);
  assert.equal(responseReadFailure.rawText, "[REDACTED non-JSON response; length=12]");
  assert.deepEqual(responseReadFailure.safeHeaders, {
    cfRay: "partial-ray", contentType: "application/json",
  });
  assert.equal(responseReadFailure.error.name, "BodyReadError");
  assert.match(responseReadFailure.error.message, /body read failure/);
  assert.doesNotMatch(sanitizeText("email: person@example.net password=secret"), /person@example\.net|secret/);
});

test("empty, malformed, and non-JSON bounded response evidence remains diagnostic", () => {
  for (const rawText of ["", "{not-json", "<html>gateway response</html>"]) {
    const parsed = parseResponseText(rawText);
    const result = classifyBoundedResponse({
      status: 502, parsedBody: parsed.parsedBody, parseError: parsed.parseError,
      expectedCount: 0, observedCount: 0,
    });
    assert.equal(result, "FAIL");
    assert.match(parsed.rawText, /^\[REDACTED (?:non-JSON|JSON) response; length=\d+\]$/);
    assert.equal(parsed.parseError.name, "SyntaxError");
    assert.equal(typeof parsed.parseError.message, "string");
    assert.equal(typeof parsed.parseError.stack, "string");
  }
});

test("raw, nested JSON, URLs, and structured errors fail closed for secrets and PII", () => {
  const knownSafe = '{"message":"ORIGIN_REJECTED"}';
  assert.equal(safeRawResponseText(knownSafe), knownSafe);

  const unknown = JSON.stringify({
    success: false,
    apiKey: "api-key-super-secret-1234567890",
    nested: { session: "session-secret-12345678901234567890", email: "inner@example.com" },
    message: "failed for outer@example.com",
  });
  const safeUnknown = safeRawResponseText(unknown);
  assert.equal(safeUnknown, '{"success":false,"message":"[REDACTED]"}');
  assert.doesNotMatch(safeUnknown, /api-key|session-secret|example\.com/);

  const nestedEscaped = String.raw`{\"outer\":{\"token\":\"nested-secret-value-12345678901234567890\"},\"email\":\"escaped@example.com\"}`;
  const sanitized = sanitizeText(nestedEscaped);
  assert.doesNotMatch(sanitized, /nested-secret-value|escaped@example\.com/);
  const authText = sanitizeText("Authorization: Basic private-password, then Bearer another-secret");
  assert.doesNotMatch(authText, /private-password|another-secret/);
  assert.doesNotMatch(sanitizeText("qmvxjznrpkthwbdflgscayue"), /qmvxjznrpkthwbdflgscayue/);
  assert.match(sanitizeText("RuntimeIdentityMissingError"), /RuntimeIdentityMissingError/);
  const text = sanitizeText("request sent https://host.test/path?session=private#fragment apiKey=api-key-012345678901234567890123");
  assert.doesNotMatch(text, /session=private|fragment|api-key-0123456789/);
  assert.match(text, /https:\/\/host\.test\/path/);

  const error = Object.assign(new Error(
    'nested {"password":"p@ssword"} and Authorization: Bearer stack-secret https://host.test/callback?token=private',
  ), {
    stack: 'Error: token="stack-token-12345678901234567890"\n at https://host.test/file?apiKey=secret',
  });
  const safeError = sanitizeError(error);
  const serialized = JSON.stringify(safeError);
  assert.doesNotMatch(serialized, /p@ssword|stack-secret|stack-token|token=private|apiKey=secret/);
  assert.match(safeError.stack, /https:\/\/host\.test\/file/);
});

function validSignupEvidence() {
  return {
    clickCount: 1, requestCount: 1, responseStatus: 201, dashboardReached: true,
    productCount: 1, runtimeCount: 1, legacyHashNull: true,
    productStatus: 200, productD1Id: "user-1", runtimeD1Id: "user-1",
    productMeId: "user-1", runtimeAuthenticated: true, runtimeCheckId: "user-1",
    productLocalSessionCount: 0,
  };
}

test("live-shared signup evaluator detects every identity and authority failure", () => {
  assert.equal(evaluateSignupAcceptance(validSignupEvidence()).passed, true);
  const variants = [
    [{ productCount: 0 }, "ProductIdentityCountMismatchError"],
    [{ productCount: 2 }, "ProductIdentityCountMismatchError"],
    [{ runtimeCount: 0 }, "RuntimeIdentityCountMismatchError"],
    [{ runtimeCount: 2 }, "RuntimeIdentityCountMismatchError"],
    [{ productMeId: null }, "ProductIdentityMissingError"],
    [{ runtimeAuthenticated: false, runtimeCheckId: null }, "RuntimeIdentityMissingError"],
    [{ runtimeCheckId: "other-user" }, "IdentityMappingMismatchError"],
    [{ runtimeD1Id: "different-user" }, "IdentityMappingMismatchError"],
    [{ sessionEvidenceAvailable: true, runtimeSessionExists: false }, "RuntimeSessionMissingError"],
    [{ productLocalSessionCount: 1 }, "ProductSessionAuthorityUnexpectedError"],
  ];
  for (const [override, errorName] of variants) {
    const result = evaluateSignupAcceptance({ ...validSignupEvidence(), ...override });
    assert.equal(result.passed, false, errorName);
    assert.equal(result.errorName, errorName);
  }
});

function validLogoutEvidence() {
  return {
    stage: "complete",
    logoutStatus: 204, browserCredentialCleared: true,
    sessionExists: true, sessionOwnerMatches: true, sessionRevoked: true,
    responseBodyReadable: true,
    oldProductStatus: 200, oldProductParseSucceeded: true, oldProductBodyIsNull: true,
    oldRuntimeStatus: 200, oldRuntimeParseSucceeded: true, oldRuntimeAuthenticated: false,
    freshProductIdentityPresent: true, freshProductIdentityMatches: true,
    freshDashboardReached: true, freshRuntimeAuthenticated: true,
    countsOne: true, projectOwnershipStable: true,
  };
}

test("live-shared logout evaluator diagnoses revoke, replay, and fresh-login failures", () => {
  assert.equal(evaluateLogoutAcceptance(validLogoutEvidence()).passed, true);
  const variants = [
    [{ sessionRevoked: false }, "RuntimeSessionNotRevokedError"],
    [{ sessionExists: false }, "RuntimeSessionMissingError"],
    [{ oldProductStatus: 503 }, "OldProductCredentialAcceptedError"],
    [{ oldProductParseSucceeded: false }, "OldProductCredentialAcceptedError"],
    [{ oldProductBodyIsNull: false }, "OldProductCredentialAcceptedError"],
    [{ oldRuntimeStatus: 503 }, "OldRuntimeCredentialAcceptedError"],
    [{ oldRuntimeParseSucceeded: false }, "OldRuntimeCredentialAcceptedError"],
    [{ oldRuntimeAuthenticated: true }, "OldRuntimeCredentialAcceptedError"],
    [{ freshProductIdentityPresent: false }, "FreshLoginFailedError"],
    [{ freshRuntimeAuthenticated: false }, "FreshLoginFailedError"],
    [{ freshDashboardReached: false }, "FreshLoginFailedError"],
  ];
  for (const [override, errorName] of variants) {
    const result = evaluateLogoutAcceptance({ ...validLogoutEvidence(), ...override });
    assert.equal(result.passed, false, errorName);
    assert.equal(result.errorName, errorName);
  }
});

test("live case result recording keeps textual status separate from HTTP status", () => {
  const passed = recordCaseResult({ status: "RUNNING" }, {
    classification: "PASS", status: "PASS", httpStatus: 400,
  });
  assert.equal(passed.status, "PASS");
  assert.equal(passed.httpStatus, 400);
  assert.notEqual(passed.status, 400);
  const failed = recordCaseResult({ status: "RUNNING" }, {
    classification: "FAIL", status: "FAIL", httpStatus: 502,
  });
  assert.equal(failed.status, "FAIL");
  assert.equal(failed.httpStatus, 502);
  assert.notEqual(failed.status, 502);
});

test("atomic artifact writer leaves readable final artifact", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "task12u-"));
  const target = path.join(directory, "artifact.json");
  try {
    await writeAtomicArtifact(target, { status: "FAIL", evidence: "retained" });
    assert.deepEqual(JSON.parse(await readFile(target, "utf8")), { status: "FAIL", evidence: "retained" });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("structured errors sanitize credential material and preserve causes", () => {
  const error = new Error("email=person@example.net password=hunter2", {
    cause: new TypeError("Bearer abc123"),
  });
  const safe = sanitizeError(error);
  assert.equal(safe.name, "Error");
  assert.doesNotMatch(JSON.stringify(safe), /person@example\.net|hunter2|abc123/);
  assert.equal(safe.cause.name, "TypeError");
});