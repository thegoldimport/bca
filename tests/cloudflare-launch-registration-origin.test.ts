import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/worker";

const appOrigin = "https://app.buildcustom.ai";
const authRuntimeUrl = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";
const registration = {
  name: "Test User",
  email: "new@example.test",
  password: "Strong-Test-123!",
};

function makeEnv(
  runtimeFetch: (request: Request) => Promise<Response>,
  registrationEnabled = "true",
) {
  let mutations = 0;
  const statements: string[] = [];
  const db = {
    prepare(sql: string) {
      statements.push(sql);
      const statement = {
        bind() {
          return statement;
        },
        async first() {
          return null;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) mutations += 1;
          return { success: true, meta: {} };
        },
      };
      return statement;
    },
  };
  return {
    env: {
      DB: db,
      ASSETS: { fetch: async () => new Response("asset", { status: 404 }) },
      STAGING_ROUTES: {},
      ENVIRONMENT: "production",
      CONTROL_PLANE_PROFILE: "launch",
      STAGING_RUNTIME_URL: authRuntimeUrl,
      VIBESDK_RUNTIME_URL: authRuntimeUrl,
      AUTH_RUNTIME_URL: authRuntimeUrl,
      VIBESDK_RUNTIME: {},
      AUTH_RUNTIME: { fetch: runtimeFetch },
      STAGING_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
      CONTROL_PLANE_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
      STAGING_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
      CONTROL_PLANE_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
      STAGING_MANAGED_GATEWAY_URL: "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p",
      STAGING_GATEWAY: {},
      STAGING_LOGIN_ENABLED: "true",
      STAGING_REGISTRATION_ENABLED: registrationEnabled,
      PUBLIC_GENERATED_APPS_ENABLED: "false",
      CONTROL_PLANE_ALLOWED_ORIGIN: appOrigin,
      STAGING_ALLOWED_ORIGIN: appOrigin,
      CONTROL_PLANE_CANARY_ORIGIN: "https://buildcustom-control-plane-launch.thegoldimport.workers.dev",
      RUNTIME_OPERATIONS_ENABLED: "true",
    },
    db: {
      get mutations() {
        return mutations;
      },
      statements,
    },
  };
}

function request(headers: Record<string, string> = {}) {
  return new Request(`${appOrigin}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(registration),
  });
}

async function fetchRegistration(
  req: Request,
  runtimeFetch: (request: Request) => Promise<Response>,
  registrationEnabled = "true",
) {
  const { env, db } = makeEnv(runtimeFetch, registrationEnabled);
  const response = await worker.fetch(req, env as never);
  return { response, db };
}

test("production launch registration rejects missing and invalid Origin before runtime", async () => {
  for (const [label, headers] of [
    ["missing", {}],
    ["invalid", { Origin: "https://evil.example" }],
  ] as const) {
    let runtimeCalls = 0;
    const { response, db } = await fetchRegistration(request(headers), async () => {
      runtimeCalls += 1;
      return Response.json({ success: false }, { status: 400 });
    });

    assert.equal(response.status, 400, label);
    assert.equal(await response.text(), '{"message":"ORIGIN_REJECTED"}', label);
    assert.equal(runtimeCalls, 0, label);
    assert.equal(db.mutations, 0, label);
  }
});

test("valid Origin forwards registration only with a valid CSRF token", async () => {
  const cases = [
    {
      label: "valid CSRF",
      headers: { Origin: appOrigin, Cookie: "csrf-token=known-token", "X-CSRF-Token": "known-token" },
      expectedCsrf: "known-token",
      runtimeStatus: 400,
    },
    {
      label: "missing CSRF",
      headers: { Origin: appOrigin },
      expectedCsrf: null,
      runtimeStatus: 403,
    },
    {
      label: "invalid CSRF",
      headers: { Origin: appOrigin, Cookie: "csrf-token=known-token", "X-CSRF-Token": "wrong-token" },
      expectedCsrf: "wrong-token",
      runtimeStatus: 403,
    },
  ] as const;

  for (const scenario of cases) {
    let runtimeCalls = 0;
    const { response, db } = await fetchRegistration(request(scenario.headers), async (upstream) => {
      runtimeCalls += 1;
      assert.equal(new URL(upstream.url).pathname, "/api/auth/register");
      assert.equal(upstream.method, "POST");
      assert.equal(upstream.headers.get("X-CSRF-Token"), scenario.expectedCsrf);
      assert.deepEqual(await upstream.json(), registration);
      return Response.json({ success: false }, { status: scenario.runtimeStatus });
    });

    if (scenario.label !== "valid CSRF") {
      assert.equal(response.status, 403, scenario.label);
      assert.deepEqual(await response.json(), { message: "A secure request is required." }, scenario.label);
      assert.equal(runtimeCalls, 0, scenario.label);
      assert.equal(db.mutations, 0, scenario.label);
      continue;
    }
    assert.equal(response.status, scenario.runtimeStatus, scenario.label);
    assert.deepEqual(await response.json(), { message: "Could not create your account. Check your details." }, scenario.label);
    assert.equal(runtimeCalls, 1, scenario.label);
    assert.equal(db.mutations, 0, scenario.label);
  }
});

test("a duplicate runtime 400 with valid Origin is not classified as ORIGIN_REJECTED", async () => {
  let runtimeCalls = 0;
  const { response, db } = await fetchRegistration(request({
    Origin: appOrigin,
    Cookie: "csrf-token=known-token",
    "X-CSRF-Token": "known-token",
  }), async () => {
    runtimeCalls += 1;
    return Response.json({ success: false, message: "duplicate" }, { status: 400 });
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { message: "Could not create your account. Check your details." });
  assert.equal(runtimeCalls, 1);
  assert.equal(db.mutations, 0);
});

test("signup missing the verification marker fails closed without forwarding cookies", async () => {
  const runtimePaths: string[] = [];
  const { response, db } = await fetchRegistration(request({
    Origin: appOrigin,
    Cookie: "csrf-token=known-token",
    "X-CSRF-Token": "known-token",
  }), async (upstream) => {
    const path = new URL(upstream.url).pathname;
    runtimePaths.push(path);
    if (path === "/api/auth/register") {
      return Response.json({ success: true }, {
        status: 201,
        headers: { "Set-Cookie": "accessToken=test-access; Path=/; Secure; HttpOnly; SameSite=Lax" },
      });
    }
    return Response.json({ success: true, data: { authenticated: true, user: {}, sessionId: 7 } });
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { message: "Email verification is not available yet." });
  assert.deepEqual(runtimePaths, ["/api/auth/register"]);
  assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith("accessToken=")), false);
  assert.equal(db.mutations, 0);
});

test("closed launch registration gate is checked after Origin but before runtime or D1 mutation", async () => {
  let runtimeCalls = 0;
  const { response, db } = await fetchRegistration(
    request({ Origin: appOrigin, "X-CSRF-Token": "known-token" }),
    async () => {
      runtimeCalls += 1;
      return Response.json({ success: false }, { status: 400 });
    },
    "false",
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: "Registration is closed." });
  assert.equal(runtimeCalls, 0);
  assert.equal(db.mutations, 0);
});

test("closed launch registration gate does not mask a missing Origin rejection", async () => {
  let runtimeCalls = 0;
  const { response, db } = await fetchRegistration(request(), async () => {
    runtimeCalls += 1;
    return Response.json({ success: false }, { status: 400 });
  }, "false");

  assert.equal(response.status, 400);
  assert.equal(await response.text(), '{"message":"ORIGIN_REJECTED"}');
  assert.equal(runtimeCalls, 0);
  assert.equal(db.mutations, 0);
});

test("launch signup returns a verification-pending account without issuing a session", async () => {
  const forwarded: Request[] = [];
  const { response, db } = await fetchRegistration(
    request({
      Origin: appOrigin,
      Cookie: "csrf-token=known-token",
      "X-CSRF-Token": "known-token",
      Authorization: "Bearer must-not-forward",
    }),
    async (upstream) => {
      forwarded.push(upstream);
      return Response.json({
        success: true,
        data: { verificationRequired: true, email: "owner@example.test" },
      });
    },
  );

  assert.equal(response.status, 201);
  const responseText = await response.text();
  assert.deepEqual(JSON.parse(responseText), {
    email: "new@example.test",
    verificationRequired: true,
    message: "Check your inbox for a link to verify your email before signing in.",
  });
  assert.doesNotMatch(responseText, /sessionId|accessToken|password|api.?key/i);
  assert.equal(response.headers.getSetCookie().some((cookie) => cookie.startsWith("accessToken=")), false);
  assert.equal(forwarded.length, 1);
  assert.equal(new URL(forwarded[0].url).pathname, "/api/auth/register");
  assert.equal(forwarded[0].headers.has("Authorization"), false);
  assert.deepEqual(await forwarded[0].json(), registration);
  assert.equal(db.mutations, 0);
});