#!/usr/bin/env node
// Read-only runtime observer. Never deploys, changes traffic, or registers users.
import { randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLab = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"));
const wrangler = requireLab.resolve("wrangler/bin/wrangler.js");
const worker = "buildcustom-vibesdk-launch";
const base = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const url = `https://${worker}.thegoldimport.workers.dev`;
const accepted = "8e28025f-e415-4405-9b1f-67d93eff7fd8";
const candidate = "95da88fe-fe8a-4ce3-9c62-4565d7f279c2";
const phase = process.argv[2] ?? "--expect=closed";
if (!["--expect=closed", "--expect=candidate"].includes(phase) || process.argv.length > 3) {
  throw new Error("Usage: node scripts/task12n-runtime-capability-probe.mjs --expect=closed|candidate");
}
const expectedVersion = phase === "--expect=closed" ? accepted : candidate;
const expectedRegistration = phase === "--expect=candidate";
const id = `${Date.now()}-${randomUUID().slice(0, 7)}`;
const artifact = path.join(root, "production/vibesdk-launch",
  `task12n-runtime-observation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { at: new Date().toISOString(), mode: `${phase.slice(9)}-read-only`,
  expectedVersion, status: "FAIL", checks: {} };
if (!process.env.CLOUDFLARE_API_TOKEN) throw new Error("Cloudflare read credential unavailable");

async function cfGet(pathname) {
  const response = await fetch(base + pathname, {
    headers: { Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}` }, cache: "no-store",
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare GET failed: HTTP ${response.status}`);
  return body.result;
}
function binding(version, name) {
  return version.resources?.bindings?.find(b => b.name === name)?.text ?? null;
}
function safeHeaders(headers) {
  return Object.fromEntries([...headers].map(([key, value]) =>
    [key, /cookie|authorization|secret|token|report-to/i.test(key) ? "[redacted]" : value]));
}
function tail() {
  const child = spawn(process.execPath, [wrangler, "tail", worker, "--format=json",
    "--config", path.join(root, "wrangler.product-launch.jsonc")],
    { cwd: root, env: { ...process.env, NO_COLOR: "1" }, stdio: ["pipe", "pipe", "pipe"] });
  const pending = new Map();
  let fragment = "", current = "", collecting = false;
  child.stdout.on("data", data => {
    fragment += data.toString();
    const lines = fragment.split("\n");
    fragment = lines.pop();
    for (const line of lines) {
      if (!collecting && line.trim() === "{") { collecting = true; current = line; continue; }
      if (!collecting) continue;
      current += `\n${line}`;
      try {
        const event = JSON.parse(current);
        const expected = pending.get(event.event?.request?.url);
        if (expected && event.scriptName === worker) expected(event);
        collecting = false;
        current = "";
      } catch {
        if (current.length > 262144) { collecting = false; current = ""; }
      }
    }
  });
  // Tail diagnostics could contain request data, so never print stderr.
  child.stderr.resume();
  const watch = (requestUrl, ms = 8000) => new Promise(resolve => {
    const timer = setTimeout(() => { pending.delete(requestUrl); resolve(null); }, ms);
    pending.set(requestUrl, event => {
      clearTimeout(timer);
      pending.delete(requestUrl);
      resolve(event);
    });
  });
  const close = () => { child.kill("SIGTERM"); child.stdin.end(); };
  return { watch, close };
}
function safeBody(raw) {
  if (raw.length > 16384) throw new Error("Oversized capability response");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object") throw new Error("Unexpected capability body");
  const copy = structuredClone(parsed);
  if (copy.data && typeof copy.data === "object") {
    if ("csrfToken" in copy.data) copy.data.csrfToken = "[redacted]";
  }
  // Preserve all other JSON fields, including errors. Do not persist live CSRF tokens.
  return { redactedRawBody: JSON.stringify(copy),
    parsed: { success: parsed.success, registrationEnabled: parsed.data?.registrationEnabled,
      email: parsed.data?.providers?.email, hasOAuth: parsed.data?.hasOAuth,
      requiresEmailAuth: parsed.data?.requiresEmailAuth } };
}
async function capability(observer, label, override) {
  const requestUrl = `${url}/api/auth/providers?task12n_observation=${id}-${label}`;
  const headers = { "Cache-Control": "no-store" };
  if (override) headers["Cloudflare-Workers-Version-Overrides"] = `${worker}="${override}"`;
  const observed = observer.watch(requestUrl);
  const requestedAt = new Date().toISOString();
  const response = await fetch(requestUrl, { headers, cache: "no-store" });
  const raw = await response.text();
  const event = await observed;
  return {
    request: { url: requestUrl, method: "GET", requestedAt, override: override ?? null },
    response: { status: response.status, headers: safeHeaders(response.headers),
      ...safeBody(raw), note: "CSRF token redacted before persistence; body otherwise JSON-equivalent" },
    tail: event ? { scriptName: event.scriptName, versionId: event.scriptVersion?.id ?? null,
      eventTimestamp: event.eventTimestamp, requestUrl: event.event?.request?.url } : null,
  };
}
let observer;
try {
  const [deployment, target, closed] = await Promise.all([
    cfGet(`/workers/scripts/${worker}/deployments`),
    cfGet(`/workers/scripts/${worker}/versions/${candidate}`),
    cfGet(`/workers/scripts/${worker}/versions/${accepted}`),
  ]);
  const versions = deployment.deployments?.[0]?.versions ?? [];
  report.checks.A_deployment = { id: deployment.deployments?.[0]?.id, versions,
    expected: versions.length === 1 && versions[0].version_id === expectedVersion && versions[0].percentage === 100,
    candidatePercentage: versions.find(v => v.version_id === candidate)?.percentage ?? 0 };
  report.checks.B_candidateMetadata = { id: candidate, hasPreview: target.metadata?.has_preview,
    registration: binding(target, "REGISTRATION_ENABLED"),
    emailAuth: binding(target, "ENABLE_EMAIL_AUTH"),
    acceptedRegistration: binding(closed, "REGISTRATION_ENABLED"),
    container: target.resources?.script_runtime?.containers };
  if (!report.checks.A_deployment.expected) {
    throw new Error("Expected version not currently serving at 100%; no probes issued");
  }
  observer = tail();
  let calibrated = false;
  for (let n = 0; n < 15; n++) {
    const calibrationUrl = `${url}/api/auth/providers?task12n_observation=${id}-calibration-${n}`;
    const matched = observer.watch(calibrationUrl, 1500);
    await fetch(calibrationUrl, { cache: "no-store" }).catch(() => undefined);
    const event = await matched;
    if (event?.scriptVersion?.id) { calibrated = true; break; }
  }
  report.checks.tailCalibrated = calibrated;
  // A version override is supported only when the target is in the current
  // deployment. The exact 100% deployment above is required before this call.
  report.checks.C_targeted = await capability(observer, "targeted", expectedVersion);
  report.checks.D_ordinaryLive = await capability(observer, "ordinary");
  observer.close();
  observer = null;
  const auth = spawnSync(process.execPath, [path.join(root, "scripts/task12g-runtime-cutover-probe.mjs"),
    expectedRegistration ? "--phase=candidate" : "--phase=closed"], {
    cwd: root, encoding: "utf8", timeout: 90000, maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, TASK12M_RUNTIME_CANDIDATE: candidate },
  });
  const rows = auth.stdout?.split("\n").map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean) ?? [];
  report.checks.E_existingUserAuth = rows.find(row => row.check === "E: existing-user product and runtime authentication");
  const capabilityPass = [report.checks.C_targeted, report.checks.D_ordinaryLive]
    .every(row => row.response.status === 200
      && row.response.parsed.registrationEnabled === expectedRegistration
      && row.response.parsed.email === true
      && row.tail?.scriptName === worker && row.tail.versionId === expectedVersion);
  report.status = calibrated && capabilityPass && auth.status === 0
    && report.checks.E_existingUserAuth?.status === "PASS" ? "PASS" : "FAIL";
} catch (error) {
  report.error = error.message;
} finally {
  observer?.close();
  report.completedAt = new Date().toISOString();
  await writeFile(artifact, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(JSON.stringify({ artifact: path.relative(root, artifact), status: report.status,
    versions: [report.checks.C_targeted?.tail?.versionId ?? null,
      report.checks.D_ordinaryLive?.tail?.versionId ?? null], error: report.error }));
  if (report.status !== "PASS") process.exitCode = 1;
}