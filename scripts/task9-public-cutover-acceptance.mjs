#!/usr/bin/env node

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, chmod, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LAB_PACKAGE = path.join(ROOT, "lab/bc-vibesdk-lab-20260925/package.json");
const puppeteer = createRequire(LAB_PACKAGE)("puppeteer");
const BASE = "https://app.buildcustom.ai";
const RUNTIME = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const PRIVATE_CONTROL_PLANE = "https://buildcustom-control-plane-launch.thegoldimport.workers.dev";
const PRIVATE_GATEWAY_HOST = "buildcustom-apps-gateway-launch.thegoldimport.workers.dev";
const TESTER_ID = "3f730b86-bc16-4954-b3fd-db22aea136b7";
const TESTER_EMAIL = "cutover-test@buildcustom.ai";
const PROJECT_ID = 2;
const AGENT_ID = "098c1d12-5689-4bcf-bb12-2b2d60b10a10";
const REVISION = "e4dce7b936ff4c85a381c4282ece2224b5c0e957";
const MARKER = "BUILDCUSTOM_CUTOVER_TESTER_OK";
const UI_TIMEOUT = 90_000;
const phase = process.argv[2]?.replace(/^--phase=/, "");

if (!["smoke", "auth", "replit-off"].includes(phase) || process.argv.length !== 3
  || new URL(BASE).origin !== BASE) {
  throw new Error("Usage: node scripts/task9-public-cutover-acceptance.mjs --phase=smoke|auth|replit-off");
}
if (phase !== "smoke") {
  assert(typeof process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD === "string"
    && process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD.length > 0,
  "BUILDCUSTOM_CUTOVER_TESTER_PASSWORD is required for authenticated phases.");
}
if (phase === "replit-off") {
  assert.equal(process.env.TASK9_REPLIT_DEVELOPMENT_CONFIRMED_STOPPED, "1",
    "The main agent must independently verify only the Replit development workflow is stopped before setting TASK9_REPLIT_DEVELOPMENT_CONFIRMED_STOPPED=1.");
}

const FORBIDDEN_HOST = [
  /(^|\.)replit\.(?:com|dev|app)$/i,
  /(^|\.)apps\.buildcustom\.ai$/i,
  /^vibesdk\./i,
  /(^|[-.])(?:legacy|staging|lab)([-.]|$)/i,
  /^buildcustom-control-plane-launch\.thegoldimport\.workers\.dev$/i,
  /^buildcustom-vibesdk-launch\.thegoldimport\.workers\.dev$/i,
  /^buildcustom-apps-gateway-launch\.thegoldimport\.workers\.dev$/i,
];

function report(stage, evidence = {}) {
  console.log(JSON.stringify({ stage, ...evidence }));
}

function safeError(error) {
  return String(error instanceof Error ? error.message : error || "Unknown failure")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
      try { return new URL(value.replace(/[),.;]+$/, "")).origin; } catch { return "[url]"; }
    })
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]")
    .replace(/\b(?:password|passwd|(?:access|refresh)[_-]?token|token|secret|authorization|cookie|csrf)\b["']?(\s*[:=]\s*)["']?([^"'\s,;}]+)/gi, "$1[redacted]")
    .replace(/\btk_[a-f0-9]{24,}\b/gi, "[ticket]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 400);
}

function hostIsForbidden(host) {
  return FORBIDDEN_HOST.some((pattern) => pattern.test(host));
}

function assertPublicPageOrigin(page, context) {
  const current = new URL(page.url());
  assert.equal(current.protocol, "https:", `${context}: browser page is not HTTPS.`);
  assert.equal(current.origin, BASE, `${context}: browser page left the exact public product origin.`);
}

async function goPublic(page, pathname, options) {
  const response = await page.goto(new URL(pathname, BASE).href, options);
  assertPublicPageOrigin(page, "Navigation");
  return response;
}

function startAudit(page) {
  const audit = {
    requests: 0,
    forbiddenHosts: new Set(),
    redirects: new Set(),
    failedAssets: [],
    previewStatuses: [],
    sockets: 0,
    handshakes: 0,
    sentSuggestions: 0,
    agentConnectedFrames: 0,
    conversationStateFrames: 0,
    streamingFrames: 0,
    creationRequests: 0,
    publishMutations: 0,
    blockedMutations: 0,
    originViolations: [],
  };
  let previewOrigin = "";
  const socketRequests = new Set();
  const acceptedSocketRequests = new Set();
  page.on("framenavigated", (frame) => {
    if (frame !== page.mainFrame()) return;
    try {
      const url = new URL(frame.url());
      if (url.protocol !== "https:" || url.origin !== BASE) audit.originViolations.push(url.protocol);
    } catch { audit.originViolations.push("invalid"); }
  });
  page.on("request", (request) => {
    const method = request.method().toUpperCase();
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
      void request.continue().catch(() => undefined);
      return;
    }
    let allowed = false;
    let cloudflareTelemetry = false;
    try {
      const url = new URL(request.url());
      allowed = url.origin === BASE && method === "POST"
        && ["/api/auth/login", "/api/auth/logout"].includes(url.pathname);
      cloudflareTelemetry = url.origin === BASE && method === "POST"
        && url.pathname === "/cdn-cgi/rum";
    } catch { /* Fail closed for malformed mutation URLs. */ }
    if (allowed) {
      void request.continue().catch(() => undefined);
    } else if (cloudflareTelemetry) {
      // Cloudflare-injected RUM is not an application mutation; keep it blocked.
      void request.abort("blockedbyclient").catch(() => undefined);
    } else {
      audit.blockedMutations += 1;
      void request.abort("blockedbyclient").catch(() => undefined);
    }
  });
  const interceptionReady = page.setRequestInterception(true);
  const clientPromise = page.target().createCDPSession();
  const ready = Promise.all([interceptionReady, clientPromise]).then(async ([, client]) => {
    await client.send("Network.enable");
    client.on("Network.requestWillBeSent", ({ request, type, redirectResponse }) => {
      audit.requests += 1;
      try {
        const url = new URL(request.url);
        const host = url.hostname.toLowerCase();
        if (hostIsForbidden(host)) audit.forbiddenHosts.add(host);
        if (redirectResponse && hostIsForbidden(host)) audit.redirects.add(host);
        if (request.method.toUpperCase() === "POST"
          && /^\/api\/(?:projects|agents?|thinkagents?)\/?$/.test(url.pathname)) {
          audit.creationRequests += 1;
        }
        if (/\/(?:runtime\/)?(?:publish|publish-immutable|publish-immutable-v2)(?:\/|$)/i.test(url.pathname)
          && !["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
          audit.publishMutations += 1;
        }
      } catch { /* Invalid or opaque URLs are not retained. */ }
      if (type === "Document" && redirectResponse) {
        try {
          const host = new URL(request.url).hostname.toLowerCase();
          if (hostIsForbidden(host)) audit.redirects.add(host);
        } catch { /* Ignore malformed redirect targets. */ }
      }
    });
    client.on("Network.loadingFailed", ({ requestId, type }) => {
      if (["Document", "Stylesheet", "Script"].includes(type)) {
        audit.failedAssets.push(type);
      }
      socketRequests.delete(requestId);
    });
    client.on("Network.responseReceived", ({ response, type }) => {
      try {
        const url = new URL(response.url);
        if (previewOrigin && url.origin === previewOrigin
          && (type === "Document" || url.pathname.endsWith("/styles.css"))) {
          audit.previewStatuses.push({
            resource: url.pathname.endsWith("/styles.css") ? "styles.css" : "document",
            status: response.status,
          });
        }
      } catch { /* Do not retain request URLs or query strings. */ }
    });
    client.on("Network.webSocketCreated", ({ requestId, url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.protocol === "wss:" && parsed.hostname === new URL(BASE).hostname
          && parsed.pathname.endsWith("/runtime/ws")) {
          audit.sockets += 1;
          socketRequests.add(requestId);
        }
        if (hostIsForbidden(parsed.hostname.toLowerCase())) audit.forbiddenHosts.add(parsed.hostname.toLowerCase());
      } catch { /* Ignore malformed socket URLs. */ }
    });
    client.on("Network.webSocketHandshakeResponseReceived", ({ requestId, response }) => {
      if (socketRequests.has(requestId) && response?.status === 101) {
        audit.handshakes += 1;
        acceptedSocketRequests.add(requestId);
      }
    });
    client.on("Network.webSocketFrameSent", ({ requestId, response }) => {
      if (!acceptedSocketRequests.has(requestId)) return;
      try {
        const frame = JSON.parse(response?.payloadData || "null");
        if (frame?.type === "user_suggestion") audit.sentSuggestions += 1;
      } catch { /* Framework/control frames do not affect the suggestion count. */ }
    });
    client.on("Network.webSocketFrameReceived", ({ requestId, response }) => {
      if (!acceptedSocketRequests.has(requestId)) return;
      try {
        const frame = JSON.parse(response?.payloadData || "null");
        if (frame?.type === "agent_connected") audit.agentConnectedFrames += 1;
        if (frame?.type === "conversation_state") audit.conversationStateFrames += 1;
        if (frame?.type === "conversation_response" && frame.isStreaming === true) audit.streamingFrames += 1;
      } catch { /* Ignore non-JSON control frames. */ }
    });
    return client;
  });
  return {
    audit,
    ready,
    setPreviewOrigin(value) { previewOrigin = new URL(value, BASE).origin; },
  };
}

async function api(page, pathname, options = {}) {
  return page.evaluate(async ({ pathname, method, body, headers }) => {
    const response = await fetch(pathname, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const payload = await response.json().catch(() => null);
    return { status: response.status, payload };
  }, { pathname, method: options.method || "GET", body: options.body, headers: options.headers || {} });
}

async function getProject(page) {
  const result = await api(page, `/api/projects/${PROJECT_ID}`);
  assert.equal(result.status, 200, "Tester project is unavailable.");
  return result.payload;
}

async function getRuntime(page, operation) {
  const result = await api(page, `/api/projects/${PROJECT_ID}/runtime/${operation}`);
  assert.equal(result.status, 200, `Owner runtime ${operation} failed.`);
  return result.payload;
}

async function getRevision(page) {
  const result = await getRuntime(page, "revision");
  const revision = result?.commitHash || result?.revision?.commitHash;
  assert.equal(revision, REVISION, "Authoritative committed revision drifted.");
  return revision;
}

async function getFiles(page) {
  const result = await getRuntime(page, "files");
  const files = Array.isArray(result) ? result : result?.files;
  assert(Array.isArray(files), "Runtime returned no authoritative file list.");
  return files;
}

async function getFileContent(page, filePath) {
  const result = await api(page, `/api/projects/${PROJECT_ID}/runtime/files/content?path=${encodeURIComponent(filePath)}`);
  assert.equal(result.status, 200, `Authoritative ${filePath} read failed.`);
  assert.equal(result.payload?.path, filePath);
  return result.payload.content;
}

async function authMe(page) {
  const result = await api(page, "/api/auth/me");
  return {
    status: result.status,
    userId: result.payload?.id || null,
    role: result.payload?.role || null,
  };
}

async function login(page) {
  await goPublic(page, "/app/login", { waitUntil: "domcontentloaded" });
  assertPublicPageOrigin(page, "Before entering tester credentials");
  await page.locator('[data-testid="input-email"]').fill(TESTER_EMAIL);
  await page.locator('[data-testid="input-password"]').fill(process.env.BUILDCUSTOM_CUTOVER_TESTER_PASSWORD);
  await page.locator('[data-testid="button-submit"]').click();
  await page.waitForFunction(() => location.pathname === "/app" || location.pathname === "/app/", { timeout: UI_TIMEOUT });
  assertPublicPageOrigin(page, "After tester login navigation");
  const me = await authMe(page);
  assert.equal(me.status, 200);
  assert.equal(me.userId, TESTER_ID);
  assert.equal(me.role, "user");
  return me;
}

async function dashboard(page) {
  await goPublic(page, "/app", { waitUntil: "domcontentloaded" });
  const result = await api(page, "/api/projects");
  assert.equal(result.status, 200, "Authenticated dashboard request failed.");
  assert(Array.isArray(result.payload));
  assert.equal(result.payload.length, 1, "Dashboard does not contain exactly the tester project.");
  const matches = result.payload.filter((item) => Number(item.id) === PROJECT_ID);
  assert.equal(matches.length, 1);
  return result.payload;
}

async function ownerSnapshot(page) {
  const [project, status, revision, files, turns, releases, html, css] = await Promise.all([
    getProject(page),
    getRuntime(page, "status"),
    getRevision(page),
    getFiles(page),
    getRuntime(page, "turns"),
    getRuntime(page, "releases"),
    getFileContent(page, "public/index.html"),
    getFileContent(page, "public/styles.css"),
  ]);
  assert.equal(project.agentId || status.agentId, AGENT_ID);
  assert.equal(status.nativeThink, true);
  assert.equal(status.state?.shouldBeGenerating, false);
  assert(files.some((file) => file.path === "public/index.html"));
  assert(files.some((file) => file.path === "public/styles.css"));
  assert(html.includes(MARKER));
  assert.match(html, /href=["'][^"']*styles\.css/i);
  assert(css.length > 0);
  assert(JSON.stringify(turns).includes(MARKER), "Existing conversation did not hydrate.");
  return { project, status, revision, files, turns, releases, html, css };
}

function releaseIds(value) {
  const releases = Array.isArray(value) ? value : value?.releases;
  assert(Array.isArray(releases), "Release list is unavailable.");
  return releases.map((release) => String(release.id ?? release.releaseId ?? "")).sort();
}

async function openEditor(page) {
  await goPublic(page, `/app/project/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-header-open-builder"]', { visible: true, timeout: UI_TIMEOUT });
  await page.locator('[data-testid="button-header-open-builder"]').click();
  await page.waitForFunction((id) => location.pathname === `/app/editor/${id}`, { timeout: UI_TIMEOUT }, PROJECT_ID);
  assertPublicPageOrigin(page, "Project editor navigation");
  await page.waitForSelector('[data-testid="button-open-native-publish"]', { visible: true, timeout: UI_TIMEOUT });
}

async function inspectPreview(page, status, audit, expectedCss) {
  const previewUrl = status.previewUrl || status.previewURL || status.state?.previewUrl || status.state?.previewURL;
  assert(previewUrl, "Runtime did not provide a preview URL.");
  const target = new URL(previewUrl, BASE);
  assert.equal(target.protocol, "https:");
  audit.setPreviewOrigin(target.href);
  await page.waitForFunction((expected) => [...document.querySelectorAll("iframe")]
    .some((frame) => frame.title.includes("project preview") && frame.src === expected),
  { timeout: 35_000 }, target.href).catch(() => undefined);
  let frame = page.frames().find((candidate) => {
    try {
      const current = new URL(candidate.url());
      return current.origin === target.origin
        && (current.pathname === target.pathname || current.pathname.startsWith(`${target.pathname.replace(/\/$/, "")}/`));
    } catch { return false; }
  });
  const deadline = Date.now() + 45_000;
  while (!frame && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    frame = page.frames().find((candidate) => {
      try {
        const current = new URL(candidate.url());
        return current.origin === target.origin
          && (current.pathname === target.pathname || current.pathname.startsWith(`${target.pathname.replace(/\/$/, "")}/`));
      } catch { return false; }
    });
  }
  assert(frame, "Preview iframe did not navigate to runtime preview.");
  await frame.waitForFunction(() => document.readyState === "interactive" || document.readyState === "complete");
  await frame.waitForFunction((marker) => (document.body?.innerText || "").includes(marker)
    && [...document.querySelectorAll('link[rel="stylesheet"]')]
      .some((link) => new URL(link.href).pathname.endsWith("/styles.css") && Boolean(link.sheet)),
  { timeout: 45_000 }, MARKER);
  const evidence = await frame.evaluate(async (marker, productOrigin, authoritativeCss, requestedProjectId) => {
    const heading = [...document.querySelectorAll("h1,h2,[role=heading]")].find((element) =>
      (element.textContent || "").includes(marker));
    let parentDocumentReadable = false;
    try {
      void window.parent.document.title;
      void window.parent.document.cookie;
      parentDocumentReadable = true;
    } catch { /* Opaque sandbox origin. */ }
    let productApiReadable = false;
    try {
      const response = await fetch(`${productOrigin}/api/projects/${requestedProjectId}`, {
        credentials: "include",
        cache: "no-store",
      });
      if (response.ok) {
        const payload = await response.json().catch(() => null);
        const project = payload?.data || payload?.project || payload;
        productApiReadable = Number(project?.id) === requestedProjectId;
      }
    } catch { /* Opaque origin/CORS must prevent reading authenticated product API data. */ }
    // A sandboxed preview has an opaque origin, so reading stylesheet.cssRules
    // can throw even when the external CSS loaded and applied correctly.
    const bodyBackground = authoritativeCss.match(/body\s*\{[^}]*background-color:\s*(#[0-9a-f]{6})/i)?.[1];
    const headingFontSize = authoritativeCss.match(/\.prominent-heading\s*\{[^}]*font-size:\s*([0-9.]+rem)/i)?.[1];
    let computedStyleEvidence = null;
    if (bodyBackground && headingFontSize && heading?.matches(".prominent-heading")) {
      const probe = document.createElement("div");
      probe.style.backgroundColor = bodyBackground;
      probe.style.fontSize = headingFontSize;
      document.body.append(probe);
      const expectedBackground = getComputedStyle(probe).backgroundColor;
      const expectedHeadingFontSize = getComputedStyle(probe).fontSize;
      probe.remove();
      const actualBackground = getComputedStyle(document.body).backgroundColor;
      const actualHeadingFontSize = getComputedStyle(heading).fontSize;
      if (actualBackground === expectedBackground && actualHeadingFontSize === expectedHeadingFontSize) {
        computedStyleEvidence = { bodyBackground: actualBackground, headingFontSize: actualHeadingFontSize };
      }
    }
    return {
      markerVisible: (document.body?.innerText || "").includes(marker),
      stylesheetLoaded: [...document.querySelectorAll('link[rel="stylesheet"]')]
        .some((link) => new URL(link.href).pathname.endsWith("/styles.css") && Boolean(link.sheet)),
      computedStyleEvidence,
      parentDocumentReadable,
      productApiReadable,
    };
  }, MARKER, BASE, expectedCss, PROJECT_ID);
  evidence.iframeSandbox = await page.$eval('iframe[title*="project preview"]',
    (element) => element.getAttribute("sandbox") || "");
  assert.equal(evidence.markerVisible, true);
  assert.equal(evidence.stylesheetLoaded, true);
  assert(evidence.computedStyleEvidence,
    "Preview computed styles did not match the authoritative public/styles.css.");
  assert.equal(evidence.iframeSandbox, "allow-scripts");
  assert.equal(evidence.parentDocumentReadable, false, "Preview can read its product parent document.");
  assert.equal(evidence.productApiReadable, false, "Preview can read authenticated product API data.");
  return evidence;
}

async function inspectFilesUi(page, expectedHtml) {
  await goPublic(page, `/app/project/${PROJECT_ID}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="tab-files"]', { visible: true, timeout: UI_TIMEOUT });
  await page.locator('[data-testid="tab-files"]').click();
  await page.waitForSelector('[data-testid="file-row-index.html"]', { visible: true, timeout: UI_TIMEOUT });
  await page.locator('[data-testid="file-row-index.html"]').click();
  await page.waitForFunction(() => [...document.querySelectorAll("pre")].some((element) => element.textContent?.length));
  const rendered = await page.$eval("pre", (element) => element.textContent || "");
  assert(rendered.includes(MARKER));
  assert.equal(rendered.replace(/\r\n/g, "\n"), expectedHtml.replace(/\r\n/g, "\n"));
}

async function inspectPublishUi(page) {
  await page.locator('[data-testid="button-open-native-publish"]').click();
  await page.waitForSelector('[data-testid="publishing-drawer"]', { visible: true, timeout: UI_TIMEOUT });
  const evidence = await page.evaluate((privateGatewayHost) => {
    const button = document.querySelector('[data-testid="button-publish-native"]');
    const drawer = document.querySelector('[data-testid="publishing-drawer"]');
    const text = drawer?.innerText || "";
    const actions = [...(drawer?.querySelectorAll("a,button") || [])];
    return {
      buttonPresent: button instanceof HTMLButtonElement,
      publicAppsUnavailableText: /public generated apps are not enabled yet|this deployment is internal only;\s*its private address is hidden until public apps are enabled/i.test(text),
      reservedNotLive: /reserved project address \(not live\)/i.test(text),
      futurePublicDomain: text.includes(".apps.buildcustom.ai"),
      publicLiveClaim: /\b(?:publicly\s+(?:live|available|published)|live\s+at|public\s+url)\b/i.test(text)
        || actions.some((node) => {
          try { return new URL(node.getAttribute("href") || "", location.href).hostname.endsWith(".apps.buildcustom.ai"); }
          catch { return false; }
        }),
      privateUrlShown: /workers\.dev/i.test(text)
        || text.toLowerCase().includes(privateGatewayHost.toLowerCase())
        || actions.some((node) => {
          try { return new URL(node.getAttribute("href") || "", location.href).hostname.endsWith(".workers.dev"); }
          catch { return false; }
        }),
      openSiteAvailable: actions.some((node) => /open site/i.test(node.textContent || "")),
    };
  }, PRIVATE_GATEWAY_HOST);
  assert(evidence.buttonPresent, "Publish drawer did not expose its action for safety inspection.");
  assert.equal(evidence.publicAppsUnavailableText, true, "Publish UI did not show an accepted internal-only/disabled status.");
  assert.equal(evidence.reservedNotLive, true, "Reserved generated-app address was not labeled NOT LIVE.");
  assert.equal(evidence.futurePublicDomain, true, "Publish UI omitted the reserved apps.buildcustom.ai address.");
  assert.equal(evidence.publicLiveClaim, false, "Publish UI claimed public availability or linked a public-live address.");
  assert.equal(evidence.privateUrlShown, false, "Publish UI exposed a private generated-app URL.");
  assert.equal(evidence.openSiteAvailable, false, "Publish UI exposed an Open Site action.");
  return evidence;
}

function isAuthenticationCookie(name) {
  return /session|access.?token|auth.?token|oauth.?token/i.test(name) && !/csrf/i.test(name);
}

async function cookieHeader(page, host = new URL(BASE).hostname, predicate = () => true, required = true) {
  const cdp = await page.target().createCDPSession();
  try {
    await cdp.send("Network.enable");
    const result = await cdp.send("Network.getAllCookies");
    const cookies = (result.cookies || []).filter((cookie) =>
      cookie.domain.replace(/^\./, "") === host && cookie.value && predicate(cookie.name));
    if (required) assert(cookies.length > 0, "Expected host cookies are absent.");
    return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

async function cookieExists(page) {
  const cdp = await page.target().createCDPSession();
  try {
    await cdp.send("Network.enable");
    const result = await cdp.send("Network.getAllCookies");
    return (result.cookies || []).some((cookie) => cookie.domain.replace(/^\./, "") === new URL(BASE).hostname
      && cookie.value && isAuthenticationCookie(cookie.name));
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

async function fetchJson(url, init) {
  const response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload };
}

function registrationCode(payload) {
  const code = String(payload?.code || payload?.error?.code || payload?.error?.type
    || payload?.error?.message || payload?.message || "");
  if (/registration.{0,20}closed|registration_disabled/i.test(code)) return "closed";
  if (/origin/i.test(code)) return "origin-denied";
  if (/csrf/i.test(code)) return "csrf-denied";
  return "other";
}

async function productCsrf(page) {
  const result = await page.evaluate(async () => {
    const response = await fetch("/api/auth/csrf-token", { credentials: "same-origin", cache: "no-store" });
    const body = await response.json().catch(() => null);
    return { status: response.status, token: body?.token || body?.data?.token || null };
  });
  assert.equal(result.status, 200);
  assert(typeof result.token === "string" && result.token.length > 0);
  return result.token;
}

async function safeProductOriginPost(page, origin) {
  const [authCookies, csrfCookies, token] = await Promise.all([
    cookieHeader(page, new URL(BASE).hostname, isAuthenticationCookie, false),
    cookieHeader(page, new URL(BASE).hostname, (name) => /csrf/i.test(name), false),
    productCsrf(page),
  ]);
  const result = await fetchJson(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
      Cookie: [authCookies, csrfCookies].filter(Boolean).join("; "),
      Origin: origin,
    },
    body: "{}",
  });
  return { status: result.status, code: registrationCode(result.payload) };
}

function setCookieValues(headers) {
  return (headers.getSetCookie?.() || []).map((cookie) => cookie.split(";")[0]).filter(Boolean).join("; ");
}

async function safeRuntimeRegistrationProbe(origin = BASE) {
  const csrfResponse = await fetch(`${RUNTIME}/api/auth/csrf-token`, { signal: AbortSignal.timeout(20_000) });
  const body = await csrfResponse.json().catch(() => null);
  const token = body?.token || body?.data?.token;
  const cookies = setCookieValues(csrfResponse.headers);
  assert(csrfResponse.ok && typeof token === "string" && token.length > 0 && cookies,
    "Could not obtain a one-use CSRF context for the non-mutating runtime registration probe.");
  const result = await fetchJson(`${RUNTIME}/api/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": token,
      Cookie: cookies,
      Origin: origin,
    },
    body: "{}",
  });
  return { status: result.status, code: registrationCode(result.payload) };
}

async function checkOrigins(page) {
  const safeBody = "{}";
  const [token, authCookies, csrfCookies] = await Promise.all([
    productCsrf(page),
    cookieHeader(page, new URL(BASE).hostname, isAuthenticationCookie, false),
    cookieHeader(page, new URL(BASE).hostname, (name) => /csrf/i.test(name), false),
  ]);
  const cookie = [authCookies, csrfCookies].filter(Boolean).join("; ");
  async function probe(origin) {
    const result = await fetchJson(`${BASE}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": token,
        Cookie: cookie,
        Origin: origin,
      },
      body: safeBody,
    });
    return { status: result.status, code: registrationCode(result.payload) };
  }
  const accepted = await probe(BASE);
  assert.equal(accepted.status, 403);
  assert.equal(accepted.code, "closed", "Valid product Origin did not reach the closed registration gate.");
  const rejected = [];
  for (const origin of [
    "https://buildcustom.ai",
    "https://random.example",
    "https://anything.apps.buildcustom.ai",
    PRIVATE_CONTROL_PLANE,
  ]) {
    const result = await probe(origin);
    assert([400, 403].includes(result.status), "Invalid Origin was not rejected.");
    assert(["origin-denied", "csrf-denied"].includes(result.code),
      "Invalid Origin reached an unexpected registration result.");
    rejected.push(result.status);
  }
  const runtimeValid = await safeRuntimeRegistrationProbe(BASE);
  assert.equal(runtimeValid.status, 403);
  assert.equal(runtimeValid.code, "closed");
  const runtimeInvalid = await safeRuntimeRegistrationProbe(PRIVATE_CONTROL_PLANE);
  assert([400, 403].includes(runtimeInvalid.status));
  // The direct private runtime can recognize the control-plane canary origin;
  // its registration gate must still reject the request.
  assert(["origin-denied", "csrf-denied", "closed"].includes(runtimeInvalid.code));
  return {
    validOriginClosed: true,
    invalidOriginsRejected: rejected.length + (runtimeInvalid.code === "closed" ? 0 : 1),
    runtimeRegistrationClosed: true,
  };
}

async function assertSignupClosed(page) {
  const capabilities = await api(page, "/api/public/capabilities");
  assert.equal(capabilities.status, 200);
  assert.equal(capabilities.payload?.registrationEnabled, false);
  assert.equal(capabilities.payload?.publicGeneratedAppsEnabled, false);
  await goPublic(page, "/app/signup", { waitUntil: "domcontentloaded" });
  const ui = await page.evaluate(() => ({
    pathname: location.pathname,
    controls: [...document.querySelectorAll("button,a")].filter((node) =>
      /sign\s*up|create\s*account|register/i.test(node.textContent || "")).length,
    nameFields: document.querySelectorAll('[data-testid="input-name"]').length,
  }));
  assert.equal(ui.controls, 0);
  assert.equal(ui.nameFields, 0);
  const probe = await safeProductOriginPost(page, BASE);
  assert.equal(probe.status, 403);
  assert.equal(probe.code, "closed");
  const runtime = await safeRuntimeRegistrationProbe(BASE);
  assert.equal(runtime.status, 403);
  assert.equal(runtime.code, "closed");
}

async function inspectPublicProject(page, audit) {
  const initial = await ownerSnapshot(page);
  audit.setPreviewOrigin(initial.status.previewUrl || initial.status.previewURL
    || initial.status.state?.previewUrl || initial.status.state?.previewURL);
  await openEditor(page);
  // CDP evidence is held in the Node process, so wait for it without exposing frame data.
  const socketDeadline = Date.now() + 20_000;
  while ((audit.audit.handshakes === 0 || audit.audit.agentConnectedFrames === 0
    || audit.audit.conversationStateFrames === 0) && Date.now() < socketDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await page.waitForFunction(() => {
    const element = document.querySelector('[data-testid="native-completion-state"]');
    const state = element?.getAttribute("data-state");
    return state !== "streaming" && !document.querySelector('[data-testid="button-stop-build"]');
  }, { timeout: 45_000 }).catch(() => undefined);
  const conversation = await getRuntime(page, "turns");
  assert(JSON.stringify(conversation).includes(MARKER));
  const preview = await inspectPreview(page, initial.status, audit, initial.css);
  const publishUi = await inspectPublishUi(page);
  await inspectFilesUi(page, initial.html);
  const [revisionAfter, statusAfter, releasesAfter, projectAfter] = await Promise.all([
    getRevision(page),
    getRuntime(page, "status"),
    getRuntime(page, "releases"),
    getProject(page),
  ]);
  assert.equal(revisionAfter, REVISION);
  assert.equal(projectAfter.agentId || statusAfter.agentId, AGENT_ID);
  assert.equal(statusAfter.state?.shouldBeGenerating, false);
  assert.deepEqual(releaseIds(releasesAfter), releaseIds(initial.releases));
  assert.equal(audit.audit.sockets > 0, true);
  assert.equal(audit.audit.handshakes > 0, true);
  assert(audit.audit.agentConnectedFrames > 0);
  assert(audit.audit.conversationStateFrames > 0);
  assert.equal(audit.audit.sentSuggestions, 0);
  assert.equal(audit.audit.streamingFrames, 0);
  assert.equal(audit.audit.creationRequests, 0);
  assert.equal(audit.audit.publishMutations, 0);
  return { revision: revisionAfter, preview, publishUi, filesVerified: true, idleSocket: true };
}

async function legacyCookieCollision(browser, auditList) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  page.setDefaultTimeout(UI_TIMEOUT);
  page.setDefaultNavigationTimeout(UI_TIMEOUT);
  const audit = startAudit(page);
  auditList.push(audit);
  await audit.ready;
  try {
    await goPublic(page, "/app/login", { waitUntil: "domcontentloaded" });
    await page.setCookie(
      { name: "accessToken", value: "stale-task9-legacy-access-token", url: BASE, secure: true, sameSite: "Lax" },
      { name: "csrf-token", value: "stale-task9-legacy-csrf-token", url: BASE, secure: true, sameSite: "Lax" },
    );
    await goPublic(page, "/app", { waitUntil: "domcontentloaded" });
    const unauthenticated = await authMe(page);
    assert.notEqual(unauthenticated.userId, TESTER_ID, "Stale legacy cookies authenticated as the tester.");
    const staleProject = await api(page, `/api/projects/${PROJECT_ID}`);
    assert([401, 403, 404].includes(staleProject.status), "Stale legacy cookies bypassed project ownership.");
    await login(page);
    await dashboard(page);
    const snapshot = await ownerSnapshot(page);
    await inspectPublicProject(page, audit);
    assert.equal(snapshot.project.agentId || snapshot.status.agentId, AGENT_ID);
    return true;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function verifyLogout(page) {
  await goPublic(page, "/app", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="button-logout"]', { visible: true, timeout: UI_TIMEOUT });
  const oldCookie = await cookieHeader(page, new URL(BASE).hostname, isAuthenticationCookie);
  await page.locator('[data-testid="button-logout"]').click();
  await page.waitForFunction(() => location.pathname === "/app/login", { timeout: UI_TIMEOUT });
  assertPublicPageOrigin(page, "Logout navigation");
  assert.equal(await cookieExists(page), false, "Logout did not clear the product session cookie.");
  const product = await fetchJson(`${BASE}/api/auth/me`, {
    headers: { Cookie: oldCookie },
  });
  assert([200, 401].includes(product.status));
  assert.notEqual(product.payload?.id, TESTER_ID, "Exact pre-logout cookie remained valid for product API.");
  const runtime = await fetchJson(`${RUNTIME}/api/auth/check`, {
    headers: { Cookie: oldCookie },
  });
  const runtimeAuth = runtime.payload?.data || runtime.payload;
  assert.equal(runtimeAuth?.authenticated, false, "Exact pre-logout cookie remained valid for runtime auth/check.");
  await login(page);
  assert.equal((await authMe(page)).userId, TESTER_ID);
}

async function smoke(page, audit) {
  await audit.ready;
  const response = await goPublic(page, "/", { waitUntil: "networkidle2", timeout: UI_TIMEOUT });
  assert(response && response.status() >= 200 && response.status() < 400, "Public unauthenticated frontend did not load successfully.");
  assertPublicPageOrigin(page, "Unauthenticated public entry");
  const scriptAndStyle = await page.evaluate(() => ({
    scripts: [...document.scripts].filter((script) => script.src).length,
    styles: [...document.querySelectorAll('link[rel="stylesheet"]')].length,
  }));
  assert(scriptAndStyle.scripts > 0 && scriptAndStyle.styles > 0, "Frontend JS or CSS assets did not load.");
  await goPublic(page, "/app/login", { waitUntil: "networkidle2", timeout: UI_TIMEOUT });
  await page.waitForSelector('[data-testid="input-email"]', { visible: true, timeout: UI_TIMEOUT });
  await page.waitForSelector('[data-testid="input-password"]', { visible: true, timeout: UI_TIMEOUT });
  await assertSignupClosed(page);
  const runtimeRegistration = await safeRuntimeRegistrationProbe(BASE);
  assert.equal(runtimeRegistration.status, 403);
  assert.equal(runtimeRegistration.code, "closed");
  return { httpStatus: response.status(), assetsPresent: true, signupClosed: true, registrationRejected: true };
}

async function authPhase(page, audit, browser, audits) {
  await audit.ready;
  const me = await login(page);
  await dashboard(page);
  assert.equal(me.userId, TESTER_ID);
  assert.equal(me.role, "user");
  await assertSignupClosed(page);
  const origins = await checkOrigins(page);
  const reopened = await inspectPublicProject(page, audit);
  await verifyLogout(page);
  const legacyCookieCollisionVerified = await legacyCookieCollision(browser, audits);
  return { identity: true, dashboardProjectCount: 1, reopened, logoutRevocation: true, freshLogin: true, origins, legacyCookieCollisionVerified };
}

async function replitOffPhase(page, audit) {
  await audit.ready;
  await login(page);
  await dashboard(page);
  const reopened = await inspectPublicProject(page, audit);
  return { freshLogin: true, dashboard: true, reopened, publishRequests: 0 };
}

async function main() {
  const profile = await mkdtemp(path.join(os.tmpdir(), "task9-public-cutover-"));
  let browser;
  let completion = null;
  try {
    await chmod(profile, 0o700);
    browser = await puppeteer.launch({
      executablePath: "/repl/tools/bin/chromium",
      headless: true,
      userDataDir: path.join(profile, "profile"),
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      defaultViewport: { width: 1440, height: 1000 },
    });
    const page = await browser.newPage();
    page.setDefaultTimeout(UI_TIMEOUT);
    page.setDefaultNavigationTimeout(UI_TIMEOUT);
    const audit = startAudit(page);
    const audits = [audit];
    const results = phase === "smoke"
      ? await smoke(page, audit)
      : phase === "auth"
        ? await authPhase(page, audit, browser, audits)
        : await replitOffPhase(page, audit);
    const combined = audits.reduce((sum, entry) => ({
      requests: sum.requests + entry.audit.requests,
      forbiddenHosts: new Set([...sum.forbiddenHosts, ...entry.audit.forbiddenHosts]),
      redirects: new Set([...sum.redirects, ...entry.audit.redirects]),
      failedAssets: sum.failedAssets + entry.audit.failedAssets.length,
      previewStatuses: [...sum.previewStatuses, ...entry.audit.previewStatuses],
      sockets: sum.sockets + entry.audit.sockets,
      handshakes: sum.handshakes + entry.audit.handshakes,
      agentConnectedFrames: sum.agentConnectedFrames + entry.audit.agentConnectedFrames,
      conversationStateFrames: sum.conversationStateFrames + entry.audit.conversationStateFrames,
      sentSuggestions: sum.sentSuggestions + entry.audit.sentSuggestions,
      streamingFrames: sum.streamingFrames + entry.audit.streamingFrames,
      creationRequests: sum.creationRequests + entry.audit.creationRequests,
      publishMutations: sum.publishMutations + entry.audit.publishMutations,
      blockedMutations: sum.blockedMutations + entry.audit.blockedMutations,
      originViolations: [...sum.originViolations, ...entry.audit.originViolations],
    }), {
      requests: 0,
      forbiddenHosts: new Set(),
      redirects: new Set(),
      failedAssets: 0,
      previewStatuses: [],
      sockets: 0,
      handshakes: 0,
      agentConnectedFrames: 0,
      conversationStateFrames: 0,
      sentSuggestions: 0,
      streamingFrames: 0,
      creationRequests: 0,
      publishMutations: 0,
      blockedMutations: 0,
      originViolations: [],
    });
    assert.equal(combined.forbiddenHosts.size, 0,
      `Browser traffic reached forbidden hosts (${combined.forbiddenHosts.size}); host names are withheld.`);
    assert.equal(combined.redirects.size, 0, "Browser redirected to a forbidden destination.");
    assert.equal(combined.failedAssets, 0, "A browser JS, CSS, or document resource failed to load.");
    assert.equal(combined.creationRequests, 0, "Browser unexpectedly attempted project/agent creation.");
    assert.equal(combined.publishMutations, 0, "Browser unexpectedly attempted a publish mutation.");
    assert.equal(combined.blockedMutations, 0, "An unexpected browser mutation was attempted and aborted.");
    assert.equal(combined.originViolations.length, 0, "A main-frame navigation left the exact HTTPS product origin.");
    if (phase !== "smoke") {
      assert(combined.previewStatuses.some((item) => item.resource === "document" && item.status >= 200 && item.status < 300));
      assert(combined.previewStatuses.some((item) => item.resource === "styles.css" && item.status >= 200 && item.status < 300));
    }
    completion = { results, combined };
  } catch (error) {
    report(`task9-${phase}-failed`, {
      reason: safeError(error),
      doNotRetryMutation: true,
      publicHostnameMutationPerformed: false,
    });
    process.exitCode = 1;
  } finally {
    try {
      await browser?.close();
    } catch (error) {
      report(`task9-${phase}-browser-cleanup-failed`, { reason: safeError(error) });
      process.exitCode = 1;
    }
    try {
      await rm(profile, { recursive: true, force: true });
    } catch (error) {
      report(`task9-${phase}-profile-cleanup-failed`, { reason: safeError(error) });
      process.exitCode = 1;
    }
  }
  if (completion && process.exitCode !== 1) {
    const { results, combined } = completion;
    report(`task9-${phase}-passed`, {
      ...results,
      browserRequests: combined.requests,
      forbiddenHosts: 0,
      failedAssets: 0,
      websocketConnections: combined.sockets,
      websocketHandshakes: combined.handshakes,
      agentConnectedFrames: combined.agentConnectedFrames,
      conversationStateFrames: combined.conversationStateFrames,
      sentSuggestions: combined.sentSuggestions,
      streamingFrames: combined.streamingFrames,
      blockedMutations: combined.blockedMutations,
      profileCleanup: "succeeded",
    });
  }
}

await main();