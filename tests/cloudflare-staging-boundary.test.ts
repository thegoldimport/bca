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
test("imported IDs are read-only", () => {
  assert.throws(() => assertRuntimeOperationAllowed({ agentId: "imported-production-agent", imported: true, runtimeUrl: "https://isolated.staging.workers.dev" }, "build", {}), /IMPORTED_AGENT_READ_ONLY/);
});