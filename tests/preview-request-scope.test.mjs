import test from "node:test";
import assert from "node:assert/strict";
import { hasReadableScriptSource, isPreviewAuditRequest, safeObservedUrl } from "../scripts/preview-request-scope.mjs";

const host = "https://app.buildcustom.ai";
const preview = `${host}/_private_preview/agent-1/main/`;

test("a preview document is attributed by its exact scoped route before its frame has loaded", () => {
  assert.equal(isPreviewAuditRequest(preview, preview, "about:blank"), true);
  assert.equal(isPreviewAuditRequest(preview, `${preview}app.jsx?t=capability`, ""), true);
  assert.equal(isPreviewAuditRequest(preview, `${preview}api/leads?status=new&t=capability`, ""), true);
});

test("preview-frame requests stay in scope even when their URL is not under the preview route", () => {
  assert.equal(isPreviewAuditRequest(preview, `${host}/api/leads`, preview), true);
  assert.equal(isPreviewAuditRequest(preview, "https://cdn.example.com/script.js", `${preview}index.html`), true);
  assert.equal(isPreviewAuditRequest(preview, `${host}/api/projects/5/blog-posts`, preview), true);
});

test("same-origin parent-page failures and unrelated preview branches do not become app failures", () => {
  const parent = `${host}/app/project/5`;
  assert.equal(isPreviewAuditRequest(preview, `${host}/api/projects/5/blog-posts`, parent), false);
  assert.equal(isPreviewAuditRequest(preview, `${host}/api/projects/5/blog-posts`, ""), false);
  assert.equal(isPreviewAuditRequest(preview, `${host}/cdn-cgi/rum`, parent), false);
  assert.equal(isPreviewAuditRequest(preview, `${host}/_private_preview/agent-1/main-other/app.js`, parent), false);
  assert.equal(isPreviewAuditRequest(preview, `${host}/_private_preview/agent-2/main/app.js`, parent), false);
  assert.equal(isPreviewAuditRequest(preview, "https://cdn.example.com/script.js", parent), false);
});

test("a script tag's exact source is readable whether loaded directly or by a transformer XHR", () => {
  const source = `${preview}app.jsx?t=capability`;
  const request = { url: source, status: 200, responseBodyReadable: true };
  for (const resourceType of ["script", "xhr", "fetch"]) {
    assert.equal(hasReadableScriptSource([{ ...request, resourceType }], source), true);
  }
  assert.equal(hasReadableScriptSource([{ ...request, resourceType: "xhr" }], `${preview}app.jsx?t=other`), false);
  assert.equal(hasReadableScriptSource([{ ...request, status: 404, resourceType: "xhr" }], source), false);
  assert.equal(hasReadableScriptSource([{ ...request, responseBodyReadable: false, resourceType: "xhr" }], source), false);
  assert.equal(hasReadableScriptSource([{ ...request, resourceType: "document" }], source), false);
});

test("a redirected script source requires a readable successful final response", () => {
  const source = "https://cdn.tailwindcss.com/";
  const destination = "https://cdn.example.com/tailwind.js";
  const redirect = { url: source, resourceType: "script", status: 302, responseBodyReadable: false };
  const final = {
    url: destination, redirectSourceUrls: [source], resourceType: "script",
    status: 200, responseBodyReadable: true,
  };
  assert.equal(hasReadableScriptSource([redirect, final], source), true);
  assert.equal(hasReadableScriptSource([redirect], source), false);
  assert.equal(hasReadableScriptSource([redirect, { ...final, status: 404 }], source), false);
  assert.equal(hasReadableScriptSource([redirect, { ...final, responseBodyReadable: false }], source), false);
});

test("reported preview URLs redact the short capability parameter without removing normal filters", () => {
  const reported = new URL(safeObservedUrl(`${preview}api/leads?status=new&t=not-a-real-capability&status=won&token=hidden`));
  assert.deepEqual(reported.searchParams.getAll("status"), ["new", "won"]);
  assert.equal(reported.searchParams.get("t"), "[redacted]");
  assert.equal(reported.searchParams.get("token"), "[redacted]");
  assert.doesNotMatch(reported.href, /not-a-real-capability|token=hidden/);
});