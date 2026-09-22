export type StagingEnv = {
  ENVIRONMENT?: string;
  STAGING_RUNTIME_URL?: string;
  STAGING_ROUTE_KV_ID?: string;
  STAGING_DISPATCH_NAMESPACE?: string;
  STAGING_ALLOWED_PROJECT_IDS?: string;
  CONTROL_PLANE_ROUTE_KV_ID?: string;
  CONTROL_PLANE_DISPATCH_NAMESPACE?: string;
  VIBESDK_RUNTIME_URL?: string;
};

const PROTECTED_HOSTS = [
  "app.buildcustom.ai",
  "buildcustom.ai",
  "www.buildcustom.ai",
  "fallback.buildcustom.ai",
  "apps.buildcustom.ai",
  "buyermagnets.com",
  "www.buyermagnets.com",
  "app.buyermagnets.com",
];

export function assertStagingEnvironment(env: StagingEnv): void {
  if (env.ENVIRONMENT !== "staging") {
    throw new Error("STAGING_ENVIRONMENT_REQUIRED");
  }
  const runtime = env.STAGING_RUNTIME_URL || env.VIBESDK_RUNTIME_URL || "";
  if (!runtime || !/^https:\/\/buildcustom-vibesdk-migration-staging\.[a-z0-9-]+\.workers\.dev$/i.test(runtime)) {
    throw new Error("STAGING_RUNTIME_URL_REQUIRED");
  }
  if (!env.STAGING_ROUTE_KV_ID || env.STAGING_ROUTE_KV_ID.startsWith("d6e198")) {
    throw new Error("PRODUCTION_ROUTE_KV_REJECTED");
  }
  if (!env.STAGING_DISPATCH_NAMESPACE || /buildcustom-vibesdk-staging|buildcustomai/i.test(env.STAGING_DISPATCH_NAMESPACE)) {
    throw new Error("PRODUCTION_DISPATCH_REJECTED");
  }
  for (const host of PROTECTED_HOSTS) {
    if (runtime.includes(host)) throw new Error("PRODUCTION_RUNTIME_HOST_REJECTED");
  }
}

export function assertControlPlaneEnvironment(env: StagingEnv): void {
  if (env.ENVIRONMENT === "staging") {
    assertStagingEnvironment(env);
    return;
  }
  if (env.ENVIRONMENT !== "production") throw new Error("CONTROL_PLANE_ENVIRONMENT_REQUIRED");
  const runtime = env.VIBESDK_RUNTIME_URL || env.STAGING_RUNTIME_URL || "";
  if (!/^https:\/\/buildcustom-vibesdk-staging\.[a-z0-9-]+\.workers\.dev$/i.test(runtime)) {
    throw new Error("PRODUCTION_RUNTIME_URL_REQUIRED");
  }
  if (env.CONTROL_PLANE_ROUTE_KV_ID !== "d6e19823343e46d3965ad167775afb30") {
    throw new Error("PRODUCTION_ROUTE_KV_REQUIRED");
  }
  if (env.CONTROL_PLANE_DISPATCH_NAMESPACE !== "buildcustom-vibesdk-staging") {
    throw new Error("PRODUCTION_DISPATCH_REQUIRED");
  }
}

export function assertSafeStagingTarget(target: string): void {
  const value = target.trim().toLowerCase();
  if (!value || PROTECTED_HOSTS.some((host) => value === host || value.endsWith(`.${host}`))) {
    throw new Error("PROTECTED_HOST_REJECTED");
  }
  if (value.includes("dns") || value.includes("custom-hostname") || value.includes("cloudflare.com/api")) {
    throw new Error("DOMAIN_MUTATION_REJECTED");
  }
}

export function isImportedProductionAgent(agentId: string | null | undefined): boolean {
  return Boolean(agentId);
}

export function assertMutableAgent(agentId: string | null | undefined, stagingRuntimeUrl: string): void {
  if (!agentId) throw new Error("STAGING_AGENT_REQUIRED");
  assertSafeStagingTarget(stagingRuntimeUrl);
}