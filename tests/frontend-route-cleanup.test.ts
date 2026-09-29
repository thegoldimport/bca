import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { JSDOM, VirtualConsole } from "jsdom";

// Exercise the built SPA, not a second, test-only route table. Build with Vite first.
const html = await readFile("dist/public/index.html", "utf8");
const asset = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
assert.ok(asset, "build the frontend before running routing tests");
const bundle = (await readFile(`dist/public${asset}`, "utf8"))
  // JSDOM's eval is a classic script; these four asset URLs are otherwise unchanged.
  .replaceAll("import.meta.url", "location.href");

const user = { id: "test", username: "Tester", email: "tester@example.test", plan: "launch", role: "user" };
const tick = () => new Promise(resolve => setTimeout(resolve, 25));

async function visit(path: string, authenticated = false, hostname = "app.buildcustom.ai") {
  const errors: string[] = [];
  const console = new VirtualConsole();
  console.on("jsdomError", error => errors.push(String(error)));
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: `https://${hostname}${path}`, pretendToBeVisual: true, runScripts: "dangerously", virtualConsole: console,
  });
  const { window } = dom;
  const calls: string[] = [];
  const historyChanges: string[] = [];
  const replaceState = window.history.replaceState.bind(window.history);
  window.history.replaceState = ((data, unused, url) => {
    if (url) historyChanges.push(String(url));
    return replaceState(data, unused, url);
  }) as typeof window.history.replaceState;
  window.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const body = url === "/api/auth/me" ? (authenticated ? user : null)
      : url === "/api/public/capabilities" ? { registrationEnabled: true, publicGeneratedAppsEnabled: true }
      : url === "/api/projects" ? []
      : url === "/api/projects/17" ? {
        id: 17,
        name: "Test project",
        type: "website",
        status: "draft",
        description: "",
        framework: "React + TailwindCSS",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        runtimeStatus: "ready",
      }
      : url === "/api/projects/17/blog-posts" ? []
      : {};
    return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  window.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as typeof ResizeObserver;
  window.matchMedia = (() => ({ matches: false, addListener() {}, removeListener() {},
    addEventListener() {}, removeEventListener() {} })) as typeof window.matchMedia;
  window.eval(bundle);
  async function until(predicate: () => boolean) {
    for (let i = 0; i < 100; i++) {
      if (predicate()) return;
      await tick();
    }
    assert.fail(`Timed out at ${window.location.pathname}; page: ${window.document.body.textContent?.slice(0, 180)}; errors: ${errors.join("; ").slice(0, 180)}`);
  }
  return { window, calls, historyChanges, until, close: () => dom.window.close() };
}

test("app root checks the existing session and routes signed-out/in users without marketing flash", async () => {
  for (const [authenticated, destination, label] of [
    [false, "/login", "Sign In"], [true, "/app", "Projects"],
  ] as const) {
    const page = await visit("/", authenticated);
    await page.until(() => page.window.location.pathname === destination && page.window.document.body.textContent!.includes(label));
    assert.equal(page.calls[0], "/api/auth/me");
    assert.ok(!page.window.document.body.textContent!.includes("Build It!"));
    page.close();
  }
});

test("canonical login, signup, forgot and reset routes render the expected UI", async () => {
  for (const [path, text] of [
    ["/login", "Welcome back"], ["/signup", "Create Account"],
    ["/forgot-password", "Send reset instructions"],
    ["/reset-password?token=test", "Choose a new password"],
  ]) {
    const page = await visit(path);
    await page.until(() => page.window.document.body.textContent!.includes(text));
    if (path.startsWith("/reset-password")) {
      assert.equal(page.window.document.querySelector<HTMLButtonElement>('[data-testid="button-reset-password"]')?.disabled, false);
      assert.equal(page.window.location.search, "", "reset token is cleared from address bar after capture");
    }
    page.close();
  }
});

test("retired marketing admin routes no longer show the waitlist dashboard or login", async () => {
  for (const path of ["/admin", "/admin/login"]) {
    const page = await visit(path, false, "buildcustom.ai");
    await page.until(() => page.window.document.body.textContent!.includes("404 Page Not Found"));
    page.close();
  }
});

test("legacy auth URLs redirect to clean routes, preserving complete reset query", async () => {
  for (const [oldPath, newPath, text] of [
    ["/app/login", "/login", "Sign In"],
    ["/app/signup", "/signup", "Create Account"],
    ["/app/forgot-password", "/forgot-password", "Send reset instructions"],
    ["/app/reset-password?token=test&campaign=one", "/reset-password", "Choose a new password"],
  ]) {
    const page = await visit(oldPath);
    await page.until(() => page.window.location.pathname === newPath && page.window.document.body.textContent!.includes(text));
    if (oldPath.includes("reset-password")) {
      assert.ok(page.historyChanges.some(url => url.endsWith("/reset-password?token=test&campaign=one")),
        "legacy redirect keeps the complete query string until ResetPassword reads it");
      assert.equal(page.window.document.querySelector<HTMLButtonElement>('[data-testid="button-reset-password"]')?.disabled, false);
      assert.equal(page.window.location.search, "", "token consumed by ResetPassword after redirect");
    }
    page.close();
  }
});

test("dashboard protection and existing project/editor paths remain under /app", async () => {
  const signedOut = await visit("/app");
  await signedOut.until(() => signedOut.window.location.pathname === "/login");
  signedOut.close();
  for (const path of ["/app", "/app/project/17", "/app/editor/17"]) {
    const page = await visit(path, true);
    await page.until(() => page.window.document.body.textContent!.includes("Projects"));
    assert.equal(page.window.location.pathname, path);
    page.close();
  }
});

test("marketing build directs product CTAs to signup without a waitlist or fake booking flow", () => {
  assert.equal((bundle.match(/onBuildClick:\(\)=>window\.location\.assign\("https:\/\/app\.buildcustom\.ai\/signup"\)/g) ?? []).length, 2);
  assert.ok(!bundle.includes("/api/waitlist"));
  assert.ok(!bundle.includes("ai-build-studio.replit.app"));
  assert.ok(!bundle.includes("Book Strategy Call"));
  assert.match(bundle, /href:"https:\/\/app\.buildcustom\.ai\/signup"/);
  assert.match(bundle, /path:"\/",component:[a-zA-Z_$][\w$]*/);
});

test("checked-in launch config keeps registration and generated apps enabled", async () => {
  const control = await readFile("wrangler.product-launch.jsonc", "utf8");
  const runtime = await readFile("production/vibesdk-launch/wrangler.jsonc", "utf8");
  assert.match(control, /"STAGING_REGISTRATION_ENABLED":\s*"true"/);
  assert.match(runtime, /"REGISTRATION_ENABLED":\s*"true"/);
  assert.match(control, /"PUBLIC_GENERATED_APPS_ENABLED":\s*"true"/);
});