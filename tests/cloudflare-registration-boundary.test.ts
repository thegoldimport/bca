import assert from "node:assert/strict";
import { test } from "node:test";
import { handleStagingCustomerAuth } from "../cloudflare/staging/runtime-identity";

const origin = "https://app.buildcustom.ai";
type Input = Record<string, unknown>;
async function register(input: Input, runtime: (request: Request) => Promise<Response>) {
  const env = {
    ENVIRONMENT: "production",
    CONTROL_PLANE_PROFILE: "launch",
    AUTH_RUNTIME_URL: "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev",
    AUTH_RUNTIME: { fetch: runtime },
  } as unknown as Parameters<typeof handleStagingCustomerAuth>[0];
  return handleStagingCustomerAuth(env,
    new Request(`${origin}/api/auth/register`, { method: "POST" }),
    "/api/auth/register", input);
}

test("valid registration-shaped input reaches the stock auth runtime", async () => {
  let forwarded = false;
  const response = await register({ name: "Test User", email: "NEW@EXAMPLE.TEST", password: "Strong-Test-123!" },
    async request => {
      forwarded = true;
      assert.equal(new URL(request.url).pathname, "/api/auth/register");
      assert.deepEqual(await request.json(), {
        name: "Test User", email: "new@example.test", password: "Strong-Test-123!",
      });
      return Response.json({ success: false }, { status: 409 });
    });
  assert.equal(forwarded, true);
  assert.equal(response?.status, 409);
});

for (const [label, input, status] of [
  ["duplicate", { name: "Test", email: "user@example.test", password: "Strong-Test-123!" }, 400],
  ["case-variant duplicate", { name: "Test", email: "USER@EXAMPLE.TEST", password: "Strong-Test-123!" }, 400],
  ["invalid email", { name: "Test", email: "not-an-email", password: "Strong-Test-123!" }, 400],
  ["weak password", { name: "Test", email: "new@example.test", password: "short" }, 400],
] as const) {
  test(`${label}: expected runtime client rejection stays a 4xx`, async () => {
    const response = await register(input, async () =>
      Response.json({ success: false }, { status }));
    assert.equal(response?.status, status);
  });
}

for (const [label, input] of [
  ["missing password", { name: "Test", email: "new@example.test" }],
  ["invalid shape", { email: ["not-a-string"], password: true }],
] as const) {
  test(`${label}: local required-field rejection remains 400`, async () => {
    const response = await register(input, async () => { throw new Error("Should not call runtime"); });
    assert.equal(response?.status, 400);
  });
}

test("genuine runtime 500 remains 502 rather than being classified as input", async () => {
  const response = await register({ name: "Test", email: "new@example.test", password: "Strong-Test-123!" },
    async () => Response.json({ success: false }, { status: 500 }));
  assert.equal(response?.status, 502);
});

test("runtime fetch exception remains 502", async () => {
  await assert.rejects(
    register({ name: "Test", email: "new@example.test", password: "Strong-Test-123!" },
      async () => { throw new Error("Simulated service-binding outage"); }),
    (error: Error & { status?: number }) => error.status === 502,
  );
});