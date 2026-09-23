#!/usr/bin/env -S npx tsx
/**
 * Destructive-looking, but isolated, staging acceptance harness.
 * It deliberately refuses to run unless the checked-in staging tuple is exact.
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
const ORIGIN = new URL(TARGET).origin;
const blockers: string[] = [];
const failures: string[] = [];
const tempFiles: string[] = [];

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
}

function sqlQuote(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
function runD1(sql: string) {
  const file = join(tmpdir(), `buildcustom-accept-${randomUUID()}.sql`);
  tempFiles.push(file);
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
function runKvPut(key: string, value: string) {
  try {
    execFileSync("npx", ["wrangler", "kv", "key", "put", key, value, "--namespace-id", KV, "--remote", "--config", CONFIG],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}
function runKvDelete(key: string) {
  try {
    execFileSync("npx", ["wrangler", "kv", "key", "delete", key, "--namespace-id", KV, "--remote", "--config", CONFIG],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return true;
  } catch {
    return false;
  }
}
function runKvGet(key: string): { present: boolean; supported: boolean } {
  try {
    execFileSync("npx", ["wrangler", "kv", "key", "get", key, "--namespace-id", KV, "--remote", "--config", CONFIG],
      { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8" });
    return { present: true, supported: true };
  } catch (error: any) {
    const output = `${error?.stdout || ""}\n${error?.stderr || ""}`;
    if (/404:\s*Not Found/i.test(output)) return { present: false, supported: true };
    return { present: false, supported: false };
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
  try { data = await response.json(); } catch { /* empty response */ }
  return { status: response.status, data };
}
function expect(category: string, ok: boolean, detail?: string) {
  if (ok) console.log(`PASS ${category}`);
  else { failures.push(category); console.log(`FAIL ${category}${detail ? ` (${detail})` : ""}`); }
}
function blocker(category: string, detail: string) {
  blockers.push(`${category}:${detail}`);
  console.log(`BLOCKER ${category}:${detail}`);
}
function statusOk(result: { status: number }, allowed: number[]) { return allowed.includes(result.status); }

async function main() {
  guardConfig();
  const superId = randomUUID(), userId = randomUUID();
  const superPassword = `${randomUUID()}-S`;
  const userPassword = `${randomUUID()}-U`;
  const superEmail = `accept-${superId}@staging.invalid`;
  const userEmail = `accept-${userId}@staging.invalid`;
  const superHash = await bcrypt.hash(superPassword, 10);
  const userHash = await bcrypt.hash(userPassword, 10);
  let projectId: number | undefined, secondProjectId: number | undefined, deletionProjectId: number | undefined, waitlistId: number | undefined;
  const ownedKvKeys = new Set<string>();
  const superJar = new Jar(), userJar = new Jar();
  const seed = `PRAGMA foreign_keys=ON;
INSERT INTO users(id,username,email,password,role) VALUES(${sqlQuote(superId)},${sqlQuote(`accept-${superId}`)},${sqlQuote(superEmail)},${sqlQuote(superHash)},'super_admin');
INSERT INTO users(id,username,email,password,role) VALUES(${sqlQuote(userId)},${sqlQuote(`accept-${userId}`)},${sqlQuote(userEmail)},${sqlQuote(userHash)},'user');`;
  try {
    runD1(seed);
    const unauth = await request(new Jar(), "/api/projects");
    expect("unauthenticated access", unauth.status === 401);
    const login = await request(superJar, "/api/auth/login", "POST", { email: superEmail, password: superPassword });
    expect("login/session", login.status === 200 && login.data?.role === "super_admin");
    const me = await request(superJar, "/api/auth/me");
    expect("session identity", me.status === 200 && me.data?.id === superId);
    const userLogin = await request(userJar, "/api/auth/login", "POST", { email: userEmail, password: userPassword });
    expect("user login/role", userLogin.status === 200 && userLogin.data?.role === "user");
    const adminJar = new Jar();
    const adminLogin = await request(adminJar, "/api/admin/login", "POST", { username: `accept-${superId}`, password: superPassword });
    const adminMe = await request(adminJar, "/api/auth/me");
    expect("admin login/session cookie", adminLogin.status === 200 && adminMe.status === 200 && adminMe.data?.role === "super_admin");
    const projects = await request(superJar, "/api/projects");
    expect("project list", projects.status === 200 && Array.isArray(projects.data));
    const created = await request(superJar, "/api/projects", "POST", { name: "Acceptance Isolated Project", type: "website", description: "temporary acceptance row" });
    projectId = Number(created.data?.id);
    expect("project create", created.status === 201 && Number.isSafeInteger(projectId) && projectId > 0);
    const read = await request(superJar, `/api/projects/${projectId}`);
    const update = await request(superJar, `/api/projects/${projectId}`, "PUT", { name: "Acceptance Updated Project", description: "updated" });
    expect("project read/update", read.status === 200 && update.status === 200 && update.data?.name === "Acceptance Updated Project");
    const denied = await request(userJar, `/api/projects/${projectId}`);
    expect("project ownership", denied.status === 404);
    const status = await request(superJar, `/api/projects/${projectId}/runtime/status`);
    if (status.status === 200) expect("runtime status", true);
    else blocker("runtime status", String(status.status));
    const consoleResult = await request(superJar, `/api/projects/${projectId}/runtime/console`);
    if (consoleResult.status === 200) expect("runtime console", true);
    else blocker("runtime console", String(consoleResult.status));

    const blog = await request(superJar, `/api/projects/${projectId}/blog-posts`, "POST", { title: "Acceptance Post", content: "temporary content", status: "draft" });
    const blogId = Number(blog.data?.id);
    const blogRead = await request(superJar, `/api/projects/${projectId}/blog-posts`);
    const blogUpdate = await request(superJar, `/api/projects/${projectId}/blog-posts/${blogId}`, "PUT", { title: "Acceptance Post Updated" });
    const blogDelete = await request(superJar, `/api/projects/${projectId}/blog-posts/${blogId}`, "DELETE");
    expect("blog CRUD", blog.status === 201 && blogRead.status === 200 && blogUpdate.status === 200 && blogDelete.status === 200);
    const autoRead = await request(superJar, `/api/projects/${projectId}/autoblogger`);
    const autoUpdate = await request(superJar, `/api/projects/${projectId}/autoblogger`, "PUT", { enabled: true, postsPerDay: 1, keywords: "acceptance" });
    expect("autoblogger read/update", autoRead.status === 200 && autoUpdate.status === 200 && autoUpdate.data?.enabled === true);
    const seoRead = await request(superJar, `/api/projects/${projectId}/seo`);
    const seoUpdate = await request(superJar, `/api/projects/${projectId}/seo`, "PUT", { metaTitle: "Acceptance SEO", schemaJson: "{}" });
    const image = await request(superJar, `/api/projects/${projectId}/seo/social-image`, "POST", { data: "data:image/png;base64,iVBORw0KGgo=" });
    const imageDelete = await request(superJar, `/api/projects/${projectId}/seo/social-image`, "DELETE");
    expect("SEO read/update/social image", seoRead.status === 200 && seoUpdate.status === 200 && image.status === 200 && imageDelete.status === 200);
    const page = await request(superJar, `/api/projects/${projectId}/pages`, "POST", { title: "Acceptance Page", slug: "acceptance", content: "temporary" });
    const pageId = Number(page.data?.id);
    const pageRead = await request(superJar, `/api/projects/${projectId}/pages`);
    const pageUpdate = await request(superJar, `/api/projects/${projectId}/pages/${pageId}`, "PUT", { title: "Acceptance Page Updated" });
    const pageDelete = await request(superJar, `/api/projects/${projectId}/pages/${pageId}`, "DELETE");
    expect("pages CRUD", page.status === 201 && pageRead.status === 200 && pageUpdate.status === 200 && pageDelete.status === 200);
    const templates = await request(superJar, "/api/templates");
    expect("templates read", templates.status === 200 && Array.isArray(templates.data));

    const wait = await request(new Jar(), "/api/waitlist", "POST", { name: "Acceptance", email: `wait-${superId}@staging.invalid`, source: "acceptance" });
    waitlistId = Number(wait.data?.id);
    const adminList = await request(superJar, "/api/admin/waitlist");
    const adminDelete = await request(superJar, `/api/admin/waitlist/${waitlistId}`, "DELETE");
    expect("public waitlist/admin read-delete", wait.status === 201 && adminList.status === 200 && adminDelete.status === 200);
    const domains = await request(superJar, `/api/projects/${projectId}/runtime/domains`);
    const domainStatus = await request(superJar, `/api/projects/${projectId}/runtime/custom-domain`);
    const blockedNoHostname = await request(superJar, `/api/projects/${projectId}/runtime/custom-domain`, "POST", {});
    const blocked = await request(superJar, `/api/projects/${projectId}/runtime/custom-domain`, "POST", { hostname: "not-used.invalid" });
    expect("domain list/status", domains.status === 200 && domainStatus.status === 200);
    expect("blocked domain creation (no hostname)", blockedNoHostname.status === 503 && blockedNoHostname.data?.code === "STAGING_CUSTOM_HOSTNAME_UNAVAILABLE");
    expect("blocked domain creation (foreign host)", blocked.status === 400 && blocked.data?.code === "STAGING_HOSTNAME_NOT_ALLOWED");

    const deletionProject = await request(superJar, "/api/projects", "POST", { name: "Acceptance Route Cleanup Project" });
    deletionProjectId = Number(deletionProject.data?.id);
    const deletionSlug = `accept-${deletionProjectId}-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const deletionScript = `accept-script-${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const deletionHost = `${deletionSlug}.staging.invalid`;
    if (deletionProject.status === 201 && Number.isSafeInteger(deletionProjectId) && deletionProjectId > 0) {
      const routeReady = runKvPut(deletionSlug, JSON.stringify({ scriptName: deletionScript, metadata: {} }));
      const previewReady = runKvPut(`preview:${deletionSlug}`, JSON.stringify({ scriptName: deletionScript }));
      const hostReady = runKvPut(`hostname:${deletionHost}`, JSON.stringify({ slug: deletionSlug }));
      if (routeReady) ownedKvKeys.add(deletionSlug);
      if (previewReady) ownedKvKeys.add(`preview:${deletionSlug}`);
      if (hostReady) ownedKvKeys.add(`hostname:${deletionHost}`);
      if (!routeReady || !previewReady || !hostReady) {
        blocker("project deletion route cleanup", "KV_CLI_UNSUPPORTED_OR_WRITE_FAILED");
      } else {
        runD1(`INSERT INTO runtime_project_links(project_id,subdomain_slug,deployment_script_name) VALUES(${deletionProjectId},${sqlQuote(deletionSlug)},${sqlQuote(deletionScript)});
INSERT INTO runtime_custom_domain_claims(hostname,project_id,role,is_primary) VALUES(${sqlQuote(deletionHost)},${deletionProjectId},'primary',1);`);
        const deletedWithRoutes = await request(superJar, `/api/projects/${deletionProjectId}`, "DELETE");
        const routeKeys = [deletionSlug, `preview:${deletionSlug}`, `hostname:${deletionHost}`];
        const routeReads = routeKeys.map((key) => runKvGet(key));
        const d1Check = runD1Query(`SELECT (SELECT COUNT(*) FROM projects WHERE id=${deletionProjectId}) AS project_count, (SELECT COUNT(*) FROM runtime_project_links WHERE project_id=${deletionProjectId}) AS link_count, (SELECT COUNT(*) FROM runtime_custom_domain_claims WHERE project_id=${deletionProjectId}) AS claim_count;`);
        const d1Gone = d1Check !== null && /"project_count"\s*:\s*0/.test(d1Check)
          && /"link_count"\s*:\s*0/.test(d1Check) && /"claim_count"\s*:\s*0/.test(d1Check);
        const kvSupported = routeReads.every((result) => result.supported);
        if (!kvSupported) blocker("project deletion route cleanup", "KV_CLI_UNSUPPORTED_OR_READ_FAILED");
        expect("project deletion route/domain cleanup",
          deletedWithRoutes.status === 200 && kvSupported && routeReads.every((result) => !result.present) && d1Gone);
      }
    } else {
      expect("project deletion route/domain cleanup", false, "disposable project creation");
    }

    const second = await request(superJar, "/api/projects", "POST", { name: "Acceptance Deletion Project" });
    secondProjectId = Number(second.data?.id);
    const deleteSecond = await request(superJar, `/api/projects/${secondProjectId}`, "DELETE");
    expect("project deletion", deleteSecond.status === 200);
    const logout = await request(superJar, "/api/auth/logout", "POST");
    const afterLogout = await request(superJar, "/api/auth/me");
    expect("logout", logout.status === 204 && afterLogout.data === null);
  } finally {
    // Parameterized SQL and generated IDs ensure this cannot remove pre-existing rows.
    const cleanup = `PRAGMA foreign_keys=ON;
DELETE FROM waitlist_entries WHERE id=${waitlistId && Number.isSafeInteger(waitlistId) ? waitlistId : -1};
DELETE FROM projects WHERE id IN (${projectId && Number.isSafeInteger(projectId) ? projectId : -1},${secondProjectId && Number.isSafeInteger(secondProjectId) ? secondProjectId : -1},${deletionProjectId && Number.isSafeInteger(deletionProjectId) ? deletionProjectId : -1});
DELETE FROM sessions WHERE user_id IN (${sqlQuote(superId)},${sqlQuote(userId)});
DELETE FROM users WHERE id IN (${sqlQuote(superId)},${sqlQuote(userId)});`;
    try { runD1(cleanup); } catch { blocker("cleanup", "D1 cleanup failed"); }
    for (const key of ownedKvKeys) {
      if (!runKvDelete(key)) blocker("KV cleanup", "KV_CLI_UNSUPPORTED_OR_DELETE_FAILED");
    }
    for (const file of tempFiles) try { unlinkSync(file); } catch { /* already removed */ }
  }
  for (const name of blockers) void name;
  if (failures.length || blockers.length) process.exitCode = 1;
}

main().catch(() => {
  console.log("FAIL harness (UNEXPECTED_ERROR)");
  process.exitCode = 1;
});