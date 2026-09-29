import { createHash, randomBytes } from "node:crypto";
import { link, unlink, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  parseJsonResponse,
  safeMatrixBody,
  sanitizeError,
  sanitizeText,
  writeAtomicArtifact,
} from "./task12u-registration-operator.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const product = "https://app.buildcustom.ai";
const runtime = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const account = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const productDb = "ca820baf-6973-4318-ac52-529d56293bb6";
const runtimeDb = "716c6600-8c60-408a-9446-3779979d5316";
const existingEmail = "cutover-test@buildcustom.ai";
const disposableName = "Task 12V Acceptance";

function safeMatrixResponse(rawText) {
  const parsed = parseJsonResponse(rawText);
  return { parsed, safe: safeMatrixBody(rawText) };
}

export async function sendTask12VMatrixRequest({
  fetchImpl = fetch,
  url = `${product}/api/auth/register`,
  originState,
  csrfState,
  csrf,
  payload,
}) {
  const headers = { "Content-Type": "application/json" };
  if (originState === "valid") headers.Origin = product;
  if (originState === "invalid") headers.Origin = "https://not-buildcustom.example";
  if (typeof csrf?.cookie === "string" && csrf.cookie.length > 0) {
    headers.Cookie = `csrf-token=${csrf.cookie}`;
  }
  if (csrfState === "valid") headers["X-CSRF-Token"] = csrf?.token;
  if (csrfState === "invalid") headers["X-CSRF-Token"] = "invalid-task12v-csrf";

  let response;
  let rawText = "";
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      redirect: "manual",
    });
    rawText = await response.text();
  } catch (error) {
    const failure = sanitizeError(error);
    return {
      status: response?.status ?? null, rawText: "", parsedBody: null,
      parseError: failure, fetchStarted: true,
      responseReceived: !!response, responseBodyReadable: false,
    };
  }
  const { parsed, safe } = safeMatrixResponse(rawText);
  return {
    status: response.status,
    rawText: safe.classification === "SAFE_JSON"
      ? JSON.stringify({ message: safe.message }) : parsed.rawText,
    parsedBody: parsed.parsedBody,
    parseError: parsed.parseError,
    fetchStarted: true,
    responseReceived: true,
  };
}

export function registrationCsrfEvidence({ state, token, cookie }) {
  return {
    state,
    token: state === "valid" ? token : state === "invalid" ? "invalid-task12v-csrf" : null,
    cookie,
  };
}

function adapterError(name, message, details = {}) {
  const error = new Error(message);
  error.name = name;
  Object.assign(error, details);
  return error;
}

function requireCondition(condition, message) {
  if (!condition) throw adapterError("AcceptancePreconditionError", message);
}

function diagnosticOriginalResult(value) {
  if (value == null) return null;
  if (typeof value === "string") return sanitizeText(value, 500);
  if (typeof value !== "object") return value;
  if (typeof value.name === "string" || typeof value.message === "string") {
    return sanitizeError(value);
  }
  if (Object.hasOwn(value, "status")) return { status: value.status };
  return { omitted: true };
}

export function safeDiagnosticEnvelope(record = {}) {
  return {
    type: sanitizeText(record.type || "adapter-diagnostic", 120),
    phase: sanitizeText(record.phase || "", 120),
    caseName: sanitizeText(record.caseName || "", 160),
    operation: sanitizeText(record.operation || "", 160),
    status: record.status == null ? null : sanitizeText(record.status, 40),
    originalResult: diagnosticOriginalResult(record.originalResult),
    artifactWriteError: sanitizeError(record.artifactWriteError),
    primaryError: sanitizeError(record.primaryError),
    cleanupError: sanitizeError(record.cleanupError),
  };
}

function cookieHeader(cookies) {
  return cookies.map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
}

function cookieValue(cookies, name) {
  return cookies.find(cookie => cookie.name === name)?.value || null;
}

function accessCookie(cookies) {
  return cookieValue(cookies, "accessToken");
}

function tokenHash(token) {
  return createHash("sha256").update(token).digest("base64");
}

function forbiddenCustomerHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const labels = host.split(".");
  const ipv4 = host.split(".").map(Number);
  const privateIpv4 = ipv4.length === 4 && ipv4.every(part =>
    Number.isInteger(part) && part >= 0 && part <= 255)
    && (ipv4[0] === 0 || ipv4[0] === 10 || ipv4[0] === 127
      || ipv4[0] === 169 && ipv4[1] === 254
      || ipv4[0] === 192 && ipv4[1] === 168
      || ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31);
  const privateIpv6 = host === "::1" || host === "::"
    || host.startsWith("fc") || host.startsWith("fd") || /^fe[89ab]/.test(host);
  return /(^|\.)replit\.(com|dev|app)$/.test(host)
    || /(^|\.)repl\.co$/.test(host)
    || labels.some(label => /(^|[-])(legacy|staging|lab)([-]|$)/.test(label))
    || host === "workers.dev" || host.endsWith(".workers.dev")
    || labels.some(label => /gateway|private|internal/.test(label))
    || host === "localhost" || host.endsWith(".localhost")
    || host.endsWith(".local") || host.endsWith(".internal")
    || privateIpv4 || privateIpv6;
}

export function createTask12VProductionAdapter() {
  // Deliberately inert: credentials, browser, filesystem and network are only
  // touched after the runner calls initialize().
  let puppeteer;
  let browser;
  let page;
  let existingPage;
  let disposableEmail;
  let ephemeralPassword;
  let weakEmail;
  let missingPasswordEmail;
  let invalidShapeEmail;
  let handoffPath;
  let artifactPath = path.join(root, "production/vibesdk-launch",
    `task12v-registration-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  let existingIdentity;
  let identityRowsByOwner = {};
  const pages = {};
  const priorCookies = {};
  const networkAudit = { forbiddenHosts: new Set(), phases: new Map(), phase: "setup" };
  let signupRequestCount = 0;
  let signupObserver = null;
  let signupResponseTask = null;
  let signupActionConsumed = false;
  let handoffWritten = false;

  const now = () => new Date().toISOString();
  const checkpointPath = () => artifactPath;

  async function d1(database, sql, params = []) {
    const response = await fetch(`${account}/d1/database/${database}/query`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
    let rawText = "";
    try {
      rawText = await response.text();
    } catch (error) {
      const failure = adapterError("D1EvidenceReadError",
        `D1 response body could not be read (${response.status})`);
      failure.name = "D1ResponseReadError";
      failure.evidence = {
        status: response.status,
        responseReceived: true,
        responseBodyReadable: false,
        responseReadError: sanitizeError(error),
      };
      throw failure;
    }
    const parsed = parseJsonResponse(rawText);
    const body = parsed.parsedBody;
    if (!response.ok || parsed.parseError || body?.success !== true
      || !Array.isArray(body.result?.[0]?.results)) {
      const failure = adapterError("D1EvidenceReadError", `D1 read failed (${response.status})`);
      failure.name = "D1ReadError";
      failure.evidence = {
        status: response.status,
        responseReceived: true,
        responseBodyReadable: true,
        rawText: parsed.rawText,
        parsedBody: parsed.safeParsedBody,
        parseError: parsed.parseError,
      };
      throw failure;
    }
    return body.result[0].results;
  }

  async function identityRows(email) {
    const [productRows, runtimeRows] = await Promise.all([
      d1(productDb,
        "SELECT id,email,legacy_password_hash FROM users WHERE lower(email)=lower(?)", [email]),
      d1(runtimeDb, "SELECT id,email FROM users WHERE lower(email)=lower(?)", [email]),
    ]);
    return { product: productRows, runtime: runtimeRows };
  }

  function countEvidence(rows) {
    return {
      product: {
        count: rows.product.length,
        legacyHashNull: rows.product.every(row => row.legacy_password_hash == null),
        id: rows.product[0]?.id ?? null,
      },
      runtime: { count: rows.runtime.length, id: rows.runtime[0]?.id ?? null },
    };
  }

  function emailFor(identity) {
    if (identity === "existing") return existingEmail;
    if (identity === "disposable") return disposableEmail;
    if (identity === "invalid-email") return "not-an-email";
    if (identity === "weak-password") return weakEmail;
    if (identity === "missing-password") return missingPasswordEmail;
    if (identity === "invalid-shape") return invalidShapeEmail;
    throw adapterError("AdapterContractError", `Unknown registration identity key: ${identity}`);
  }

  async function apiRead(url, cookie = "") {
    const response = await fetch(url, {
      headers: cookie ? { Cookie: cookie } : {},
      cache: "no-store",
      redirect: "manual",
    });
    let rawText = "";
    let responseReadError = null;
    try { rawText = await response.text(); } catch (error) {
      responseReadError = sanitizeError(error);
    }
    const parsed = parseJsonResponse(rawText);
    return {
      status: response.status,
      body: parsed.parsedBody,
      rawText: parsed.rawText,
      parseError: responseReadError || parsed.parseError,
      responseReadError,
    };
  }

  async function getCsrfToken() {
    const result = await page.evaluate(async () => {
      const response = await fetch("/api/auth/csrf-token", {
        credentials: "same-origin", cache: "no-store",
      });
      let rawText = "";
      let readError = null;
      try { rawText = await response.text(); } catch (error) {
        readError = {
          name: error?.name || "ResponseReadError",
          message: error?.message || "CSRF response body read failed",
        };
      }
      return { status: response.status, rawText, readError };
    });
    const parsed = parseJsonResponse(result.rawText);
    const responseReadError = result.readError ? sanitizeError(result.readError) : null;
    return {
      status: result.status,
      token: parsed.parsedBody?.token ?? parsed.parsedBody?.data?.token ?? null,
      parseError: responseReadError || parsed.parseError,
      responseReadError,
    };
  }

  async function attachBrowserNetworkAudit(targetPage) {
    const client = await targetPage.target().createCDPSession();
    await client.send("Network.enable");
    const observe = value => {
      try {
        const hostname = new URL(value).hostname.toLowerCase();
        if (!forbiddenCustomerHost(hostname)) return;
        networkAudit.forbiddenHosts.add(hostname);
        if (!networkAudit.phases.has(networkAudit.phase)) {
          networkAudit.phases.set(networkAudit.phase, new Set());
        }
        networkAudit.phases.get(networkAudit.phase).add(hostname);
      } catch { /* Ignore opaque browser URLs. */ }
    };
    client.on("Network.requestWillBeSent", ({ request }) => observe(request.url));
    client.on("Network.webSocketCreated", ({ url }) => observe(url));
  }

  async function loginPage(targetPage, email, password) {
    await targetPage.goto(`${product}/app/login`, { waitUntil: "domcontentloaded" });
    requireCondition(new URL(targetPage.url()).origin === product,
      "Login navigation left the public product origin");
    await targetPage.locator('[data-testid="input-email"]').fill(email);
    await targetPage.locator('[data-testid="input-password"]').fill(password);
    const responsePromise = targetPage.waitForResponse(response =>
      response.url().includes("/api/auth/login") && response.request().method() === "POST",
    { timeout: 30000 }).catch(() => null);
    await targetPage.locator('[data-testid="button-submit"]').click();
    const response = await responsePromise;
    const dashboardReached = await targetPage.waitForFunction(
      () => location.pathname === "/app" || location.pathname === "/app/",
      { timeout: 45000 },
    ).then(() => true).catch(() => false);
    const cookie = cookieHeader(await targetPage.cookies(product));
    const [me, projects] = await Promise.all([
      apiRead(`${product}/api/auth/me`, cookie),
      apiRead(`${product}/api/projects`, cookie),
    ]);
    return {
      loginStatus: response?.status() ?? null,
      dashboardReached,
      dashboardStatus: projects.status,
      me,
      projects,
    };
  }

  async function runtimeCheck(cookie) {
    const response = await fetch(`${runtime}/api/auth/check`, {
      headers: { Cookie: cookie },
      cache: "no-store",
    });
    let rawText = "";
    let responseReadError = null;
    try { rawText = await response.text(); } catch (error) {
      responseReadError = sanitizeError(error);
    }
    const parsed = parseJsonResponse(rawText);
    const body = parsed.parsedBody;
    return {
      status: response.status,
      authenticated: body?.data?.authenticated === true,
      authenticatedValue: body?.data?.authenticated,
      userId: body?.data?.user?.id ?? null,
      parseError: responseReadError || parsed.parseError,
      responseReadError,
    };
  }

  async function sessionEvidence(database, userId, token) {
    const rows = await d1(database,
      "SELECT id,user_id,is_revoked FROM sessions WHERE access_token_hash=? ORDER BY created_at DESC LIMIT 1",
      [tokenHash(token)]);
    const session = rows[0] || null;
    return {
      exists: !!session,
      ownerMatches: !!session && String(session.user_id) === String(userId),
      revoked: session?.is_revoked == null ? null : Number(session.is_revoked) === 1,
      sessionId: session?.id ?? null,
    };
  }

  async function authFor(owner) {
    const targetPage = pages[owner];
    requireCondition(targetPage, `Browser page for ${owner} user is unavailable`);
    const cookies = await targetPage.cookies(product);
    const cookie = cookieHeader(cookies);
    priorCookies[owner] ||= cookie;
    return { targetPage, cookies, cookie };
  }

  async function readProductAuth(owner) {
    const { cookie } = await authFor(owner);
    const me = await apiRead(`${product}/api/auth/me`, cookie);
    return {
      status: me.status,
      authenticated: me.status === 200 && me.body?.id != null,
      userId: me.body?.id ?? null,
      parseError: me.parseError,
    };
  }

  async function readRuntimeAuth(owner) {
    const { cookie } = await authFor(owner);
    return runtimeCheck(cookie);
  }

  async function productLocalSessionCount(database, userId) {
    const rows = await d1(database, "SELECT count(*) AS total FROM sessions WHERE user_id=?", [userId]);
    return Number(rows[0]?.total ?? -1);
  }

  async function logoutOwner(owner) {
    const { targetPage } = await authFor(owner);
    await targetPage.goto(`${product}/app`, { waitUntil: "domcontentloaded" });
    await targetPage.waitForSelector('[data-testid="button-logout"]', { timeout: 30000 });
    const responsePromise = targetPage.waitForResponse(response =>
      response.url().includes("/api/auth/logout") && response.request().method() === "POST",
    { timeout: 30000 });
    await targetPage.locator('[data-testid="button-logout"]').click();
    const response = await responsePromise;
    let responseBodyReadable = true;
    try { await response.text(); } catch { responseBodyReadable = false; }
    await targetPage.waitForFunction(
      () => location.pathname === "/app/login" || location.pathname === "/app/login/",
      { timeout: 45000 },
    ).catch(() => undefined);
    const cookies = await targetPage.cookies(product);
    const oldToken = accessCookie(cookies);
    return {
      status: response.status(),
      browserCredentialCleared: !oldToken || oldToken !== accessCookie(
        (await targetPage.cookies(product))),
      responseBodyReadable,
    };
  }

  async function replayProduct(owner) {
    const cookie = priorCookies[owner];
    requireCondition(cookie, `No captured product credential for ${owner} user`);
    const result = await apiRead(`${product}/api/auth/me`, cookie);
    return {
      status: result.status,
      parseSucceeded: result.parseError === null,
      bodyIsNull: result.body === null,
    };
  }

  async function replayRuntime(owner) {
    const cookie = priorCookies[owner];
    requireCondition(cookie, `No captured runtime credential for ${owner} user`);
    const result = await runtimeCheck(cookie);
    return {
      status: result.status,
      parseSucceeded: result.parseError === null,
      authenticated: result.authenticatedValue,
    };
  }

  const io = {
    now,
    async writeCheckpoint(snapshot) {
      requireCondition(checkpointPath(), "Artifact destination was not initialized");
      await writeAtomicArtifact(checkpointPath(), snapshot);
    },
    async emitDiagnostic(record) {
      process.stderr.write(`${JSON.stringify(safeDiagnosticEnvelope(record))}\n`);
    },
    async initialize() {
      requireCondition(!browser, "Production adapter initialize() may only be called once");
      const handoffCandidate = process.env.TASK12T_CREDENTIAL_HANDOFF_PATH;
      requireCondition(typeof handoffCandidate === "string" && path.isAbsolute(handoffCandidate)
        && handoffCandidate === path.resolve(handoffCandidate)
        && path.dirname(handoffCandidate) === "/tmp",
      "TASK12T_CREDENTIAL_HANDOFF_PATH must name an absolute file directly under /tmp");
      requireCondition(!!process.env.CLOUDFLARE_API_TOKEN,
        "CLOUDFLARE_API_TOKEN is required for read-only D1 evidence");
      requireCondition(!!process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD,
        "BUILDCUSTOM_CUTOVER_TESTER_PASSWORD is required for existing-user logout regression");

      handoffPath = handoffCandidate;
      disposableEmail = `task12v-${Date.now()}-${randomBytes(5).toString("hex")}@example.net`;
      ephemeralPassword = `Qa9!${randomBytes(20).toString("hex")}`;
      weakEmail = `task12v-weak-${Date.now()}@example.net`;
      missingPasswordEmail = `task12v-missing-${Date.now()}@example.net`;
      invalidShapeEmail = `task12v-shape-${Date.now()}-${randomBytes(3).toString("hex")}@example.net`;

      const require = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"));
      puppeteer = require("puppeteer");
      existingIdentity = await identityRows(existingEmail);
      requireCondition(existingIdentity.product.length === 1 && existingIdentity.runtime.length === 1
        && existingIdentity.product[0].legacy_password_hash == null,
      "Existing acceptance identity must exist once in both D1 databases with a null legacy password hash");
      requireCondition(String(existingIdentity.product[0].id) === String(existingIdentity.runtime[0].id),
        "Existing product/runtime identity mapping differs");
      const [beforeDisposable] = await Promise.all([identityRows(disposableEmail)]);
      requireCondition(beforeDisposable.product.length === 0 && beforeDisposable.runtime.length === 0,
        "Generated disposable email already exists; refusing signup");

      browser = await puppeteer.launch({
        executablePath: "/repl/tools/bin/chromium",
        headless: true,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      });
      page = await browser.newPage();
      page.setDefaultTimeout(30000);
      pages.new = page;
      await attachBrowserNetworkAudit(page);
      return {
        ready: true,
        productRegistrationEnabled: true,
        runtimeRegistrationEnabled: true,
      };
    },
    async navigate({ target }) {
      requireCondition(target === "signup", `Unsupported browser navigation target: ${target}`);
      networkAudit.phase = "anonymous-signup";
      await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
      requireCondition(new URL(page.url()).origin === product,
        "Signup navigation left the public product origin");
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
      { timeout: 20000 });
      const [productCapabilities, runtimeProviders] = await Promise.all([
        apiRead(`${product}/api/public/capabilities`),
        apiRead(`${runtime}/api/auth/providers`),
      ]);
      requireCondition(productCapabilities.status === 200
        && productCapabilities.body?.registrationEnabled === true
        && runtimeProviders.status === 200
        && runtimeProviders.body?.registrationEnabled === true
        && runtimeProviders.body?.email === true,
      "Registration acceptance requires both public and runtime email registration enabled");
      return { reached: true, sameOrigin: true };
    },
    async getCsrf({ state }) {
      requireCondition(["valid", "missing", "invalid"].includes(state), `Unknown CSRF state: ${state}`);
      const csrf = await getCsrfToken();
      const csrfCookie = cookieValue(await page.cookies(product), "csrf-token");
      if (state === "valid") {
        if (csrf.status !== 200 || typeof csrf.token !== "string" || csrf.token.length === 0) {
          const error = adapterError("CsrfAcquisitionError",
            "Public registration CSRF token unavailable");
          error.name = "CsrfTokenUnavailableError";
          error.evidence = {
            status: csrf.status,
            tokenPresent: false,
            parseError: csrf.parseError,
            responseReadError: csrf.responseReadError,
          };
          throw error;
        }
        if (!csrfCookie) {
          const error = adapterError("CsrfAcquisitionError",
            "Public registration CSRF cookie unavailable");
          error.name = "CsrfCookieUnavailableError";
          error.evidence = {
            status: csrf.status,
            tokenPresent: true,
            parseError: csrf.parseError,
            responseReadError: csrf.responseReadError,
          };
          throw error;
        }
      }
      // Matrix trials isolate the header state only; retain the acquired
      // browser CSRF cookie for valid, missing, and invalid header variants.
      return registrationCsrfEvidence({ state, token: csrf.token, cookie: csrfCookie });
    },
    async countIdentities(identity) {
      const rows = await identityRows(emailFor(identity));
      identityRowsByOwner[identity] = rows;
      return countEvidence(rows);
    },
    async countProductSessions({ owner }) {
      const rows = owner === "existing" ? existingIdentity : identityRowsByOwner.disposable;
      const userId = rows?.product?.[0]?.id;
      requireCondition(userId != null, `Product identity unavailable for ${owner} session count`);
      return productLocalSessionCount(productDb, userId);
    },
    async sendBounded({ caseName, identity, csrf }) {
      const payload = {
        name: disposableName,
        email: emailFor(identity),
        password: ephemeralPassword,
      };
      if (caseName.includes("case-variant")) payload.email = payload.email.toUpperCase();
      if (caseName === "weak-password") payload.password = "short";
      if (caseName === "missing-password") delete payload.password;
      if (caseName === "invalid-request-shape") {
        payload.name = ["wrong-type"];
        payload.password = true;
      }
      const token = csrf?.token;
      requireCondition(typeof token === "string" && token.length > 0,
        `Valid CSRF token unavailable for bounded request ${caseName}`);
      const rawResult = await page.evaluate(async ({ body, token: csrfToken }) => {
        const response = await fetch("/api/auth/register", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: { "Content-Type": "application/json", "X-CSRF-Token": csrfToken },
          body: JSON.stringify(body),
        });
        let rawText = "";
        let responseBodyReadable = true;
        try { rawText = await response.text(); } catch { responseBodyReadable = false; }
        return { status: response.status, rawText, responseBodyReadable };
      }, { body: payload, token });
      const parsed = parseJsonResponse(rawResult.rawText);
      const noAutomaticLogin = caseName !== "duplicate-existing-email"
        && caseName !== "case-variant-duplicate-existing-email"
        ? true : !(await page.evaluate(async () => {
          const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
          try { return !!JSON.parse(await response.text())?.id; } catch { return false; }
        }));
      return {
        status: rawResult.status,
        rawText: parsed.rawText,
        parsedBody: parsed.parsedBody,
        parseError: rawResult.responseBodyReadable ? parsed.parseError : "response_body_unreadable",
        fetchStarted: true,
        responseReceived: true,
        responseBodyReadable: rawResult.responseBodyReadable,
        noAutomaticLogin,
      };
    },
    async sendMatrix({ originState, csrfState, csrf }) {
      return sendTask12VMatrixRequest({
        originState,
        csrfState,
        csrf,
        payload: {
          name: disposableName, email: "not-an-email", password: ephemeralPassword,
        },
      });
    },
    async productAuth({ owner }) { return readProductAuth(owner); },
    async runtimeAuth({ owner }) { return readRuntimeAuth(owner); },
    async signupAction() {
      requireCondition(!signupActionConsumed, "Signup action cannot be retried");
      signupActionConsumed = true;
      networkAudit.phase = "successful-single-signup";
      await page.goto(`${product}/app/signup`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(() =>
        document.querySelector('[data-testid="button-submit"]')?.textContent?.includes("Create Account"),
      { timeout: 20000 });
      requireCondition(new URL(page.url()).origin === product, "Signup navigation left the product origin");
      await page.locator('[data-testid="input-name"]').fill(disposableName);
      await page.locator('[data-testid="input-email"]').fill(disposableEmail);
      await page.locator('[data-testid="input-password"]').fill(ephemeralPassword);

      signupRequestCount = 0;
      signupObserver = request => {
        try {
          const url = new URL(request.url());
          if (url.origin === product && url.pathname === "/api/auth/register"
            && request.method() === "POST") signupRequestCount += 1;
        } catch { /* Ignore malformed URLs. */ }
      };
      page.on("request", signupObserver);
      signupResponseTask = page.waitForResponse(response => {
        try {
          const url = new URL(response.url());
          return url.origin === product && url.pathname === "/api/auth/register"
            && response.request().method() === "POST";
        } catch { return false; }
      }, { timeout: 30000 }).then(async response => {
        const status = response.status();
        let rawText = "";
        let responseBodyReadable = true;
        try { rawText = await response.text(); } catch { responseBodyReadable = false; }
        const parsed = parseJsonResponse(rawText);
        return {
          status, rawText: parsed.rawText, parsedBody: parsed.parsedBody,
          parseError: parsed.parseError, fetchStarted: true,
          responseReceived: true, responseBodyReadable,
        };
      }).catch(error => ({
        status: null, rawText: "", parsedBody: null,
        parseError: sanitizeError(error), fetchStarted: true,
        responseReceived: false, responseBodyReadable: false,
      }));
      let clickError = null;
      try {
        await page.locator('[data-testid="button-submit"]').click();
      } catch (error) {
        clickError = sanitizeError(error);
      }
      const response = await signupResponseTask;
      page.off("request", signupObserver);
      signupObserver = null;
      const requestCount = signupRequestCount;
      const outcome = response.responseReceived && response.responseBodyReadable
        && Number.isInteger(response.status) && response.status >= 200 && response.status < 300
        ? "SUCCESS" : response.responseReceived && response.status >= 400 && response.status < 500
          ? "FAIL" : "UNCERTAIN";
      return {
        outcome, response, requestCount,
        ...(clickError ? { error: clickError } : {}),
      };
    },
    async reconcileSignup() {
      const [productRowsResult, runtimeRowsResult, cookiesResult] = await Promise.allSettled([
        d1(productDb,
          "SELECT id,email,legacy_password_hash FROM users WHERE lower(email)=lower(?)", [disposableEmail]),
        d1(runtimeDb, "SELECT id,email FROM users WHERE lower(email)=lower(?)", [disposableEmail]),
        page.cookies(product),
      ]);
      const productRows = productRowsResult.status === "fulfilled" ? productRowsResult.value : [];
      const runtimeRows = runtimeRowsResult.status === "fulfilled" ? runtimeRowsResult.value : [];
      const cookie = cookiesResult.status === "fulfilled" ? cookieHeader(cookiesResult.value) : "";
      const [productMeResult, runtimeAuthResult, sessionResult, localCountResult] = await Promise.allSettled([
        apiRead(`${product}/api/auth/me`, cookie),
        runtimeCheck(cookie),
        productRows[0]?.id != null && runtimeRows[0]?.id != null
          ? sessionEvidence(runtimeDb, runtimeRows[0].id, accessCookie(
            cookiesResult.status === "fulfilled" ? cookiesResult.value : []))
          : Promise.resolve(undefined),
        productRows[0]?.id != null ? productLocalSessionCount(productDb, productRows[0].id)
          : Promise.resolve(-1),
      ]);
      const productMe = productMeResult.status === "fulfilled" ? productMeResult.value : null;
      const runtime = runtimeAuthResult.status === "fulfilled" ? runtimeAuthResult.value : null;
      const session = sessionResult.status === "fulfilled" ? sessionResult.value : undefined;
      const counts = {
        product: {
          count: productRowsResult.status === "fulfilled" ? productRows.length : -1,
          legacyHashNull: productRowsResult.status === "fulfilled"
            && productRows.every(row => row.legacy_password_hash == null),
          id: productRows[0]?.id ?? null,
        },
        runtime: {
          count: runtimeRowsResult.status === "fulfilled" ? runtimeRows.length : -1,
          id: runtimeRows[0]?.id ?? null,
        },
      };
      const errors = [
        productRowsResult, runtimeRowsResult, cookiesResult, productMeResult,
        runtimeAuthResult, sessionResult, localCountResult,
      ].map(result => result.status === "rejected" ? sanitizeError(result.reason) : null)
        .filter(Boolean);
      return {
        counts,
        productD1Id: productRows[0]?.id ?? null,
        runtimeD1Id: runtimeRows[0]?.id ?? null,
        productAuth: productMe ? {
          status: productMe.status, authenticated: productMe.status === 200 && productMe.body?.id != null,
          userId: productMe.body?.id ?? null,
        } : null,
        runtimeAuth: runtime ? {
          status: runtime.status, authenticated: runtime.authenticated, userId: runtime.userId,
        } : null,
        runtimeSession: session,
        productLocalSessionCount: localCountResult.status === "fulfilled"
          ? localCountResult.value : null,
        readErrors: errors,
        requestCount: signupRequestCount,
      };
    },
    async dashboard() {
      networkAudit.phase = "new-user-dashboard";
      const cookie = cookieHeader(await page.cookies(product));
      const projects = await apiRead(`${product}/api/projects`, cookie);
      return {
        reached: projects.status === 200 && Array.isArray(projects.body),
        status: projects.status,
        projects: projects.body,
      };
    },
    async login({ owner }) {
      requireCondition(owner === "existing", "Only existing-user login is supported here");
      networkAudit.phase = "existing-user";
      if (!existingPage) {
        existingPage = await browser.newPage();
        existingPage.setDefaultTimeout(30000);
        pages.existing = existingPage;
        await attachBrowserNetworkAudit(existingPage);
      }
      const result = await loginPage(existingPage, existingEmail,
        process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD);
      return {
        loginStatus: result.loginStatus,
        dashboardReached: result.dashboardReached,
        dashboardStatus: result.dashboardStatus,
        projects: result.projects.body,
      };
    },
    async logout({ owner }) {
      const result = await logoutOwner(owner);
      const previous = priorCookies[owner] || "";
      const previousToken = previous.match(/(?:^|;\s*)accessToken=([^;]*)/)?.[1] ?? null;
      result.browserCredentialCleared = previousToken !== null
        && !(await pages[owner].cookies(product)).some(cookie =>
          cookie.name === "accessToken" && cookie.value === previousToken);
      return result;
    },
    async runtimeSession({ owner }) {
      const { cookies } = await authFor(owner);
      const token = accessCookie(cookies) || priorCookies[owner]?.match(
        /(?:^|;\s*)accessToken=([^;]*)/)?.[1];
      requireCondition(token, `Runtime credential unavailable for ${owner} user`);
      const rows = owner === "existing" ? existingIdentity.runtime : identityRowsByOwner.disposable?.runtime;
      const userId = rows?.[0]?.id;
      requireCondition(userId != null, `Runtime identity unavailable for ${owner} user session`);
      return sessionEvidence(runtimeDb, userId, token);
    },
    async replayProductCredential({ owner }) { return replayProduct(owner); },
    async replayRuntimeCredential({ owner }) { return replayRuntime(owner); },
    async freshLogin({ owner }) {
      const targetPage = pages[owner];
      requireCondition(targetPage, `Browser page for ${owner} user is unavailable`);
      networkAudit.phase = `${owner}-fresh-login`;
      const email = owner === "existing" ? existingEmail : disposableEmail;
      const password = owner === "existing"
        ? process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD : ephemeralPassword;
      const fresh = await loginPage(targetPage, email, password);
      const cookie = cookieHeader(await targetPage.cookies(product));
      priorCookies[owner] = cookie;
      const runtime = await runtimeCheck(cookie);
      return {
        productStatus: fresh.me.status,
        productUserId: fresh.me.body?.id ?? null,
        runtimeStatus: runtime.status,
        runtimeAuthenticated: runtime.authenticated,
        runtimeUserId: runtime.userId,
        dashboardReached: fresh.dashboardReached,
        dashboardStatus: fresh.dashboardStatus,
        projects: fresh.projects.body,
      };
    },
    async networkAudit() {
      return {
        forbiddenHostnameCount: networkAudit.forbiddenHosts.size,
        forbiddenHostnameCountsByPhase: Object.fromEntries(
          [...networkAudit.phases].map(([phase, hosts]) => [phase, hosts.size]),
        ),
      };
    },
    async writeCredentialHandoff({ owner }) {
      requireCondition(owner === "new", "Credential handoff only supports the new user");
      requireCondition(!handoffWritten, "Credential handoff may only be written once");
      const temporaryPath = `${handoffPath}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
      try {
        await writeFile(temporaryPath, `${JSON.stringify({
          email: disposableEmail,
          password: ephemeralPassword,
        })}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
        // Hard-link creation is atomic and fails rather than replacing an
        // existing handoff, while ensuring readers never see partial JSON.
        await link(temporaryPath, handoffPath);
      } finally {
        await unlink(temporaryPath).catch(() => undefined);
      }
      handoffWritten = true;
      return { written: true };
    },
    async cleanup() {
      if (signupObserver && page) page.off("request", signupObserver);
      signupObserver = null;
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
        existingPage = null;
      }
    },
  };
  return io;
}