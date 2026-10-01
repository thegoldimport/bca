#!/usr/bin/env node
// One disposable production fixture. Reserved writes are never repeated.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import WebSocket from "ws";

const app = "https://app.buildcustom.ai";
const account = "03ef1e6e42498920987f07059e107538";
const root = `https://api.cloudflare.com/client/v4/accounts/${account}`;
const checkpoint = "production/vibesdk-launch/continuous-coding-fixture.json";
const sessionFile = "/tmp/buildcustom-continuation-fixture-session.json";
const action = process.argv[2];
assert(["setup", "schema", "run", "observe", "evidence"].includes(action));
const cookies = new Map();
let csrf, report;
try { report = JSON.parse(await readFile(checkpoint, "utf8")); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (action !== "setup") {
  assert(report, "No fixture checkpoint");
  const session = JSON.parse(await readFile(sessionFile, "utf8"));
  for (const pair of session.cookies) cookies.set(...pair);
  csrf = session.csrf;
}
const digest = data => createHash("sha256").update(data).digest("hex");
const cookie = () => [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
function sanitized(value, key = "") {
  if (/secret|token|password|authorization|cookie|reasoning/i.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (/previewurl|preview_url/i.test(key)) return { sha256: digest(value) };
    return value.replace(/([?&](?:token|ticket|key|auth)=)[^&\s"']+/gi, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map(item => sanitized(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitized(v, k)]));
  }
  return value;
}
async function save() {
  await writeFile(checkpoint, `${JSON.stringify(sanitized(report), null, 2)}\n`, { mode: 0o600 });
  await writeFile(sessionFile, JSON.stringify({ cookies: [...cookies], csrf }), { mode: 0o600 });
}
async function request(uri, { method = "GET", body, headers = {} } = {}) {
  assert(!/^\/api\/projects\/5(?:\/|$)/.test(uri));
  const response = await fetch(app + uri, {
    method, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(60000),
    headers: {
      Cookie: cookie(), Origin: app, ...headers,
      ...(body === undefined ? {} : { "Content-Type": "application/json", "X-CSRF-Token": csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  for (const value of response.headers.getSetCookie()) {
    const pair = value.split(";")[0], equals = pair.indexOf("=");
    cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
  }
  const text = await response.text();
  let json; try { json = JSON.parse(text); } catch { /* Non-JSON is explicitly represented below. */ }
  return { status: response.status, json, text };
}
async function refreshCsrf() {
  const response = await request("/api/auth/csrf-token");
  assert.equal(response.status, 200);
  csrf = response.json.token;
  assert(csrf);
}
async function cf(uri, body) {
  const response = await fetch(root + uri, {
    method: body ? "POST" : "GET", signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
      ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const json = await response.json();
  assert(response.ok && json.success,
    `Cloudflare read HTTP ${response.status}; codes ${(json.errors ?? []).map(e => e.code).join(",")}`);
  return json.result;
}
async function sql(namespace, queries) {
  assert(queries.every(query => /^SELECT\b/i.test(query.sql)));
  const result = await cf(`/workers/durable_objects/namespaces/${namespace}/query/v2`, {
    durable_object_name: report.agentId, jurisdiction: "none", queries,
  });
  assert(!result.error, `Durable Object SQL rejected: ${result.error}`);
  assert(result.results.every(item => item.meta.rows_written === 0), "SQL query was not read-only");
  return result;
}
function rows(result, index) {
  if (result.results.length === 0) return [];
  const cursor = result.results[index];
  return cursor.rows.map(row => Object.fromEntries(cursor.columns.map((column, i) => [column, row[i]])));
}
async function readRuntime(kind) {
  const result = await request(`/api/projects/${report.projectId}/runtime/${kind}`);
  assert.equal(result.status, 200, `Fixture read ${kind} failed`);
  return result.json;
}
async function identifyAgent() {
  const project = await request(`/api/projects/${report.projectId}`);
  assert.equal(project.status, 200);
  assert.equal(Number(project.json.id), report.projectId);
  const linked = await cf("/d1/database/ca820baf-6973-4318-ac52-529d56293bb6/query", {
    sql: "SELECT p.user_id, l.agent_id, p.status, l.initialization_status FROM projects p JOIN runtime_project_links l ON l.project_id=p.id WHERE p.id=? AND p.user_id=?",
    params: [report.projectId, report.ownerId],
  });
  const row = linked[0].results[0];
  assert(row, "Owner-bound fixture link not found");
  if (row.status !== "ready" || row.initialization_status !== "ready") {
    assert(!["failed", "blocked"].includes(row.initialization_status), "Fixture initialization failed");
    return false;
  }
  assert(row.agent_id);
  report.agentId = row.agent_id;
  return true;
}
if (action === "setup") {
  assert(!report, "Fixture already reserved; do not repeat setup.");
  assert(process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD, "Acceptance password unavailable");
  assert.equal(JSON.parse(await readFile("production/vibesdk-launch/continuous-coding-smoke-after.json", "utf8")).status, "PASS");
  report = {
    startedAt: new Date().toISOString(), state: "REGISTRATION_RESERVED",
    requestKey: `continuation-fixture-${randomUUID()}`, customerRequestsSent: 0,
    productionPublishRequests: 0, project5Touched: false,
  };
  await save();
  await refreshCsrf();
  const registered = await request("/api/auth/register", {
    method: "POST", body: {
      name: "Continuous coding acceptance",
      email: `continuation-fixture-${report.requestKey.slice(-12)}@buildcustom.ai`,
      password: process.env.BUILDCUSTOM_NEW_USER_ACCEPTANCE_PASSWORD,
    },
  });
  assert.equal(registered.status, 200, "Single fixture registration did not succeed");
  report.state = "REGISTERED";
  await save();
  const identity = await request("/api/auth/me");
  assert.equal(identity.status, 200);
  assert(identity.json?.id);
  assert.equal(typeof identity.json.id, "string");
  report.ownerId = identity.json.id;
  report.state = "PROJECT_CREATION_RESERVED";
  await refreshCsrf();
  await save();
  const project = await request("/api/projects", {
    method: "POST", headers: { "Idempotency-Key": report.requestKey },
    body: {
      name: "Isolated continuous coding acceptance",
      description: "Disposable preview-only continuation fixture; never Publish",
      type: "website", framework: "react",
    },
  });
  assert([200, 201, 202].includes(project.status));
  const id = project.json?.id ?? project.json?.project?.id;
  assert(id && Number(id) !== 5);
  report.projectId = Number(id);
  report.state = "PROJECT_CREATED";
  await save();
  let ready = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    ready = await identifyAgent();
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 3000));
  }
  assert(ready, "Fixture initialization pending; reconcile read-only, never recreate");
  report.baselineRevision = await readRuntime("revision");
  report.state = "READY_WITHOUT_GENERATION";
  await save();
  console.log(JSON.stringify({ state: report.state, ownerId: report.ownerId,
    projectId: report.projectId, agentId: report.agentId, revision: report.baselineRevision }));
} else if (action === "schema") {
  assert(report.agentId);
  const query = { sql: "SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name" };
  const [think, space] = await Promise.all([
    sql("5d1e8716e75e4e1884458127f83c7f1c", [query]),
    sql("bd1438931f1e489b89439e66b385837e", [query]),
  ]);
  report.storageSchema = { think, space };
  await save();
  console.log(JSON.stringify(report.storageSchema));
} else if (action === "observe") {
  assert(await identifyAgent());
  const [status, revision, turns] = await Promise.all([
    readRuntime("status"), readRuntime("revision"), readRuntime("turns"),
  ]);
  report.observed = { at: new Date().toISOString(), status, revision, turns };
  await save();
  console.log(JSON.stringify({ state: report.state, status: sanitized(status), revision, turnsShape: Object.keys(turns ?? {}) }));
} else if (action === "evidence") {
  const think = await sql("5d1e8716e75e4e1884458127f83c7f1c", [
    { sql: "SELECT id,role,created_at,length(content) AS bytes,CASE WHEN role='user' AND instr(content,'__THINK_INTERNAL_CONTINUATION__:')>0 THEN 1 ELSE 0 END AS internal_continuation FROM assistant_messages ORDER BY created_at,id" },
  ]);
  const space = await sql("bd1438931f1e489b89439e66b385837e", [
    { sql: "SELECT path,content_encoding,content FROM cf_workspace_default WHERE type='file' AND (path LIKE '%/public/%' OR path LIKE '%/src/%' OR path LIKE 'public/%' OR path LIKE 'src/%' OR path LIKE '%.git/HEAD' OR path LIKE '%.git/refs/heads/%') ORDER BY path" },
  ]);
  const deployments = await sql("bd1438931f1e489b89439e66b385837e", [
    { sql: "SELECT branch,commit_hash,deployed_at FROM deployments" },
  ]);
  const files = rows(space, 0).map(row => {
    const content = row.content_encoding === "base64"
      ? Buffer.from(row.content ?? "", "base64") : Buffer.from(row.content ?? "");
    const git = row.path.includes(".git/");
    return { path: row.path, sha256: digest(content),
      ...(git ? { ref: content.toString("utf8").trim() } : {}) };
  });
  const sample = {
    at: new Date().toISOString(), messageMetadata: rows(think, 0),
    files, deployments: rows(deployments, 0), rowsWritten: 0,
    lifecycleKv: "Protected by Cloudflare SQL authorizer; use verified finish_task customer-path output.",
  };
  await appendFile("production/vibesdk-launch/continuous-coding-fixture-evidence.jsonl",
    `${JSON.stringify(sanitized(sample))}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ state: report.state, sample: sanitized(sample) }));
} else {
  assert.equal(report.state, "READY_WITHOUT_GENERATION");
  assert.equal(report.customerRequestsSent, 0);
  const prompt = [
    "Build a modest, complete static contact-directory demo in the current initialized app.",
    "Inspect the existing files and configuration first. This is ONE preview-only customer coding operation.",
    "Use plain HTML/CSS/ES modules and no external services, database changes, credentials or production Publish.",
    "Provide a responsive dark-navy contact dashboard with 24 clearly labeled synthetic demo contacts.",
    "Implement search by name/company/email, status filters, sortable columns, 6-row pagination, and a read-only contact-detail dialog.",
    "Make the filters work together, reset pagination when filtering, preserve the query/filter/sort state in the URL, and support browser back/forward.",
    "Include a recent-contacts panel containing exactly the five newest IDs, plus accurate counts and a filtered-empty state.",
    "Keep the directory state/data, filtering/sorting, table rendering, dialog, URL state and app wiring in small separate ES modules.",
    "Add a Node-executable deterministic test script covering combined filters, case-insensitive search, sorting, pagination boundaries, newest-five and URL round-trips.",
    "Use semantic labels, keyboard dialog dismissal/focus return, readable contrast and a mobile layout.",
    "Retain valid Worker/assets configuration. No packages or external image/font/CDN dependencies are needed.",
    "After implementation, run the deterministic tests and working-tree preflight before creating a coherent revision.",
    "Deploy only the preview, and use browser/runtime verification to actually exercise search, status filter, pagination, detail dialog, browser history, recent-five and mobile layout.",
    "If any verification fails, repair it in this SAME operation. Call finish_task only after verified completion and a clean working tree.",
    "Do not create a production release or invoke production Publish.",
  ].join("\n");
  const socket = new WebSocket(`wss://app.buildcustom.ai/api/projects/${report.projectId}/runtime/ws`, {
    headers: { Origin: app, Cookie: cookie() },
  });
  report.promptSha256 = digest(prompt);
  report.frames = [];
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("Fixture observation deadline")); }, 960000);
    let sent = false;
    socket.on("error", reject);
    socket.on("message", async bytes => {
      try {
        const frame = JSON.parse(bytes.toString());
        if (frame.type === "agent_connected" && !sent) {
          assert(frame.state, "Native connected state absent");
          sent = true;
          report.state = "CODING_REQUEST_RESERVED";
          await save();
          socket.send(JSON.stringify({ type: "user_suggestion", message: prompt }));
          report.customerRequestsSent = 1;
          report.state = "CODING_REQUEST_SENT";
          report.codingStartedAt = new Date().toISOString();
          await save();
          console.log(JSON.stringify({ state: report.state, projectId: report.projectId, agentId: report.agentId }));
        }
        // Persist owner-visible native frames only. Never output model prose/reasoning.
        report.frames.push({ at: new Date().toISOString(), frame });
        if (["generation_complete", "generation_stopped", "error"].includes(frame.type)) {
          report.state = "TERMINAL_FRAME_OBSERVED";
          report.terminalFrame = frame.type;
          await save();
          clearTimeout(timer); socket.close(); resolve();
        } else if (report.frames.length % 10 === 0) await save();
      } catch (error) { clearTimeout(timer); socket.close(); reject(error); }
    });
    socket.on("close", () => {
      if (report.state !== "TERMINAL_FRAME_OBSERVED") {
        clearTimeout(timer); reject(new Error("Socket closed; reconcile read-only, never resend."));
      }
    });
  });
  await save();
  console.log(JSON.stringify({ state: report.state, terminalFrame: report.terminalFrame, frames: report.frames.length }));
}