#!/usr/bin/env node
// Anonymous, read-only smoke for the active observability release.
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const app = "https://app.buildcustom.ai";
const runtime = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const output = "production/vibesdk-launch/observability-smoke.json";
const report = { startedAt: new Date().toISOString(), status: "RUNNING", checks: {} };
let phase = "startup";

async function get(url) {
  return fetch(url, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
    signal: AbortSignal.timeout(30000),
  });
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function save() {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await chmod(output, 0o600);
}

try {
  phase = "runtime-health";
  const healthResponse = await get(`${runtime}/api/health`);
  const health = await json(healthResponse);
  report.checks.runtimeHealth = {
    httpStatus: healthResponse.status,
    status: health?.status === "ok" ? "PASS" : "FAIL",
  };
  if (healthResponse.status !== 200 || health?.status !== "ok") throw new Error();

  phase = "public-capabilities";
  const capabilitiesResponse = await get(`${app}/api/public/capabilities`);
  const capabilities = await json(capabilitiesResponse);
  const capabilitiesPass = capabilitiesResponse.status === 200
    && capabilities?.registrationEnabled === true
    && capabilities?.publicGeneratedAppsEnabled === true;
  report.checks.publicCapabilities = {
    httpStatus: capabilitiesResponse.status,
    registrationEnabled: capabilities?.registrationEnabled === true,
    publicGeneratedAppsEnabled: capabilities?.publicGeneratedAppsEnabled === true,
    status: capabilitiesPass ? "PASS" : "FAIL",
  };
  if (!capabilitiesPass) throw new Error();

  phase = "runtime-auth-providers";
  const providersResponse = await get(`${runtime}/api/auth/providers`);
  const providers = await json(providersResponse);
  const registrationEnabled = providers?.data?.registrationEnabled === true;
  report.checks.runtimeAuthProviders = {
    httpStatus: providersResponse.status,
    registrationEnabled,
    status: providersResponse.status === 200 && registrationEnabled ? "PASS" : "FAIL",
  };
  if (providersResponse.status !== 200 || !registrationEnabled) throw new Error();

  phase = "anonymous-identity";
  const identityResponse = await get(`${app}/api/auth/me`);
  const identity = await json(identityResponse);
  const anonymous = identityResponse.status === 401
    || (identityResponse.status === 200 && identity === null);
  report.checks.anonymousIdentity = {
    httpStatus: identityResponse.status,
    anonymous,
    status: anonymous ? "PASS" : "FAIL",
  };
  if (!anonymous) throw new Error();

  phase = "anonymous-ownership-gate";
  // This deliberately impossible ID is not obtained from a project listing or fixture.
  const ownershipResponse = await get(`${app}/api/projects/2147483647`);
  const ownershipBlocked = [401, 404].includes(ownershipResponse.status);
  report.checks.anonymousOwnershipGate = {
    httpStatus: ownershipResponse.status,
    projectIdWasImpossibleProbe: true,
    status: ownershipBlocked ? "PASS" : "FAIL",
  };
  if (!ownershipBlocked) throw new Error();

  report.status = "PASS";
} catch {
  report.status = "FAIL";
  report.failure = { phase };
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await save();
  console.log(JSON.stringify(report));
}