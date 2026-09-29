import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/worker";

const origin = "https://app.buildcustom.ai";
const runtimeUrl = "https://buildcustom-vibesdk-launch.thegoldimport.workers.dev";

function launchEnv(runtimeFetch: (request: Request) => Promise<Response>) {
  let mutations = 0;
  const db = {
    prepare(sql: string) {
      const statement = {
        bind() { return statement; },
        async first() { return null; },
        async all() { return { results: [] }; },
        async run() {
          if (/^\s*(INSERT|UPDATE|DELETE|REPLACE)\b/i.test(sql)) mutations++;
          return { success: true };
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
      STAGING_RUNTIME_URL: runtimeUrl,
      VIBESDK_RUNTIME_URL: runtimeUrl,
      AUTH_RUNTIME_URL: runtimeUrl,
      VIBESDK_RUNTIME: {},
      AUTH_RUNTIME: { fetch: runtimeFetch },
      STAGING_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
      CONTROL_PLANE_ROUTE_KV_ID: "248ac5b6821a475794a7fe3d2b0c3718",
      STAGING_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
      CONTROL_PLANE_DISPATCH_NAMESPACE: "buildcustom-vibesdk-launch-dispatch",
      STAGING_MANAGED_GATEWAY_URL: "https://buildcustom-apps-gateway-launch.thegoldimport.workers.dev/p",
      STAGING_GATEWAY: {},
      STAGING_LOGIN_ENABLED: "true",
      STAGING_REGISTRATION_ENABLED: "false",
      PUBLIC_GENERATED_APPS_ENABLED: "false",
      CONTROL_PLANE_ALLOWED_ORIGIN: origin,
      STAGING_ALLOWED_ORIGIN: origin,
      CONTROL_PLANE_CANARY_ORIGIN: "https://buildcustom-control-plane-launch.thegoldimport.workers.dev",
      RUNTIME_OPERATIONS_ENABLED: "true",
    },
    get mutations() { return mutations; },
  };
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://app.buildcustom.ai${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

test("password recovery rejects a missing or foreign Origin before runtime", async () => {
  for (const headers of [{}, { Origin: "https://attacker.example" }]) {
    let calls = 0;
    const fixture = launchEnv(async () => {
      calls++;
      return Response.json({ success: true });
    });
    const response = await worker.fetch(post("/api/auth/forgot-password", { email: "user@example.test" }, headers), fixture.env as never);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { message: "ORIGIN_REJECTED" });
    assert.equal(calls, 0);
    assert.equal(fixture.mutations, 0);
  }
});

test("forgot password proxies only email and returns an account-enumeration-safe response", async () => {
  const forwarded: Request[] = [];
  const fixture = launchEnv(async (request) => {
    forwarded.push(request);
    return Response.json({ success: true, message: "account exists", email: "user@example.test" });
  });
  const response = await worker.fetch(post("/api/auth/forgot-password", { email: " User@Example.Test " }, {
    Origin: origin, Cookie: "csrf-token=csrf-value", "X-CSRF-Token": "csrf-value",
    Authorization: "Bearer do-not-forward",
  }), fixture.env as never);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    message: "If an account exists for that email, password reset instructions will be sent.",
  });
  assert.equal(forwarded.length, 1);
  assert.equal(new URL(forwarded[0].url).pathname, "/api/auth/forgot-password");
  assert.equal(forwarded[0].headers.get("X-CSRF-Token"), "csrf-value");
  assert.equal(forwarded[0].headers.get("Cookie"), "csrf-token=csrf-value");
  assert.equal(forwarded[0].headers.has("Authorization"), false);
  assert.deepEqual(await forwarded[0].json(), { email: "user@example.test" });
  assert.equal(fixture.mutations, 0);
});

test("forgot password rejects missing or mismatched CSRF before runtime", async () => {
  let calls = 0;
  const fixture = launchEnv(async (request) => {
    calls++;
    return Response.json({ success: true });
  });
  const response = await worker.fetch(post("/api/auth/forgot-password", { email: "user@example.test" }, {
    Origin: origin, Cookie: "csrf-token=csrf-cookie", "X-CSRF-Token": "different-token",
  }), fixture.env as never);
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { message: "A secure request is required." });
  assert.equal(calls, 0);
});

test("GET-issued runtime CSRF cookie and JSON token authorize forgot and reset proxy requests", async () => {
  const issuedToken = "runtime-issued-csrf-value";
  const issuedCookieValue = encodeURIComponent(JSON.stringify({ token: issuedToken, timestamp: Date.now() }));
  const received: Request[] = [];
  const fixture = launchEnv(async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/api/auth/csrf-token") {
      return Response.json({ success: true, data: { token: issuedToken } }, {
        headers: { "Set-Cookie": `csrf-token=${issuedCookieValue}; Path=/; Secure; HttpOnly; SameSite=Strict` },
      });
    }
    received.push(request);
    return Response.json({ success: true });
  });
  const csrfResponse = await worker.fetch(new Request(`${origin}/api/auth/csrf-token`), fixture.env as never);
  assert.equal(csrfResponse.status, 200);
  assert.deepEqual(await csrfResponse.json(), { token: issuedToken });
  const cookieHeader = csrfResponse.headers.getSetCookie().find((cookie) => cookie.startsWith("csrf-token="));
  assert.ok(cookieHeader);
  const csrfCookie = cookieHeader!.split(";", 1)[0];

  for (const [path, body] of [
    ["/api/auth/forgot-password", { email: "person@example.test" }],
    ["/api/auth/reset-password", {
      token: "single-use-password-token",
      newPassword: "A-long-password-123!",
      confirmPassword: "A-long-password-123!",
    }],
  ] as const) {
    const response = await worker.fetch(post(path, body, {
      Origin: origin,
      Cookie: csrfCookie,
      "X-CSRF-Token": issuedToken,
    }), fixture.env as never);
    assert.equal(response.status, 200, path);
  }
  assert.equal(received.length, 2);
  for (const request of received) {
    assert.equal(request.headers.get("Cookie"), csrfCookie);
    assert.equal(request.headers.get("X-CSRF-Token"), issuedToken);
  }
  assert.deepEqual(await received[0].json(), { email: "person@example.test" });
  assert.deepEqual(await received[1].json(), {
    token: "single-use-password-token",
    newPassword: "A-long-password-123!",
    confirmPassword: "A-long-password-123!",
  });
});

test("CSRF validator rejects expired/malformed runtime cookies but retains runtime legacy plain tokens", async () => {
  let calls = 0;
  const fixture = launchEnv(async () => {
    calls++;
    return Response.json({ success: true });
  });
  const validToken = "csrf-legacy-token";
  const requestBody = { email: "person@example.test" };
  const requestHeaders = (cookie: string, header = validToken) => ({
    Origin: origin, Cookie: `csrf-token=${cookie}`, "X-CSRF-Token": header,
  });
  for (const cookie of [
    encodeURIComponent(JSON.stringify({ token: validToken, timestamp: Date.now() - 2 * 60 * 60 * 1000 - 1 })),
    encodeURIComponent('{"token":"broken","timestamp":'),
  ]) {
    const response = await worker.fetch(post("/api/auth/forgot-password", requestBody, requestHeaders(cookie)), fixture.env as never);
    assert.equal(response.status, 403);
  }
  assert.equal(calls, 0);

  const legacy = await worker.fetch(post("/api/auth/forgot-password", requestBody, requestHeaders(validToken)), fixture.env as never);
  assert.equal(legacy.status, 200);
  assert.equal(calls, 1);
});

test("reset password forwards runtime-only credentials and returns no token or upstream body", async () => {
  const resetToken = "one-time-reset-token-do-not-leak";
  const newPassword = "new-password-123";
  let forwarded: Request | undefined;
  const fixture = launchEnv(async (request) => {
    forwarded = request;
    return Response.json({ success: true, token: resetToken, session: "sensitive-session" });
  });
  const response = await worker.fetch(post("/api/auth/reset-password", { token: resetToken, newPassword, confirmPassword: newPassword }, {
    Origin: origin, Cookie: "csrf-token=csrf-value", "X-CSRF-Token": "csrf-value",
  }), fixture.env as never);
  assert.equal(response.status, 200);
  const responseText = await response.text();
  assert.deepEqual(JSON.parse(responseText), { success: true });
  assert.doesNotMatch(responseText, /one-time-reset-token|sensitive-session/);
  assert.equal(new URL(forwarded!.url).pathname, "/api/auth/reset-password");
  assert.equal(forwarded!.headers.get("X-CSRF-Token"), "csrf-value");
  assert.deepEqual(await forwarded!.json(), { token: resetToken, newPassword, confirmPassword: newPassword });
  assert.equal(fixture.mutations, 0);
});

test("invalid reset credentials and upstream failures have bounded responses", async () => {
  let calls = 0;
  const fixture = launchEnv(async () => {
    calls++;
    return Response.json({ message: "raw upstream detail containing private data" }, { status: 500 });
  });
  const invalid = await worker.fetch(post("/api/auth/reset-password", { token: "x", newPassword: "123" }, {
    Origin: origin, Cookie: "csrf-token=csrf-value", "X-CSRF-Token": "csrf-value",
  }), fixture.env as never);
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);

  const failed = await worker.fetch(post("/api/auth/reset-password", {
    token: "valid-shaped-token", newPassword: "long-enough-password", confirmPassword: "long-enough-password",
  }, {
    Origin: origin, Cookie: "csrf-token=csrf-value", "X-CSRF-Token": "csrf-value",
  }), fixture.env as never);
  assert.equal(failed.status, 502);
  assert.deepEqual(await failed.json(), {
    message: "We could not reset your password. The link may be invalid or expired.",
  });
  assert.equal(calls, 1);
  assert.equal(fixture.mutations, 0);
});