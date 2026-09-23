#!/usr/bin/env -S npx tsx
/**
 * Opt-in, destructive staging acceptance for a generated VibeSDK agent.
 *
 * This is intentionally separate from accept-cloudflare-staging.ts. It never
 * chooses an origin from the environment: only the checked-in staging origin
 * below is accepted. Do not run without explicitly reviewing the target.
 *
 * Usage:
 *   npx tsx scripts/accept-cloudflare-generated-agent.ts
 *   STAGING_GATEWAY_URL=https://... npx tsx scripts/accept-cloudflare-generated-agent.ts --publish
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import bcrypt from "bcryptjs";

const CONFIG = "wrangler.staging.jsonc";
const TARGET = "https://buildcustom-control-plane-staging.thegoldimport.workers.dev";
const DB = "buildcustom-control-plane-staging";
const KV = "e5e119fa2abc4c26a8c027e0d8a8d82c";
const RUNTIME = "https://buildcustom-vibesdk-migration-staging.thegoldimport.workers.dev";
const GATEWAY = "https://buildcustom-apps-gateway-staging.thegoldimport.workers.dev";
const ORIGIN = new URL(TARGET).origin;
const publishRequested = process.argv.includes("--publish");
const hostnameRequested = process.argv.includes("--hostname");
const gatewayArg = process.argv.find((value) => value.startsWith("--gateway="))?.slice("--gateway=".length);
const configuredGateway = gatewayArg || process.env.STAGING_GATEWAY_URL;
if (configuredGateway && configuredGateway.replace(/\/+$/, "") !== GATEWAY) throw new Error("STAGING_GATEWAY_URL_MUST_BE_EXACT_STAGING_GATEWAY");
const gateway = configuredGateway ? GATEWAY : "";
const failures: string[] = [];
const blockers: string[] = [];
const temporaryFiles: string[] = [];

function guardConfig() {
  const text = readFileSync(CONFIG, "utf8");
  const required = [
    `"name": "buildcustom-control-plane-staging"`,
    `"database_name": "buildcustom-control-plane-staging"`,
    `"database_id": "6a0ee5f4-9077-4ccf-a585-a2afb3daf734"`,
    `"id": "e5e119fa2abc4c26a8c027e0d8a8d82c"`,
    `"STAGING_RUNTIME_URL": "${RUNTIME}"`,
    `"STAGING_ROUTE_KV_ID": "${KV}"`,
    `"STAGING_ALLOWED_ORIGIN": "${TARGET}"`,
    `"ENVIRONMENT": "staging"`,
  ];
  if (required.some((value) => !text.includes(value)) || text.includes("wrangler.production")) {
    throw new Error("STAGING_CONFIG_TUPLE_MISMATCH");
  }
  if (hostnameRequested && !text.includes('"STAGING_MANAGED_HOSTNAME_SUFFIX": "staging.buildcustom.ai"')) {
    throw new Error("STAGING_HOSTNAME_NOT_ENABLED");
  }
}

function sqlQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
function runD1(sql: string) {
  const file = join(tmpdir(), `buildcustom-generated-accept-${randomUUID()}.sql`);
  temporaryFiles.push(file);
  writeFileSync(file, sql, { mode: 0o600 });
  try {
    execFileSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--file", file], {
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 2_000_000,
    });
  } finally {
    try { unlinkSync(file); } catch { /* best effort */ }
  }
}
function runD1Query(sql: string): string | null {
  try {
    return execFileSync("npx", ["wrangler", "d1", "execute", DB, "--remote", "--config", CONFIG, "--command", sql, "--json"], {
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", maxBuffer: 2_000_000,
    });
  } catch {
    return null;
  }
}
function runKvGet(key: string): { present: boolean; supported: boolean; value?: string } {
  try {
    const value = execFileSync("npx", ["wrangler", "kv", "key", "get", key, "--namespace-id", KV, "--remote", "--config", CONFIG], {
      stdio: ["ignore", "pipe", "pipe"], encoding: "utf8",
    });
    return { present: true, supported: true, value: value.trim() };
  } catch (error: any) {
    const output = `${error?.stdout || ""}\n${error?.stderr || ""}`;
    return { present: !/404:\s*Not Found/i.test(output), supported: /404:\s*Not Found/i.test(output) };
  }
}

class Jar {
  private cookies = new Map<string, string>();
  update(response: Response) {
    const values = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.()
      || (response.headers.get("set-cookie") ? [response.headers.get("set-cookie")!] : []);
    for (const value of values) {
      const pair = value.split(";", 1)[0];
      const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
  }
  header() { return [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "); }
}
async function request(jar: Jar, path: string, method = "GET", body?: unknown) {
  const response = await fetch(`${TARGET}${path}`, {
    method,
    headers: { Origin: ORIGIN, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(jar.header() ? { Cookie: jar.header() } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar.update(response);
  let data: any = null;
  try { data = await response.json(); } catch { /* empty/non-JSON */ }
  return { status: response.status, data, headers: response.headers };
}
function expect(category: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS ${category}`);
  else { failures.push(category); console.log(`FAIL ${category}${detail ? ` (${detail})` : ""}`); }
}
function skip(category: string, detail: string) {
  blockers.push(`${category}:${detail}`);
  console.log(`SKIP ${category} (${detail})`);
}
function block(category: string, detail: string) {
  blockers.push(`${category}:${detail}`);
  console.log(`BLOCKER ${category} (${detail})`);
}
function statusIn(result: { status: number }, values: number[]) { return values.includes(result.status); }
function responseFiles(data: any): Array<{ path?: string }> {
  return Array.isArray(data?.files) ? data.files : Array.isArray(data) ? data : [];
}

async function checkPublicPage(url: string) {
  const response = await fetch(url, { redirect: "manual" });
  const type = response.headers.get("content-type") || "";
  const html = type.includes("text/html") ? await response.text() : "";
  const references = [...html.matchAll(/(?:src|href)=["']([^"']+)["']/gi)]
    .map((match) => match[1]).filter((value) => {
      if (!value || value.startsWith("#") || /^(?:data:|mailto:|javascript:)/i.test(value)) return false;
      try {
        const target = new URL(value, url);
        return target.origin === new URL(url).origin;
      } catch { return false; }
    }).filter((value, index, all) => all.indexOf(value) === index);
  const assets = await Promise.all(references.map((path) => fetch(new URL(path, url), { redirect: "manual" })
    .then((item) => ({ status: item.status, type: item.headers.get("content-type") || "" }))));
  return { response, html, references, assets };
}

function renderPublicPage(url: string): string {
  return execFileSync("chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--virtual-time-budget=8000", "--dump-dom", url,
  ], { encoding: "utf8", timeout: 35000, maxBuffer: 4_000_000, stdio: ["ignore", "pipe", "ignore"] });
}

async function main() {
  guardConfig();
  if (publishRequested && !gateway) {
    block("managed publish", "pass --gateway=... or set STAGING_GATEWAY_URL; no direct runtime URL counts");
    process.exitCode = 1;
    return;
  }
  if (gateway) {
    try {
      const parsed = new URL(gateway);
      if (parsed.protocol !== "https:" || parsed.hostname === new URL(TARGET).hostname || parsed.hostname === new URL(RUNTIME).hostname) {
        throw new Error("gateway must be a distinct HTTPS staging gateway");
      }
    } catch {
      throw new Error("INVALID_STAGING_GATEWAY_URL");
    }
  }

  const superId = randomUUID();
  const userId = randomUUID();
  const superPassword = `${randomUUID()}-S`;
  const userPassword = `${randomUUID()}-U`;
  const superEmail = `generated-accept-${superId}@staging.invalid`;
  const userEmail = `generated-accept-${userId}@staging.invalid`;
  const slug = `generated-accept-${randomUUID().replaceAll("-", "").slice(0, 18)}`;
  const superJar = new Jar();
  const userJar = new Jar();
  let projectId: number | undefined;
  let agentId: string | undefined;
  let projectDeleteSucceeded = false;
  const marker = `GENERATED_ACCEPTANCE_MARKER_${slug}`;
  const aboutMarker = `ABOUT_ROUTE_MARKER_${slug}`;
  const superHash = await bcrypt.hash(superPassword, 10);
  const userHash = await bcrypt.hash(userPassword, 10);

  try {
    runD1(`PRAGMA foreign_keys=ON;
INSERT INTO users(id,username,email,password,role) VALUES(${sqlQuote(superId)},${sqlQuote(`generated-${superId}`)},${sqlQuote(superEmail)},${sqlQuote(superHash)},'super_admin');
INSERT INTO users(id,username,email,password,role) VALUES(${sqlQuote(userId)},${sqlQuote(`generated-${userId}`)},${sqlQuote(userEmail)},${sqlQuote(userHash)},'user');`);

    const unauth = await request(new Jar(), "/api/projects");
    expect("generated-agent unauthenticated access", unauth.status === 401);
    const ownerLogin = await request(superJar, "/api/auth/login", "POST", { email: superEmail, password: superPassword });
    expect("generated-agent owner login", ownerLogin.status === 200 && ownerLogin.data?.role === "super_admin");
    const nonOwnerLogin = await request(userJar, "/api/auth/login", "POST", { email: userEmail, password: userPassword });
    expect("generated-agent non-owner login", nonOwnerLogin.status === 200 && nonOwnerLogin.data?.role === "user");

    const created = await request(superJar, "/api/projects", "POST", {
      name: "Generated Acceptance App", type: "website",
      description: "Disposable isolated generated-agent acceptance project.",
    });
    projectId = Number(created.data?.id);
    expect("generated-agent project create", created.status === 201 && Number.isSafeInteger(projectId) && projectId > 0);
    if (!projectId) return;

    const settings = await request(superJar, `/api/projects/${projectId}/runtime/publishing-settings`, "PUT", {
      subdomainSlug: slug, hostingProvider: "buildcustom",
    });
    expect("generated-agent staging publishing settings", settings.status === 200 && settings.data?.subdomainSlug === slug);

    const build = await request(superJar, `/api/projects/${projectId}/runtime/messages`, "POST", {
      mode: "build",
      message: hostnameRequested
        ? `Create a buildable React SPA with a home page at / and an About page at /about. Include a visible root-relative link href="/about" on the home page. Render the exact text ${aboutMarker} on the About page only, including on direct refresh. Use a stylesheet. Keep this exact visible marker on the home page only: ${marker}`
        : `Create a small valid website with a heading, a paragraph, and a stylesheet. Keep the app buildable. Include this exact visible marker in the generated app content: ${marker}`,
      displayMessage: "Create an isolated acceptance website",
    });
    if (!statusIn(build, [200, 201])) {
      block("generated-agent build", `runtime returned HTTP ${build.status}`);
      return;
    }
    agentId = build.data?.agentId || build.data?.turn?.agentId;
    expect("generated-agent normal generation", Boolean(build.data?.turn || build.data?.message));

    const status = await request(superJar, `/api/projects/${projectId}/runtime/status`);
    const files = await request(superJar, `/api/projects/${projectId}/runtime/files`);
    const listed = responseFiles(files.data);
    const candidates = listed.filter((file) => typeof file.path === "string" && /\.(tsx?|jsx?|html?|css)$/i.test(file.path)).slice(0, 20);
    let markerFound = false;
    let aboutRouteFound = false;
    let candidate: { path?: string } | undefined;
    for (const file of candidates) {
      const result = await request(superJar, `/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(file.path!)}`);
      if (typeof result.data?.content === "string" && result.data.content.includes(marker)) markerFound = true;
      if (typeof result.data?.content === "string" && result.data.content.includes("/about")) aboutRouteFound = true;
      if (!candidate && result.status === 200) candidate = file;
      if (markerFound && candidate && (!hostnameRequested || aboutRouteFound)) break;
    }
    const content = candidate
      ? await request(superJar, `/api/projects/${projectId}/runtime/files/content?path=${encodeURIComponent(candidate.path!)}`)
      : { status: 0, data: null };
    const turns = await request(superJar, `/api/projects/${projectId}/runtime/turns`);
    expect("generated-agent status", status.status === 200);
    expect("generated-agent file list", files.status === 200 && listed.length > 0);
    expect("generated-agent file content", content.status === 200 && typeof content.data?.content === "string");
    expect("generated-agent expected marker", markerFound);
    if (hostnameRequested) expect("generated-agent declared SPA route", aboutRouteFound);
    expect("generated-agent conversation state", turns.status === 200 && Array.isArray(turns.data?.turns) && turns.data.turns.length > 0);

    const edit = await request(superJar, `/api/projects/${projectId}/runtime/messages`, "POST", {
      mode: "build", message: hostnameRequested
        ? "Add one short sentence to the home page while keeping the app buildable and preserving the /about route and its link."
        : "Add one short sentence to the page while keeping the app buildable.",
      displayMessage: "Make a small isolated edit",
    });
    expect("generated-agent normal edit", statusIn(edit, [200, 201]) && Boolean(edit.data?.turn || edit.data?.message));
    const preview = await request(superJar, `/api/projects/${projectId}/runtime/previews`, "POST", {});
    expect("generated-agent preview", statusIn(preview, [200, 201]) && typeof preview.data?.url === "string");

    const nonOwnerSuggestions = await request(userJar, `/api/projects/${projectId}/seo/suggestions`);
    expect("SEO suggestions owner-only", nonOwnerSuggestions.status === 404);
    const ownerSuggestions = await request(superJar, `/api/projects/${projectId}/seo/suggestions`);
    if (ownerSuggestions.status === 200) {
      expect("SEO suggestions provider response", Boolean(ownerSuggestions.data?.projectSummary && ownerSuggestions.data?.metaTitle));
    } else if (ownerSuggestions.status === 503) {
      skip("SEO suggestions provider response", "staging provider secret is not configured");
    } else if (ownerSuggestions.status === 502) {
      block("SEO suggestions provider failure", "provider returned HTTP 502");
    } else {
      failures.push("SEO suggestions provider contract");
      console.log(`FAIL SEO suggestions provider contract (HTTP ${ownerSuggestions.status})`);
    }

    const seoTitle = "Generated Acceptance | Staging Publish";
    const seoBeforePublish = await request(superJar, `/api/projects/${projectId}/seo`, "PUT", {
      metaTitle: seoTitle,
      metaDescription: "Disposable staging website used to verify managed publishing and metadata.",
      allowIndexing: false,
    });
    expect("managed publish SEO settings", seoBeforePublish.status === 200 && seoBeforePublish.data?.metaTitle === seoTitle);

    if (!publishRequested) {
      skip("managed publish", "optional; rerun with --publish and an isolated STAGING_GATEWAY_URL");
    } else {
      const published = await request(superJar, `/api/projects/${projectId}/runtime/deployments`, "POST", {});
      if (!statusIn(published, [200, 201])) {
        const detail = typeof published.data?.message === "string" ? published.data.message.slice(0, 200) : "no error detail";
        block("managed publish", `runtime returned HTTP ${published.status}: ${detail}`);
      } else {
        const release = published.data?.release;
        const route = runKvGet(slug);
        const publicUrl = hostnameRequested ? `https://${slug}.staging.buildcustom.ai/` : `${gateway}/p/${slug}/`;
        const returnedScript = [published.data?.workersUrl, published.data?.originUrl, published.data?.url]
          .map((value) => typeof value === "string" ? value.match(/\/deployed\/([^/]+)/)?.[1] : null)
          .find(Boolean);
        const routeValue = route.value ? (() => { try { return JSON.parse(route.value!); } catch { return null; } })() : null;
        expect("managed publish response URL", published.data?.url === publicUrl);
        const persistedProject = await request(superJar, `/api/projects/${projectId}`);
        const releases = await request(superJar, `/api/projects/${projectId}/runtime/releases`);
        expect("managed publish release", Boolean(release?.commitHash && release?.deploymentUrl === publicUrl));
        expect("managed publish persisted deployment", persistedProject.status === 200 && persistedProject.data?.deploymentUrl === publicUrl);
        expect("managed publish persisted release", releases.status === 200 && Array.isArray(releases.data?.releases)
          && releases.data.releases.some((item: any) => item.deploymentUrl === publicUrl && item.commitHash === release?.commitHash));
        if (!route.supported) block("managed publish route KV", "KV CLI read failed");
        else expect("managed publish route KV", route.present && routeValue?.scriptName === returnedScript);
        const routeCheck = await fetch(`${publicUrl}_buildcustom/route-check`, { redirect: "manual" });
        let routeCheckData: any = null;
        try { routeCheckData = await routeCheck.json(); } catch { /* invalid route-check */ }
        expect("managed publish gateway route-check", routeCheck.status === 200 && routeCheckData?.ok === true && routeCheckData?.project === slug);
        const page = await checkPublicPage(publicUrl);
        expect("managed publish public HTML", page.response.status === 200 && page.html.length > 0);
        expect("managed publish public assets", page.references.length > 0 && page.assets.length === page.references.length
          && page.assets.every((asset) => asset.status >= 200 && asset.status < 300));
        expect("managed publish asset MIME", page.references.every((ref, index) =>
          !/\.css(?:[?#]|$)/i.test(ref) || page.assets[index].type.includes("text/css"))
          && page.references.every((ref, index) =>
            !/\.js(?:[?#]|$)/i.test(ref) || /javascript|ecmascript/i.test(page.assets[index].type)));
        const appScripts = page.references.filter((ref) => /\.js(?:[?#]|$)/i.test(ref));
        const scriptBodies = await Promise.all(appScripts.map((ref) => fetch(new URL(ref, publicUrl)).then((response) => response.text())));
        expect("managed publish expected generated app", page.html.includes(marker) || scriptBodies.some((body) => body.includes(marker)));
        if (hostnameRequested) {
          const nested = await fetch(`${publicUrl}about?from=direct`, { redirect: "manual" });
          expect("managed publish hostname-root nested request", nested.status === 200 && (nested.headers.get("content-type") || "").includes("text/html"));
          expect("managed publish hostname-root stylesheet", page.references.some((ref) =>
            ref.startsWith("/") && !ref.startsWith("//") && /\.css(?:[?#]|$)/i.test(ref)));
          const homeDom = renderPublicPage(publicUrl).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
          const aboutDom = renderPublicPage(`${publicUrl}about`).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");
          expect("managed publish hostname-root rendered SPA navigation",
            homeDom.includes(marker) && !homeDom.includes(aboutMarker)
            && aboutDom.includes(aboutMarker) && !aboutDom.includes(marker));
        }
        expect("managed publish SEO route metadata", routeValue?.metadata?.title === seoTitle
          && routeValue?.metadata?.allowIndexing === false && page.html.includes(seoTitle));
        const locked = await request(superJar, `/api/projects/${projectId}/runtime/publishing-settings`, "PUT", {
          subdomainSlug: `${slug}-changed`, hostingProvider: "buildcustom",
        });
        expect("published slug lock", locked.status === 409);
        const image = await fetch(`${publicUrl}_buildcustom/preview-image`);
        const frontendImage = await fetch(`${TARGET}/api/public/projects/${projectId}/preview-image`, { headers: { Origin: ORIGIN } });
        const imageOkay = image.status === 200 && (image.headers.get("content-type") || "").includes("image/");
        const frontendOkay = frontendImage.status === 200 && (frontendImage.headers.get("content-type") || "").includes("image/");
        if (imageOkay && frontendOkay) expect("managed publish preview image", true);
        else if (image.status === 404 && frontendImage.status === 404) skip("managed publish preview image", "preview capture is unavailable in this staging runtime");
        else expect("managed publish preview image status contract",
          (image.status === 200 || image.status === 404) && (frontendImage.status === 200 || frontendImage.status === 404)
          && (image.status !== 200 || imageOkay) && (frontendImage.status !== 200 || frontendOkay));
        const runtimeStatus = await request(superJar, `/api/projects/${projectId}/runtime/status`);
        const seoAfterPublish = await request(superJar, `/api/projects/${projectId}/seo`);
        expect("managed publish frontend preview URL", imageOkay && runtimeStatus.status === 200
          && typeof runtimeStatus.data?.previewImageUrl === "string"
          && seoAfterPublish.status === 200 && typeof seoAfterPublish.data?.previewImageUrl === "string");
        const social = await request(superJar, `/api/projects/${projectId}/seo/social-image`, "POST", {
          data: "data:image/png;base64,iVBORw0KGgo=",
        });
        const socialRoute = runKvGet(slug);
        let socialMetadata: any = null;
        try { socialMetadata = JSON.parse(socialRoute.value || "").metadata; } catch { /* reported below */ }
        expect("managed publish social-image metadata", social.status === 200
          && socialRoute.supported && socialRoute.present
          && typeof social.data?.ogImageUrl === "string"
          && socialMetadata?.ogImageUrl === social.data.ogImageUrl);
      }
    }
  } finally {
    // Never remove fixture users while their owned project may still exist.
    // A failed API deletion intentionally preserves ownership for recovery.
    if (projectId) {
      try {
        const deleted = await request(superJar, `/api/projects/${projectId}`, "DELETE");
        if (deleted.status === 200) {
          projectDeleteSucceeded = true;
          console.log("PASS generated-agent project deletion");
        } else block("generated-agent project deletion", `HTTP ${deleted.status}; ownership preserved`);
      } catch {
        block("generated-agent project deletion", "request failed; ownership preserved");
      }
    } else {
      projectDeleteSucceeded = true;
    }
    if (projectDeleteSucceeded) {
      try {
        runD1(`DELETE FROM sessions WHERE user_id IN (${sqlQuote(superId)},${sqlQuote(userId)});
DELETE FROM users WHERE id IN (${sqlQuote(superId)},${sqlQuote(userId)});`);
        const check = runD1Query(`SELECT (SELECT COUNT(*) FROM projects WHERE id=${projectId || -1}) AS project_count, (SELECT COUNT(*) FROM users WHERE id IN (${sqlQuote(superId)},${sqlQuote(userId)})) AS user_count;`);
        if (!check || !/"project_count"\s*:\s*0/.test(check) || !/"user_count"\s*:\s*0/.test(check)) block("generated-agent D1 cleanup", "disposable rows remain");
        else console.log("PASS generated-agent D1 cleanup");
      } catch {
        block("generated-agent D1 cleanup", "verification failed");
      }
      // Route and preview deletion are owned by the control-plane delete flow.
      // Never delete guessed keys here; verify both are absent instead.
      const cleanupKv = [slug, `preview:${slug}`].map((key) => ({ key, result: runKvGet(key) }));
      for (const { key, result: route } of cleanupKv) {
        if (!route.supported) block("generated-agent KV cleanup", `${key} verification unavailable`);
        else if (route.present) block("generated-agent KV cleanup", `${key} remains after API deletion`);
      }
      if (cleanupKv.every(({ result }) => result.supported && !result.present)) {
        console.log("PASS generated-agent route/preview KV cleanup");
      }
    } else if (projectId) {
      block("generated-agent fixture cleanup", "users retained because owned project deletion failed");
    }
    for (const file of temporaryFiles) try { unlinkSync(file); } catch { /* already removed */ }
  }
  if (failures.length || blockers.length) process.exitCode = 1;
}

main().catch((error) => {
  console.log(`FAIL generated-agent harness (${error instanceof Error ? error.message : "unexpected error"})`);
  process.exitCode = 1;
});