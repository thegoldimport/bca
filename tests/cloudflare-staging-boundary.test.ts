import test from "node:test";
import assert from "node:assert/strict";
import { assertControlPlaneEnvironment, assertStagingEnvironment, assertSafeStagingTarget } from "../cloudflare/staging/boundary";
import { assertRuntimeOperationAllowed } from "../cloudflare/staging/runtime-boundary";
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
    STAGING_REGISTRATION_ENABLED: "true",
    RUNTIME_OPERATIONS_ENABLED: "true",
  };
  assert.doesNotThrow(() => assertControlPlaneEnvironment(launch));
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, CONTROL_PLANE_ROUTE_KV_ID: "d6e19823343e46d3965ad167775afb30" }), /LAUNCH_CONTROL_PLANE_CONFIGURATION_REQUIRED/);
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, STAGING_LOGIN_ENABLED: "false" }), /LAUNCH_CONTROL_PLANE_CONFIGURATION_REQUIRED/);
  assert.throws(() => assertControlPlaneEnvironment({ ...launch, ENVIRONMENT: "staging" }), /LAUNCH_CONTROL_PLANE_CONFIGURATION_REQUIRED/);
});
test("imported IDs are read-only", () => {
  assert.throws(() => assertRuntimeOperationAllowed({ agentId: "imported-production-agent", imported: true, runtimeUrl: "https://isolated.staging.workers.dev" }, "build", {}), /IMPORTED_AGENT_READ_ONLY/);
});