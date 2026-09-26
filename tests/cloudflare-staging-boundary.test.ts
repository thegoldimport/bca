import test from "node:test";
import assert from "node:assert/strict";
import { assertControlPlaneEnvironment, assertStagingEnvironment, assertSafeStagingTarget } from "../cloudflare/staging/boundary";
import { assertRuntimeOperationAllowed } from "../cloudflare/staging/runtime-boundary";
import { assertOrigin } from "../cloudflare/staging/auth";
import { controlOriginForRequest } from "../cloudflare/staging/control-origin";
import { customerDeploymentUrl } from "../cloudflare/staging/native-publish";
test("rejects production runtime and protected targets", () => {
  assert.throws(() => assertStagingEnvironment({ ENVIRONMENT: "staging", STAGING_RUNTIME_URL: "https://buildcustom-vibesdk-staging.thegoldimport.workers.dev", STAGING_ROUTE_KV_ID: "new", STAGING_DISPATCH_NAMESPACE: "new" }), /STAGING_RUNTIME_URL_REQUIRED/);
  assert.throws(() => assertSafeStagingTarget("app.buildcustom.ai"), /PROTECTED_HOST_REJECTED/);
});

test("accepts only the reviewed production runtime, route KV, and dispatch namespace", () => {
  assert.doesNotThrow(() => assertControlPlaneEnvironment({
    ENVIRONMENT: "production",
    VIBESDK_RUNTIME_URL: "https://buildcustom-vibesdk-staging.thegoldimport.workers.dev",
    CONTROL_PLANE_ROUTE_KV_ID: "d6e19823343e46d3965ad167775afb30",
    CONTROL_PLANE_DISPATCH_NAMESPACE: "buildcustom-vibesdk-staging",
  }));
  assert.throws(() => assertControlPlaneEnvironment({
    ENVIRONMENT: "production",
    VIBESDK_RUNTIME_URL: "https://buildcustom-vibesdk-migration-staging.thegoldimport.workers.dev",
    CONTROL_PLANE_ROUTE_KV_ID: "d6e19823343e46d3965ad167775afb30",
    CONTROL_PLANE_DISPATCH_NAMESPACE: "buildcustom-vibesdk-staging",
  }), /PRODUCTION_RUNTIME_URL_REQUIRED/);
});

test("launch profile requires exact private services and fail-closed gates", () => {
  const launch = {
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    AUTH_RUNTIME_URL: "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev",
    VIBESDK_RUNTIME_URL: "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev",
    STAGING_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
    CONTROL_PLANE_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
    STAGING_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
    CONTROL_PLANE_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
    STAGING_MANAGED_GATEWAY_URL: "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p",
    STAGING_GATEWAY: {},
    AUTH_RUNTIME: {},
    VIBESDK_RUNTIME: {},
    STAGING_LOGIN_ENABLED: "true",
    STAGING_REGISTRATION_ENABLED: "false",
    PUBLIC_GENERATED_APPS_ENABLED: "false",
    CONTROL_PLANE_ALLOWED_ORIGIN: "https://app.buildcustom.ai",
    STAGING_ALLOWED_ORIGIN: "https://app.buildcustom.ai",
    CONTROL_PLANE_CANARY_ORIGIN: "https://buildcustom-control-plane-launch.thegoldimport.workers.dev",
    RUNTIME_OPERATIONS_ENABLED: "true",
  };
  assert.doesNotThrow(() => assertControlPlaneEnvironment(launch));
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, CONTROL_PLANE_ROUTE_KV_ID: "d6e19823343e46d3965ad167775afb30" }), /LAUNCH_CONTROL_PLANE_CONFIGURATION_REQUIRED/);
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, STAGING_LOGIN_ENABLED: "false" }), /LAUNCH_CONTROL_PLANE_CONFIGURATION_REQUIRED/);
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, ENVIRONMENT: "staging" }), /LAUNCH_CONTROL_PLANE_CONFIGURATION_REQUIRED/);
  assert.doesNotThrow(() => assertControlPlaneEnvironment({ ...launch, STAGING_REGISTRATION_ENABLED: "true" }));
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, STAGING_REGISTRATION_ENABLED: "other" }), /LAUNCH_CONTROL_PLANE_CONFIGURATION_REQUIRED/);
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, CONTROL_PLANE_ALLOWED_ORIGIN: "https://buildcustom.ai" }), /LAUNCH_ORIGIN_CONFIGURATION_REQUIRED/);
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, CONTROL_PLANE_CANARY_ORIGIN: "https://evil.example" }), /LAUNCH_ORIGIN_CONFIGURATION_REQUIRED/);
});
test("public origin and isolated canary accept only their own exact mutation origin", () => {
  const env = {
    CONTROL_PLANE_PROFILE: "launch",
    CONTROL_PLANE_ALLOWED_ORIGIN: "https://app.buildcustom.ai",
    CONTROL_PLANE_CANARY_ORIGIN: "https://buildcustom-control-plane-launch.thegoldimport.workers.dev",
  };
  const publicRequest = (origin: string) => new Request("https://app.buildcustom.ai/api/auth/login", { method: "POST", headers: { Origin: origin } });
  assert.doesNotThrow(() => assertOrigin(publicRequest("https://app.buildcustom.ai"), controlOriginForRequest(env, publicRequest("https://app.buildcustom.ai"))));
  for (const origin of ["https://buildcustom.ai", "https://foo.apps.buildcustom.ai", "https://random.example", env.CONTROL_PLANE_CANARY_ORIGIN]) {
    const request = publicRequest(origin);
    assert.throws(() => assertOrigin(request, controlOriginForRequest(env, request)), /ORIGIN_REJECTED/);
  }
  const canary = new Request(`${env.CONTROL_PLANE_CANARY_ORIGIN}/api/auth/login`, { method: "POST", headers: { Origin: env.CONTROL_PLANE_CANARY_ORIGIN } });
  assert.doesNotThrow(() => assertOrigin(canary, controlOriginForRequest(env, canary)));
  const cross = new Request(canary.url, { method: "POST", headers: { Origin: "https://app.buildcustom.ai" } });
  assert.throws(() => assertOrigin(cross, controlOriginForRequest(env, cross)), /ORIGIN_REJECTED/);
});
test("customer URLs are withheld until the explicit capability is enabled", () => {
  const env = { ENVIRONMENT: "production", CONTROL_PLANE_PROFILE: "launch", PUBLIC_GENERATED_APPS_ENABLED: "false" };
  assert.equal(customerDeploymentUrl(env as any, "stable-slug"), null);
  assert.equal(customerDeploymentUrl({ ...env, PUBLIC_GENERATED_APPS_ENABLED: "true" } as any, "stable-slug"), "https://stable-slug.apps.buildcustom.ai");
  assert.equal(customerDeploymentUrl({ ...env, PUBLIC_GENERATED_APPS_ENABLED: "true" } as any, "invalid/slug"), null);
});
test("imported IDs are read-only", () => {
  assert.throws(() => assertRuntimeOperationAllowed({ agentId: "imported-production-agent", imported: true, runtimeUrl: "https://isolated.staging.workers.dev" }, "build", {}), /IMPORTED_AGENT_READ_ONLY/);
});