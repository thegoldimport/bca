/**
 * Offline-only patch for the reviewed isolated VibeSDK staging Worker.
 * This module performs no network calls, uploads, or secret reads.
 */
import { createHash } from "node:crypto";

export const STAGING_ACCOUNT_ID = "03ef1e6e42498920987f07059e107538";
export const STAGING_WORKER = "buildcustom-vibesdk-migration-staging";
export const REVIEWED_ENTRY_SHA256 = "41a9330dd56ce9a73dfdc8ec224122b74a1cabd908774c55533acae4c5dae57a";
export const DIAGNOSTIC_PATH = "/__internal/buildcustom/google-unified-diagnostic";

// Inserted verbatim into the pinned staging entry module.
async function handleBuildCustomGoogleUnifiedDiagnostic(request, env) {
  const route = "/__internal/buildcustom/google-unified-diagnostic";
  const url = new URL(request.url);
  if (url.pathname !== route) return null;

  const hidden = () => new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
  const hostname = "buildcustom-vibesdk-migration-staging.thegoldimport.workers.dev";
  const accountId = "03ef1e6e42498920987f07059e107538";
  const gateway = "buildcustom-think-unified-staging";
  if (request.method !== "POST" || url.protocol !== "https:" || url.search !== "" ||
      url.hostname !== hostname || env.CUSTOM_DOMAIN !== hostname ||
      env.CLOUDFLARE_ACCOUNT_ID !== accountId ||
      env.CLOUDFLARE_AI_GATEWAY !== gateway) return hidden();

  const expected = env.BUILDCUSTOM_GOOGLE_UNIFIED_DIAGNOSTIC_SECRET;
  const header = request.headers.get("Authorization");
  if (typeof expected !== "string" || !/^[0-9a-f]{64}$/.test(expected) ||
      typeof header !== "string" || !/^Bearer [0-9a-f]{64}$/.test(header)) return hidden();
  const encoder = new TextEncoder();
  const [expectedHash, presentedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(header.slice(7))),
  ]);
  const a = new Uint8Array(expectedHash);
  const b = new Uint8Array(presentedHash);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference !== 0) return hidden();

  const respond = (data, status) => new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (typeof env.BUILDCUSTOM_THINK_API_TOKEN !== "string" || !env.BUILDCUSTOM_THINK_API_TOKEN) {
    return respond({ upstreamStatus: null, errorCode: "THINK_CREDENTIAL_UNAVAILABLE" }, 500);
  }

  let upstream;
  try {
    upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
      {
        method: "POST",
        redirect: "manual",
        headers: {
          Authorization: `Bearer ${env.BUILDCUSTOM_THINK_API_TOKEN}`,
          "Content-Type": "application/json",
          "cf-aig-gateway-id": gateway,
        },
        body: JSON.stringify({
          model: "google/gemini-3.6-flash",
          messages: [{ role: "user", content: "Reply with exactly: GEMINI_UNIFIED_OK" }],
          max_tokens: 20,
        }),
      },
    );
  } catch {
    return respond({ upstreamStatus: null, errorCode: "UPSTREAM_TRANSPORT_ERROR" }, 502);
  }

  const body = await upstream.json().catch(() => null);
  const rawError = body?.errors?.[0] ?? body?.error;
  const code = rawError?.code;
  const message = rawError?.message;
  const safeErrorCode = typeof code === "number" && Number.isSafeInteger(code) ? code
    : typeof code === "string" && /^[A-Z0-9_]{1,48}$/.test(code) ? code : null;
  const safeErrorMessage = typeof message === "string" &&
    /^[a-zA-Z0-9 ,.'():/-]{1,160}$/.test(message) &&
    !/authorization|bearer|token|secret|api.key|credential|password|https?:|header/i.test(message) &&
    !/[a-zA-Z0-9_-]{24,}/.test(message)
    ? message : null;
  const requestId = upstream.headers.get("cf-aig-request-id");
  const text = body?.choices?.[0]?.message?.content;
  return respond({
    upstreamStatus: upstream.status,
    gatewayRequestId: requestId &&
      (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId) ||
       /^[A-Z0-9]{26}$/.test(requestId)) ? requestId : null,
    requestedProvider: "google",
    requestedModel: "google/gemini-3.6-flash",
    responseMatchesExpected: upstream.ok && typeof text === "string" &&
      text.trim() === "GEMINI_UNIFIED_OK",
    errorCode: upstream.ok ? null : safeErrorCode,
    errorMessage: upstream.ok ? null : safeErrorMessage,
  }, upstream.status >= 200 && upstream.status <= 599 &&
     ![204, 205, 304].includes(upstream.status) ? upstream.status : 502);
}

const ENTRY_ANCHOR = "var worker_entry_default = { async fetch(request, env, ctx) {\n";
const THINK_ANCHOR = "const cloudflareToken = this.env.BUILDCUSTOM_THINK_API_TOKEN;";

export function prepareStagingGoogleUnifiedDiagnostic(source) {
  if (typeof source !== "string" ||
      createHash("sha256").update(source).digest("hex") !== REVIEWED_ENTRY_SHA256) {
    throw new Error("Serving staging entry module does not match reviewed clean baseline");
  }
  if (source.split(ENTRY_ANCHOR).length !== 2 ||
      source.split(THINK_ANCHOR).length !== 2 ||
      source.includes(DIAGNOSTIC_PATH) ||
      source.includes("/__internal/buildcustom/workers-ai-diagnostic") ||
      (source.match(/CLOUDFLARE_API_TOKEN/g) || []).length !== 15) {
    throw new Error("Unexpected entry point, Think credential, or diagnostic path");
  }
  const insertion = `${handleBuildCustomGoogleUnifiedDiagnostic.toString()}\n`;
  const patched = source.replace(ENTRY_ANCHOR,
    `${insertion}${ENTRY_ANCHOR}const diagnosticResponse = await handleBuildCustomGoogleUnifiedDiagnostic(request, env);\nif (diagnosticResponse) return diagnosticResponse;\n`);
  if (patched === source || patched.split(DIAGNOSTIC_PATH).length !== 2 ||
      patched.split(THINK_ANCHOR).length !== 2 ||
      (patched.match(/CLOUDFLARE_API_TOKEN/g) || []).length !== 15) {
    throw new Error("Patch changed an unexpected part of the entry module");
  }
  return patched;
}