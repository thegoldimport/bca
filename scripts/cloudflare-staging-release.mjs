import { appendFileSync, readFileSync } from "node:fs";

const WORKER = "buildcustom-control-plane-staging";
const PROD_WORKER = "buildcustom-control-plane-launch";
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const API_BASE = "https://api.cloudflare.com/client/v4";
const HEALTH_URL = "https://buildcustom-control-plane-staging.thegoldimport.workers.dev/";

function assertStagingConfig() {
  const config = readFileSync("wrangler.staging.jsonc", "utf8");
  const required = [
    ['staging Worker name', /"name"\s*:\s*"buildcustom-control-plane-staging"/],
    ['Worker entry point', /"main"\s*:\s*"cloudflare\/worker\.ts"/],
    ['workers.dev enabled', /"workers_dev"\s*:\s*true/],
    ['staging environment', /"ENVIRONMENT"\s*:\s*"staging"/],
    ['staging D1 ID', /"database_id"\s*:\s*"6a0ee5f4-9077-4ccf-a585-a2afb3daf734"/],
    ['staging routes KV ID', /"id"\s*:\s*"e5e119fa2abc4c26a8c027e0d8a8d82c"/],
    ['staging VibeSDK service', /"service"\s*:\s*"buildcustom-vibesdk-migration-staging"/],
    ['staging gateway service', /"service"\s*:\s*"buildcustom-apps-gateway-staging"/],
  ];
  for (const [label, pattern] of required) {
    if (!pattern.test(config)) throw new Error(`Staging config guard failed: ${label} is missing.`);
  }

  const forbidden = [
    "buildcustom-control-plane-launch",
    "buildcustom-control-plane-production",
    "buildcustom-vibesdk-launch",
    "buildcustom-apps-gateway-launch",
    "buildcustom-product-launch-db",
    "buildcustom-vibesdk-launch-dispatch",
    "ca820baf-6973-4318-ac52-529d56293bb6",
    "716c6600-8c60-408a-9446-3779979d5316",
    "248ac5b6821a475794a7fe3d2b0c3718",
  ];
  if (forbidden.some((value) => config.includes(value))) {
    throw new Error("Staging config guard failed: a production resource is referenced.");
  }
  if (/"routes"\s*:|\"custom_domain\"\s*:/.test(config)) {
    throw new Error("Staging config guard failed: route or custom-domain changes are not allowed.");
  }
  console.log("Staging Worker configuration guard passed.");
}

function requireCredentials() {
  if (!ACCOUNT_ID || !/^[a-f0-9]{32}$/i.test(ACCOUNT_ID)) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID is missing or malformed.");
  }
  if (!API_TOKEN) throw new Error("The staging environment secret CLOUDFLARE_STAGING_API_TOKEN is required.");
}

async function cloudflare(path) {
  requireCredentials();
  return fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${API_TOKEN}`, Accept: "application/json" },
  });
}

async function readPayload(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function isGranted(response, payload) {
  return response.status >= 200 && response.status < 300 && payload.success === true;
}

async function verifyTokenScope() {
  requireCredentials();
  const verifyResponse = await cloudflare(`/accounts/${ACCOUNT_ID}/tokens/verify`);
  const verify = await readPayload(verifyResponse);
  if (!isGranted(verifyResponse, verify) || verify.result?.status !== "active") {
    throw new Error(`Staging Cloudflare token verification failed (HTTP ${verifyResponse.status}).`);
  }

  const probes = [
    {
      name: "the staging control-plane Worker",
      path: `/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}/settings`,
      shouldGrant: true,
    },
    {
      name: "the production control-plane Worker",
      path: `/accounts/${ACCOUNT_ID}/workers/scripts/${PROD_WORKER}/settings`,
      shouldGrant: false,
    },
    { name: "Pages projects", path: `/accounts/${ACCOUNT_ID}/pages/projects`, shouldGrant: false },
    { name: "D1 databases", path: `/accounts/${ACCOUNT_ID}/d1/database`, shouldGrant: false },
    { name: "Workers KV namespaces", path: `/accounts/${ACCOUNT_ID}/storage/kv/namespaces`, shouldGrant: false },
    { name: "R2 buckets", path: `/accounts/${ACCOUNT_ID}/r2/buckets`, shouldGrant: false },
    { name: "Cloudflare account API tokens", path: `/accounts/${ACCOUNT_ID}/tokens`, shouldGrant: false },
  ];

  for (const probe of probes) {
    const response = await cloudflare(probe.path);
    const payload = await readPayload(response);
    const granted = isGranted(response, payload);
    if (probe.shouldGrant && !granted) {
      throw new Error(`Staging token cannot read ${probe.name} (HTTP ${response.status}).`);
    }
    if (!probe.shouldGrant && granted) {
      throw new Error(`Staging token has unexpected access to ${probe.name}.`);
    }
    if (!probe.shouldGrant && !granted && ![401, 403, 404].includes(response.status)) {
      throw new Error(`Scope probe for ${probe.name} returned unexpected HTTP ${response.status}.`);
    }
  }
  console.log("Staging token scope probes passed: target Worker allowed; production and unrelated resources denied.");
}

async function getDeployments() {
  const response = await cloudflare(`/accounts/${ACCOUNT_ID}/workers/scripts/${WORKER}/deployments`);
  const payload = await readPayload(response);
  if (!isGranted(response, payload)) {
    throw new Error(`Could not read staging Worker deployment history (HTTP ${response.status}).`);
  }
  const deployments = Array.isArray(payload.result) ? payload.result : payload.result?.deployments;
  if (!Array.isArray(deployments)) throw new Error("Cloudflare returned an invalid deployment-history response.");
  return deployments;
}

function versionsIn(deployments) {
  return deployments.flatMap((deployment) =>
    (deployment.versions || []).map((version) => ({
      deploymentId: deployment.id,
      deploymentCreated: deployment.created_on,
      versionId: version.version_id || version.id,
      percentage: version.percentage,
    })),
  );
}

async function assertRollbackVersion() {
  requireCredentials();
  const versionId = process.env.ROLLBACK_VERSION_ID || "";
  if (!/^[a-f0-9-]{36}$/i.test(versionId)) {
    throw new Error("Enter a valid Cloudflare Worker version ID for the rollback.");
  }
  const deployments = await getDeployments();
  const versions = versionsIn(deployments);
  const current = versions.find((version) => version.percentage === 100)?.versionId;
  if (!versions.some((version) => version.versionId === versionId)) {
    throw new Error("The requested rollback version is not in this Worker’s deployment history.");
  }
  if (current === versionId) throw new Error("The requested version is already active.");
  console.log(`Rollback target exists in staging Worker history: ${versionId}`);
}

async function recordDeployment() {
  requireCredentials();
  const deployments = await getDeployments();
  const current = deployments[0];
  const active = current?.versions?.find((version) => version.percentage === 100) || current?.versions?.[0];
  const versionId = active?.version_id || active?.id;
  if (!current?.id || !versionId) throw new Error("Could not identify the active staging deployment and version.");
  const commit = process.env.GITHUB_SHA || "unknown";
  const operation = process.env.OPERATION || "deployment";
  const summary =
    `### Staging control-plane ${operation}\n\n` +
    `- Commit: \`${commit}\`\n` +
    `- Worker: \`${WORKER}\`\n` +
    `- Deployment: \`${current.id}\`\n` +
    `- Active version: \`${versionId}\`\n` +
    `- Created: \`${current.created_on || "not reported"}\`\n`;
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(`Staging deployment recorded: worker=${WORKER}, deployment=${current.id}, version=${versionId}, commit=${commit}`);
}

async function checkHealth() {
  let lastStatus = "no response";
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const response = await fetch(HEALTH_URL, { method: "GET", redirect: "manual" });
      lastStatus = String(response.status);
      const html = (response.headers.get("content-type") || "").includes("text/html");
      await response.body?.cancel();
      if (response.status === 200 && html) {
        console.log(`Staging health check passed: HTTP ${response.status}, text/html.`);
        return;
      }
    } catch {
      lastStatus = "network error";
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  throw new Error(`Staging health check failed after 12 safe GET attempts (last result: ${lastStatus}).`);
}

const command = process.argv[2];
try {
  if (command === "assert-config") assertStagingConfig();
  else if (command === "scope-check") await verifyTokenScope();
  else if (command === "assert-rollback-version") await assertRollbackVersion();
  else if (command === "record") await recordDeployment();
  else if (command === "health") await checkHealth();
  else throw new Error("Use assert-config, scope-check, assert-rollback-version, record, or health.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Staging release validation failed.");
  process.exitCode = 1;
}
