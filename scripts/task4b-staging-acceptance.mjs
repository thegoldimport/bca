#!/usr/bin/env node

/**
 * Reuse the actual disposable Task 3 owner through normal staging auth.
 *
 *   node scripts/task4b-staging-acceptance.mjs preflight
 *   node scripts/task4b-staging-acceptance.mjs publish-once
 *   node scripts/task4b-staging-acceptance.mjs verify
 *
 * No account creation, owner reassignment, stock deploy call, prompt, or
 * generation is available here. The publish attempt marker is written BEFORE
 * the single customer-facing POST; an unknown outcome is never retried.
 * Credentials stay in the existing mode-0600 acceptance state and in memory.
 */
import { createHash } from "node:crypto";
import { open, readFile, stat, writeFile } from "node:fs/promises";

const ORIGIN = "https://buildcustom-control-plane-staging.thegoldimport.workers.dev";
const STATE_PATH = "/tmp/buildcustom-task3-acceptance.json";
const ATTEMPT_PATH = "/tmp/buildcustom-task4b-publish-attempt.json";
const RESULT_PATH = "/tmp/buildcustom-task4b-publish-result.json";
const PROJECT_ID = 10;
const AGENT_ID = "758c1390-8c92-457d-bd85-560b2fab3c4b";
const REVISION = "b53e777aa0481108f8d8bcce09de73b23afe0da6";
const SLUG = "northstar-coffee-live";
const PROTOCOL = "immutable-v2";
const PROJECT_PATH = `/api/projects/${PROJECT_ID}`;
const RUNTIME_PATH = `${PROJECT_PATH}/runtime`;
const mode = process.argv[2];

if (!["preflight", "publish-once", "verify"].includes(mode)) {
  console.error("Usage: node scripts/task4b-staging-acceptance.mjs <preflight|publish-once|verify>");
  process.exit(2);
}

const expectedScript = `bc-r-${createHash("sha256")
  .update(`${AGENT_ID}:${REVISION}`).digest("hex").slice(0, 56)}`;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function parseCookies(response, jar) {
  const headers = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  for (const header of headers) {
    const match = header.match(/^\s*(accessToken|csrf-token)=([^;]*)/i);
    if (match) {
      if (match[2]) jar[match[1]] = match[2];
      else delete jar[match[1]];
    }
  }
}

async function request(path, jar, { method = "GET", csrf, body, headers = {}, timeout = 20_000 } = {}) {
  const outgoing = new Headers({ Accept: "application/json", Origin: ORIGIN, ...headers });
  if (Object.keys(jar).length) outgoing.set("Cookie", Object.entries(jar)
    .map(([key, value]) => `${key}=${value}`).join("; "));
  if (csrf) outgoing.set("X-CSRF-Token", csrf);
  if (body !== undefined) outgoing.set("Content-Type", "application/json");
  const response = await fetch(new URL(path, ORIGIN), {
    method,
    headers: outgoing,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
    signal: AbortSignal.timeout(timeout),
  });
  parseCookies(response, jar);
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: response.status, ok: response.ok, data, text };
}

async function requiredGet(path, jar) {
  const result = await request(path, jar);
  requireCondition(result.ok && result.data && typeof result.data === "object",
    `Owner-authenticated GET ${path} failed (HTTP ${result.status}).`);
  return result.data;
}

async function csrfToken(jar) {
  const result = await requiredGet("/api/auth/csrf-token", jar);
  requireCondition(typeof result.token === "string" && result.token.length > 0,
    "The staging authentication service did not issue a CSRF token.");
  return result.token;
}

async function authorizedOwner(savedOwner) {
  let jar = { ...savedOwner.cookieJar };
  let me = await request("/api/auth/me", jar);
  if (me.status === 401 || (me.ok && me.data === null)) {
    // Log in as the SAME existing owner through the normal stock-backed
    // staging login endpoint; do not create a new user or alter ownership.
    requireCondition(typeof savedOwner.email === "string" && typeof savedOwner.password === "string",
      "The existing owner cannot be re-authenticated from protected acceptance state.");
    jar = {};
    const csrf = await csrfToken(jar);
    const login = await request("/api/auth/login", jar, {
      method: "POST", csrf,
      body: { email: savedOwner.email, password: savedOwner.password },
    });
    requireCondition(login.ok, `Existing owner login failed (HTTP ${login.status}).`);
    me = await request("/api/auth/me", jar);
  }
  requireCondition(me.ok && me.data?.id === savedOwner.id,
    `The verified runtime identity did not match the original Project ${PROJECT_ID} owner (HTTP ${me.status}).`);
  return jar;
}

async function preflight(expectPublished = false) {
  const info = await stat(STATE_PATH);
  requireCondition(info.isFile() && (info.mode & 0o777) === 0o600,
    "The existing acceptance state must be a private mode-0600 file.");
  const state = JSON.parse(await readFile(STATE_PATH, "utf8"));
  requireCondition(state.schemaVersion === 1 && state.endpoints?.stagingOrigin === ORIGIN,
    "The saved acceptance state is not for this staging environment.");
  requireCondition(state.projects?.A?.id === PROJECT_ID
    && state.projects.A.agentId === AGENT_ID
    && typeof state.users?.A?.id === "string",
  "The original disposable owner, Project 10, and linked Think agent do not match.");
  const jar = await authorizedOwner(state.users.A);
  const project = await requiredGet(PROJECT_PATH, jar);
  requireCondition(project.id === PROJECT_ID && project.agentId === AGENT_ID,
    "The authenticated owner cannot access the original linked Project 10.");
  const [status, revision, capabilities, settings, releases] = await Promise.all([
    requiredGet(`${RUNTIME_PATH}/status`, jar),
    requiredGet(`${RUNTIME_PATH}/revision`, jar),
    requiredGet(`${RUNTIME_PATH}/publishing-capabilities`, jar),
    requiredGet(`${RUNTIME_PATH}/publishing-settings`, jar),
    requiredGet(`${RUNTIME_PATH}/releases`, jar),
  ]);
  requireCondition(status.state?.generation?.status === "idle",
    "The linked Think runtime is not idle; no Publish request will be sent.");
  requireCondition(revision.commitHash === REVISION,
    "Project 10's authoritative revision changed; no Publish request will be sent.");
  requireCondition(capabilities.buildId === PROTOCOL && capabilities.publishProtocol === PROTOCOL,
    "The staging Worker is not running the expected version-specific Publish implementation.");
  requireCondition(settings.subdomainSlug === SLUG,
    "The existing public slug is not the expected Project 10 slug.");
  requireCondition(Array.isArray(releases.releases)
    && releases.releases.length === (expectPublished ? 2 : 1)
    && releases.releases.some((release) => release.scriptName === "northstar-coffee"
      && release.commitHash === REVISION)
    && (!expectPublished || releases.releases.some((release) => release.scriptName === expectedScript
      && release.commitHash === REVISION))
    && (expectPublished || !releases.releases.some((release) => release.scriptName === expectedScript)),
  "Release history does not match the expected legacy and immutable releases.");
  if (expectPublished) {
    requireCondition(project.deploymentUrl === `https://${SLUG}.lab-apps.buildcustom.ai/`,
      "The public project address changed after publishing.");
  }
  return { jar, summary: {
    owner: "verified original disposable runtime owner",
    projectId: PROJECT_ID,
    agentMatches: true,
    revision: REVISION,
    buildId: capabilities.buildId,
    publicHostname: `${SLUG}.lab-apps.buildcustom.ai`,
    oldScript: "northstar-coffee",
    candidateScript: expectedScript,
    historicalReleaseCount: releases.releases.length,
  } };
}

try {
  if (mode === "preflight" || mode === "verify") {
    console.log(JSON.stringify((await preflight(mode === "verify")).summary, null, 2));
  } else {
    // A prior attempt, including an unknown network outcome, is never retried.
    const { jar, summary } = await preflight();
    const csrf = await csrfToken(jar);
    const file = await open(ATTEMPT_PATH, "wx", 0o600);
    try {
      await file.writeFile(`${JSON.stringify({
        attemptedAt: new Date().toISOString(),
        projectId: PROJECT_ID,
        expectedRevision: REVISION,
        candidateScript: expectedScript,
        endpoint: `${RUNTIME_PATH}/publish-immutable-v2`,
      }, null, 2)}\n`);
    } finally {
      await file.close();
    }
    let result;
    try {
      result = await request(`${RUNTIME_PATH}/publish-immutable-v2`, jar, {
        method: "POST",
        csrf,
        headers: { "X-Publish-Protocol": PROTOCOL },
        body: {},
        timeout: 360_000,
      });
    } catch (error) {
      await writeFile(RESULT_PATH, JSON.stringify({
        transportError: error instanceof Error ? error.name : "unknown",
        message: "Publish outcome is unknown; do not retry.",
      }, null, 2), { mode: 0o600, flag: "wx" });
      throw new Error("The one Publish request had an unknown transport outcome; do not retry.");
    }
    await writeFile(RESULT_PATH, JSON.stringify({
      httpStatus: result.status,
      response: result.data ?? result.text,
    }, null, 2), { mode: 0o600, flag: "wx" });
    console.log(JSON.stringify({
      ...summary,
      publishHttpStatus: result.status,
      resultFile: RESULT_PATH,
      alreadyPublished: result.data?.alreadyPublished,
      releaseScript: result.data?.release?.scriptName,
      note: result.status === 201 ? "One Publish request completed." : "Do not retry. Inspect the protected result file.",
    }, null, 2));
    if (result.status !== 201) process.exitCode = 1;
  }
} catch (error) {
  // Never print raw response bodies, passwords, cookies or tokens.
  console.error(error instanceof Error ? error.message : "Acceptance stopped before Publish.");
  process.exitCode = 1;
}