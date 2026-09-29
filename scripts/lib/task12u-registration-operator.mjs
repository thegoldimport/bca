import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const MAX_RAW_LENGTH = 4096;
const SECRET_KEY = /^(?:access[_-]?token|refresh[_-]?token|csrf[_-]?token|token|secret|password|email|authorization|cookie|api[_-]?key|apikey|session(?:[_-]?(?:id|token))?|jwt|credential|credentials)$/i;
const SAFE_MESSAGES = new Set([
  "ORIGIN_REJECTED",
  "Could not create your account. Check your details.",
]);
const SAFE_SUMMARY_KEYS = new Set([
  "success", "authenticated", "message", "error", "status", "code", "count", "total",
  "fetchStarted", "responseReceived", "tokenPresent", "productCount", "runtimeCount",
  "expectedCount", "observedCount", "sessionRevoked", "runtimeIdentityPresent",
]);
let artifactSequence = 0;

export function isExplicitExecute(args) {
  return Array.isArray(args) && args.length === 1 && args[0] === "--execute";
}

export function sanitizeText(value, limit = MAX_RAW_LENGTH) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, source => {
      try {
        const url = new URL(source);
        return `${url.origin}${url.pathname}`;
      } catch {
        return "[URL]";
      }
    })
    .replace(/(?:\\?["']?)(?:authorization|proxy-authorization)(?:\\?["']?\s*[:=]\s*)[^\r\n]*/gi,
      "Authorization: [REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [REDACTED]")
    .replace(/(?:\\?["']?)(?:access[_-]?token|refresh[_-]?token|csrf[_-]?token|token|secret|password|email|cookie|api[_-]?key|apikey|session(?:[_-]?(?:id|token))?|jwt|credential|credentials)(?:\\?["']?\s*[:=]\s*)[^\r\n]*/gi,
      "[REDACTED]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replace(/(?<!\w)\+?\d[\d\s().-]{7,}\d(?!\w)/g, "[PHONE]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\b[A-Za-z0-9_+/=-]{24,}\b/g, token => {
      if (/^[A-Z][A-Za-z0-9]*(?:Error|Exception)$/.test(token)) return token;
      const classes = Number(/[a-z]/.test(token)) + Number(/[A-Z]/.test(token))
        + Number(/\d/.test(token)) + Number(/[_+/=-]/.test(token));
      const counts = new Map();
      for (const char of token.toLowerCase()) counts.set(char, (counts.get(char) || 0) + 1);
      const entropy = [...counts.values()].reduce((sum, count) => {
        const probability = count / token.length;
        return sum - probability * Math.log2(probability);
      }, 0);
      return classes >= 3 || token.length >= 24 && entropy >= 3.6 && new Set(token).size >= 12
        ? "[REDACTED]" : token;
    })
    .slice(0, limit);
}

export function safeRawResponseText(value) {
  const raw = String(value ?? "");
  const byteLength = Buffer.byteLength(raw, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return `[REDACTED non-JSON response; length=${byteLength}]`;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)
    && Object.keys(parsed).length === 1 && typeof parsed.message === "string"
    && SAFE_MESSAGES.has(parsed.message) && byteLength <= 512
    && raw === JSON.stringify(parsed)) {
    return raw;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return `[REDACTED JSON response; length=${byteLength}]`;
  }
  const summary = {};
  for (const key of SAFE_SUMMARY_KEYS) {
    if (!Object.hasOwn(parsed, key)) continue;
    const item = parsed[key];
    if (key === "message" || key === "error") {
      summary[key] = typeof item === "string" && SAFE_MESSAGES.has(item) ? item : "[REDACTED]";
    } else if (typeof item === "boolean" || typeof item === "number") {
      summary[key] = item;
    }
  }
  return JSON.stringify(summary);
}

export function sanitizeValue(value) {
  if (Array.isArray(value)) return { itemCount: value.length };
  if (!value || typeof value !== "object") return typeof value === "string" ? sanitizeText(value) : value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "rawText" && typeof item === "string") {
      result.rawText = safeRawResponseText(item);
      continue;
    }
    if (!SAFE_SUMMARY_KEYS.has(key) || SECRET_KEY.test(key)) continue;
    if (key === "message" || key === "error") {
      result[key] = typeof item === "string" && SAFE_MESSAGES.has(item) ? item : "[REDACTED]";
    } else if (typeof item === "boolean" || typeof item === "number") {
      result[key] = item;
    }
  }
  return result;
}

function errorNode(error, depth = 0, seen = new Set()) {
  if (!error) return null;
  if (seen.has(error)) return { name: "CircularCause", message: "[REDACTED]", stack: "", cause: null };
  seen.add(error);
  const cause = depth < 3 ? errorNode(error.cause, depth + 1, seen) : null;
  return {
    name: sanitizeText(error.name || "UnknownError", 120),
    message: sanitizeText(error.message || String(error), 1000),
    stack: sanitizeText(error.stack || "", 3000),
    cause,
  };
}

export function sanitizeError(error) {
  return errorNode(error);
}

export function recordCaseResult(entry, { classification, status = null, httpStatus = null, error = null } = {}) {
  entry.httpStatus = httpStatus;
  entry.classification = classification;
  entry.status = status || (classification === "PASS" ? "PASS"
    : classification === "UNKNOWN" ? "UNKNOWN" : "FAIL");
  entry.completedAt = new Date().toISOString();
  if (error) entry.error = sanitizeError(error);
  return entry;
}

export function parseJsonResponse(rawText) {
  const raw = safeRawResponseText(rawText);
  try {
    const parsedBody = JSON.parse(rawText);
    return { rawText: raw, parsedBody, safeParsedBody: sanitizeValue(parsedBody), parseError: null };
  } catch (error) {
    return { rawText: raw, parsedBody: null, safeParsedBody: null, parseError: sanitizeError(error) };
  }
}

export function parseResponseText(rawText) {
  const parsed = parseJsonResponse(rawText);
  return { ...parsed, parsedBody: parsed.safeParsedBody };
}

export function responseEvidence({ status = null, headers = {}, rawText = "", fetchStarted = true,
  responseReceived = status !== null, error = null } = {}) {
  const getHeader = name => {
    if (typeof headers?.get === "function") return headers.get(name);
    const key = Object.keys(headers || {}).find(candidate => candidate.toLowerCase() === name.toLowerCase());
    return key ? headers[key] : null;
  };
  const parsed = parseResponseText(rawText);
  return {
    fetchStarted: !!fetchStarted,
    responseReceived: !!responseReceived,
    status,
    safeHeaders: {
      cfRay: sanitizeText(getHeader("cf-ray") || "", 200) || null,
      contentType: sanitizeText(getHeader("content-type") || "", 200) || null,
    },
    ...parsed,
    error: sanitizeError(error),
  };
}

export function classifyBoundedResponse({ status, parsedBody, parseError, expectedCount = 0,
  observedCount = expectedCount, noAutomaticLogin = true } = {}) {
  if (status === null || status === undefined) return "UNKNOWN";
  if (status < 400 || status >= 500 || status === 502 || parseError
    || !parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) return "FAIL";
  if (observedCount !== expectedCount || !noAutomaticLogin) return "FAIL";
  const serialized = JSON.stringify(parsedBody);
  if (serialized.length > 2048 || /stack|exception|token|secret|authorization|cookie/i.test(serialized)) return "FAIL";
  const message = parsedBody.message ?? parsedBody.error;
  return typeof message === "string" && message.length > 0 && message.length <= 200 ? "PASS" : "FAIL";
}

function evaluation(assertions, failures) {
  const failed = failures.filter(([passed]) => !passed).map(([, name]) => name);
  return {
    passed: failed.length === 0,
    assertions,
    failures: failed,
    errorName: failed[0] || null,
    errorMessage: failed.length ? `Acceptance assertions failed: ${failed.join(", ")}` : null,
  };
}

export function evaluateSignupAcceptance(evidence) {
  const assertions = {
    singleClickAndRequest: evidence.clickCount === 1 && evidence.requestCount === 1,
    successfulResponse: Number.isInteger(evidence.responseStatus)
      && evidence.responseStatus >= 200 && evidence.responseStatus < 300,
    responseBodyReadable: evidence.responseBodyReadable !== false,
    dashboardReached: evidence.dashboardReached === true,
    productCountOne: evidence.productCount === 1,
    runtimeCountOne: evidence.runtimeCount === 1,
    legacyHashNull: evidence.legacyHashNull === true,
    productIdentityPresent: evidence.productStatus === 200
      && evidence.productD1Id != null && evidence.productMeId != null
      && String(evidence.productD1Id) === String(evidence.productMeId),
    runtimeIdentityPresent: evidence.runtimeAuthenticated === true
      && evidence.runtimeD1Id != null && evidence.runtimeCheckId != null,
    identityMappingMatches: [evidence.productD1Id, evidence.runtimeD1Id,
      evidence.productMeId, evidence.runtimeCheckId].every(id => id != null)
      && new Set([evidence.productD1Id, evidence.runtimeD1Id,
        evidence.productMeId, evidence.runtimeCheckId].map(String)).size === 1,
    productLocalSessionCountZero: evidence.productLocalSessionCount === 0,
    reconciliationSucceeded: evidence.reconciliationSucceeded !== false,
  };
  const failures = [
    [assertions.singleClickAndRequest, "SignupRequestCountMismatchError"],
    [assertions.successfulResponse, "SignupResponseFailureError"],
    [assertions.responseBodyReadable, "SignupResponseBodyReadError"],
    [assertions.dashboardReached, "SignupDashboardNotReachedError"],
    [assertions.productCountOne, "ProductIdentityCountMismatchError"],
    [assertions.runtimeCountOne, "RuntimeIdentityCountMismatchError"],
    [assertions.legacyHashNull, "LegacyPasswordHashUnexpectedError"],
    [assertions.productIdentityPresent, "ProductIdentityMissingError"],
    [assertions.runtimeIdentityPresent, "RuntimeIdentityMissingError"],
    [assertions.identityMappingMatches, "IdentityMappingMismatchError"],
    [assertions.productLocalSessionCountZero, "ProductSessionAuthorityUnexpectedError"],
    [assertions.reconciliationSucceeded, "SignupReconciliationFailureError"],
  ];
  if (evidence.sessionEvidenceAvailable === true) {
    assertions.runtimeSessionExists = evidence.runtimeSessionExists === true;
    assertions.runtimeSessionOwnerMatches = evidence.runtimeSessionOwnerMatches === true;
    assertions.runtimeSessionActive = evidence.runtimeSessionActive === true;
    failures.push(
      [assertions.runtimeSessionExists, "RuntimeSessionMissingError"],
      [assertions.runtimeSessionOwnerMatches, "RuntimeSessionOwnerMismatchError"],
      [assertions.runtimeSessionActive, "RuntimeSessionNotActiveError"],
    );
  }
  return evaluation(assertions, failures);
}

export function evaluateLogoutAcceptance(evidence) {
  const assertions = {};
  const failures = [];
  const add = (name, passed, errorName) => {
    assertions[name] = passed;
    failures.push([passed, errorName]);
  };

  if (evidence.stage === "pre-logout") {
    add("loginSucceeded", evidence.loginStatus === 200 && evidence.dashboardReached === true,
      "PreLogoutLoginFailedError");
    add("authenticatedDashboardLoaded", evidence.dashboardStatus === 200 && evidence.projectsArray === true,
      "PreLogoutDashboardFailedError");
    add("productIdentityMatches", evidence.productIdentityPresent === true
      && evidence.productIdentityMatches === true, "PreLogoutProductIdentityMissingError");
    add("runtimeIdentityMatches", evidence.runtimeAuthenticated === true
      && evidence.runtimeIdentityMatches === true, "PreLogoutRuntimeIdentityMissingError");
    add("runtimeSessionActive", evidence.sessionExists === true && evidence.sessionOwnerMatches === true
      && evidence.sessionRevoked === false, "PreLogoutRuntimeSessionInvalidError");
    add("productLocalSessionCountZero", evidence.productLocalSessionCount === 0,
      "ProductSessionAuthorityUnexpectedError");
  } else {
    add("logout204AndCookieCleared", evidence.logoutStatus === 204
      && evidence.browserCredentialCleared === true
      && evidence.responseBodyReadable !== false, "LogoutResponseOrCookieClearFailureError");
    add("runtimeSessionExists", evidence.sessionExists === true && evidence.sessionOwnerMatches === true,
      "RuntimeSessionMissingError");
    add("runtimeSessionRevoked", evidence.sessionRevoked === true, "RuntimeSessionNotRevokedError");
    add("oldProductCredentialRejected", evidence.oldProductStatus === 200
      && evidence.oldProductParseSucceeded === true && evidence.oldProductBodyIsNull === true,
      "OldProductCredentialAcceptedError");
    add("oldRuntimeCredentialRejected", evidence.oldRuntimeStatus === 200
      && evidence.oldRuntimeParseSucceeded === true && evidence.oldRuntimeAuthenticated === false,
      "OldRuntimeCredentialAcceptedError");
    if (evidence.stage === "complete") {
      add("freshLoginSucceeded", evidence.freshProductIdentityPresent === true
      && evidence.freshProductIdentityMatches === true && evidence.freshRuntimeAuthenticated === true
      && evidence.freshDashboardReached === true, "FreshLoginFailedError");
      add("identityCountsStable", evidence.countsOne === true, "PostLogoutIdentityCountMismatchError");
      add("projectOwnershipStable", evidence.projectOwnershipStable !== false,
        "ProjectOwnershipChangedError");
    }
  }
  return evaluation(assertions, failures);
}

export function classifyRegistrationMatrix(originState, csrfState, status, body) {
  if (status === null || status === undefined || body?.classification !== "SAFE_JSON") return "UNKNOWN";
  const expected = originState !== "valid"
    ? { status: 400, message: "ORIGIN_REJECTED" }
    : csrfState === "valid"
      ? { status: 400, message: "Could not create your account. Check your details." }
      : { status: 403, message: "Could not create your account. Check your details." };
  return status === expected.status && body.message === expected.message ? "PASS" : "FAIL";
}

export function safeMatrixBody(raw) {
  const { parsedBody, rawText } = parseJsonResponse(raw);
  const keys = parsedBody && typeof parsedBody === "object" && !Array.isArray(parsedBody)
    ? Object.keys(parsedBody) : [];
  const message = keys.length === 1 && keys[0] === "message" ? parsedBody.message : null;
  const allowed = new Set(["ORIGIN_REJECTED", "Could not create your account. Check your details."]);
  if (typeof message !== "string" || !allowed.has(message) || rawText.length > 2048
    || /stack|exception|token|secret|authorization|cookie/i.test(rawText)) {
    return { classification: "UNKNOWN", exactBody: null, message: null };
  }
  return { classification: "SAFE_JSON", exactBody: rawText, message };
}

export async function writeAtomicArtifact(filePath, artifact) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${++artifactSequence}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  await rename(tempPath, filePath);
}