#!/usr/bin/env node
// Read-only runtime observer. Never deploys, changes traffic, or registers users.
import { spawn, spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTailCorrelation, evaluateCapability } from "./lib/task12n-tail-correlation.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const requireLab = createRequire(path.join(root, "lab/bc-vibesdk-lab-20260925/package.json"));
const wrangler = requireLab.resolve("wrangler/bin/wrangler.js");
const worker = "buildcustom-vibesdk-launch";
const base = "https://api.cloudflare.com/client/v4/accounts/03ef1e6e42498920987f07059e107538";
const url = `https://${worker}.thegoldimport.workers.dev`;
const accepted = "8e28025f-e415-4405-9b1f-67d93eff7fd8";
const candidate = "95da88fe-fe8a-4ce3-9c62-4565d7f279c2";
const phase = process.argv[2] ?? "--expect=closed";
if (!["--expect=closed", "--expect=candidate", "--sample=closed"].includes(phase)
  || process.argv.length > 3) {
  throw new Error("Usage: node scripts/task12n-runtime-capability-probe.mjs --expect=closed|candidate|--sample=closed");
}
const expectedVersion = phase === "--expect=candidate" ? candidate : accepted;
const expectedRegistration = phase === "--expect=candidate";
// UUID-like markers can be redacted in Wrangler tail URLs. Keep this run's
// non-secret marker numeric, as in the accepted control-plane observer.
const id = `${Date.now()}-${process.pid}`;
const artifact = path.join(root, "production/vibesdk-launch",
  `task12n-runtime-observation-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
const report = { at: new Date().toISOString(), mode: `${phase.split("=")[1]}-read-only`,
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
  const correlation = createTailCorrelation({ markerPrefix: `${id}-` });
  let fragment = "", current = "", collecting = false;
  let parseFailures = 0;
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
        correlation.ingest(event);
        collecting = false;
        current = "";
      } catch {
        if (current.length > 262144) { parseFailures++; collecting = false; current = ""; }
      }
    }
  });
  // Tail diagnostics could contain request data, so never print stderr.
  child.stderr.resume();
  const diagnostics = marker => ({ ...correlation.snapshot(marker), parseFailures,
    tailExited: child.exitCode !== null });
  const close = () => { child.kill("SIGTERM"); child.stdin.end(); };
  return { watch: correlation.watch, diagnostics, close };
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
  const marker = `${id}-${label}`;
  const requestUrl = `${url}/api/auth/providers?task12n_observation=${marker}`;
  const headers = { "Cache-Control": "no-store" };
  if (override) headers["Cloudflare-Workers-Version-Overrides"] = `${worker}="${override}"`;
  const observed = observer.watch(requestUrl, 12000);
  const requestedAt = new Date().toISOString();
  const response = await fetch(requestUrl, { headers, cache: "no-store" });
  const raw = await response.text();
  const responseReceivedAt = new Date().toISOString();
  const event = await observed;
  return {
    request: { url: requestUrl, marker, method: "GET", requestedAt, override: override ?? null },
    response: { status: response.status, headers: safeHeaders(response.headers),
      ...safeBody(raw), receivedAt: responseReceivedAt,
      note: "CSRF token redacted before persistence; body otherwise JSON-equivalent" },
    tail: event ? { scriptName: event.scriptName, versionId: event.scriptVersion?.id ?? null,
      eventTimestamp: event.eventTimestamp, requestUrl: event.event?.request?.url } : null,
    correlation: { completedAt: new Date().toISOString(), ...observer.diagnostics(marker) },
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
    if (event?.scriptName === worker && event?.scriptVersion?.id === expectedVersion) {
      calibrated = true; break;
    }
  }
  report.checks.tailCalibrated = calibrated;
  if (phase === "--sample=closed") {
    report.samples = { attempts: [], successful: 0 };
    if (!calibrated) throw new Error("Tail not calibrated; no stability samples issued");
    for (let n = 0; n < 5; n++) {
      const row = await capability(observer, `ordinary-sample-${n}`);
      row.evaluation = evaluateCapability(row, worker, accepted, false);
      report.samples.attempts.push(row);
      if (row.evaluation.http !== "PASS" || row.evaluation.version !== "PASS") break;
      report.samples.successful++;
    }
    report.status = report.samples.successful === report.samples.attempts.length ? "PASS" : "FAIL";
  } else {
  // A version override is supported only when the target is in the current
  // deployment. The exact 100% deployment above is required before this call.
  report.checks.C_targeted = await capability(observer, "targeted", expectedVersion);
  report.checks.D_ordinaryLive = await capability(observer, "ordinary");
  report.checks.C_targeted.evaluation = evaluateCapability(
    report.checks.C_targeted, worker, expectedVersion, expectedRegistration);
  report.checks.D_ordinaryLive.evaluation = evaluateCapability(
    report.checks.D_ordinaryLive, worker, expectedVersion, expectedRegistration);
  report.checks.C_targeted.evidence = observer.diagnostics(`${id}-targeted`);
  report.checks.D_ordinaryLive.evidence = observer.diagnostics(`${id}-ordinary`);
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
  // Future guarded diagnostics consume these independent fields. A deployment
  // readback never substitutes for HTTP behavior or per-request tail identity.
  const field = (expected, observed, pass) => ({
    expected, observed, status: observed === undefined || observed === null
      ? "UNKNOWN" : pass ? "PASS" : "FAIL",
  });
  const c = report.checks.C_targeted, d = report.checks.D_ordinaryLive;
  report.observations = {
    candidatePercentage: field(expectedRegistration ? 100 : 0,
      report.checks.A_deployment.candidatePercentage,
      report.checks.A_deployment.candidatePercentage === (expectedRegistration ? 100 : 0)),
    acceptedPercentage: field(expectedRegistration ? 0 : 100,
      versions.find(v => v.version_id === accepted)?.percentage ?? 0,
      (versions.find(v => v.version_id === accepted)?.percentage ?? 0) === (expectedRegistration ? 0 : 100)),
    candidateRegistrationBinding: field("true", report.checks.B_candidateMetadata.registration,
      report.checks.B_candidateMetadata.registration === "true"),
    candidateEmailAuthBinding: field("not false", report.checks.B_candidateMetadata.emailAuth ?? "absent",
      report.checks.B_candidateMetadata.emailAuth !== "false"),
    targetedHttpStatus: field(200, c.response.status, c.response.status === 200),
    targetedSafeBody: field("redacted JSON", c.response.redactedRawBody, !!c.response.redactedRawBody),
    targetedRegistrationEnabled: field(expectedRegistration, c.response.parsed.registrationEnabled,
      c.response.parsed.registrationEnabled === expectedRegistration),
    targetedEmail: field(true, c.response.parsed.email, c.response.parsed.email === true),
    targetedScriptName: field(worker, c.tail?.scriptName, c.tail?.scriptName === worker),
    targetedVersionId: field(expectedVersion, c.tail?.versionId, c.tail?.versionId === expectedVersion),
    ordinaryHttpStatus: field(200, d.response.status, d.response.status === 200),
    ordinarySafeBody: field("redacted JSON", d.response.redactedRawBody, !!d.response.redactedRawBody),
    ordinaryRegistrationEnabled: field(expectedRegistration, d.response.parsed.registrationEnabled,
      d.response.parsed.registrationEnabled === expectedRegistration),
    ordinaryEmail: field(true, d.response.parsed.email, d.response.parsed.email === true),
    ordinaryScriptName: field(worker, d.tail?.scriptName, d.tail?.scriptName === worker),
    ordinaryVersionId: field(expectedVersion, d.tail?.versionId, d.tail?.versionId === expectedVersion),
    existingUserAuth: field("PASS", report.checks.E_existingUserAuth?.status,
      report.checks.E_existingUserAuth?.status === "PASS"),
  };
  const capabilityPass = [report.checks.C_targeted, report.checks.D_ordinaryLive]
    .every(row => row.evaluation.http === "PASS" && row.evaluation.version === "PASS");
  report.status = calibrated && capabilityPass && auth.status === 0
    && report.checks.E_existingUserAuth?.status === "PASS" ? "PASS" : "FAIL";
  }
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