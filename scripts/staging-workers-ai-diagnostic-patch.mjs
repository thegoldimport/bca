/**
 * Offline patch for the reviewed, isolated VibeSDK staging Worker bundle.
 * This file is not part of any Worker build or deployment command. It makes
 * no network calls, uploads, secret reads, or writes. Deployment requires a
 * separate, explicitly approved staging-only operation.
 */
import { createHash } from "node:crypto";

export const STAGING_ACCOUNT_ID = "03ef1e6e42498920987f07059e107538";
export const STAGING_WORKER = "buildcustom-vibesdk-migration-staging";
export const REVIEWED_ENTRY_SHA256 = "41a9330dd56ce9a73dfdc8ec224122b74a1cabd908774c55533acae4c5dae57a";
export const DIAGNOSTIC_PATH = "/__internal/buildcustom/workers-ai-diagnostic";

// This function is inserted verbatim into only the pinned staging entry module.
// Keep it self-contained: it must not reference variables in this patching file.
async function handleBuildCustomWorkersAiDiagnostic(request, env) {
  const route = "/__internal/buildcustom/workers-ai-diagnostic";
  const url = new URL(request.url);
  if (url.pathname !== route) return null;

  const hidden = () => new Response(null, {
    status: 404,
    headers: { "Cache-Control": "no-store" },
  });
  const hostname = "buildcustom-vibesdk-migration-staging.thegoldimport.workers.dev";
  const accountId = "03ef1e6e42498920987f07059e107538";
  const gateway = "buildcustom-think-unified-staging";
  if (request.method !== "POST" || url.hostname !== hostname ||
      env.CUSTOM_DOMAIN !== hostname || env.CLOUDFLARE_ACCOUNT_ID !== accountId ||
      env.CLOUDFLARE_AI_GATEWAY !== gateway) return hidden();

  const expected = env.BUILDCUSTOM_DIAGNOSTIC_SECRET;
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

  const responseHeaders = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  const respond = (data, status) => new Response(JSON.stringify(data), { status, headers: responseHeaders });
  if (typeof env.BUILDCUSTOM_THINK_API_TOKEN !== "string" || !env.BUILDCUSTOM_THINK_API_TOKEN) {
    return respond({ upstreamStatus: null, errorCode: "THINK_CREDENTIAL_UNAVAILABLE" }, 500);
  }

  let upstream;
  try {
    upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.BUILDCUSTOM_THINK_API_TOKEN}`,
          "Content-Type": "application/json",
          "cf-aig-gateway-id": gateway,
        },
        body: JSON.stringify({
          model: "@cf/meta/llama-3.2-1b-instruct",
          messages: [{ role: "user", content: "Reply with exactly: CLOUDFLARE_AI_OK" }],
          max_tokens: 32,
          stream: false,
        }),
      },
    );
  } catch {
    return respond({ upstreamStatus: null, errorCode: "UPSTREAM_TRANSPORT_ERROR" }, 502);
  }

  const body = await upstream.json().catch(() => null);
  const requestId = upstream.headers.get("cf-aig-request-id");
  const rawText = body?.choices?.[0]?.message?.content ?? body?.response;
  const rawError = body?.errors?.[0] ?? body?.error;
  const code = rawError?.code;
  const message = rawError?.message;
  const safeErrorCode = typeof code === "number" && Number.isSafeInteger(code) ? code
    : typeof code === "string" && /^[A-Z0-9_]{1,48}$/.test(code) ? code : null;
  const safeErrorMessage = typeof message === "string" &&
    /^[a-zA-Z0-9 ,.'():/-]{1,160}$/.test(message) &&
    !/authorization|bearer|token|secret|api.key|credential|password|https?:|header/i.test(message)
    ? message : null;

  return respond({
    upstreamStatus: upstream.status,
    gatewayRequestId: requestId && /^[a-zA-Z0-9_-]{1,128}$/.test(requestId) ? requestId : null,
    requestedProvider: "workers-ai",
    requestedModel: "@cf/meta/llama-3.2-1b-instruct",
    responseText: upstream.ok && typeof rawText === "string" &&
      /^[\x20-\x7e]{1,256}$/.test(rawText) ? rawText : null,
    errorCode: upstream.ok ? null : safeErrorCode,
    errorMessage: upstream.ok ? null : safeErrorMessage,
  }, upstream.status);
}

const ENTRY_ANCHOR = "var worker_entry_default = { async fetch(request, env, ctx) {\n";
const THINK_ANCHOR = "const cloudflareToken = this.env.BUILDCUSTOM_THINK_API_TOKEN;";
const OLD_THINK_ANCHOR = "const cloudflareToken = this.env.CLOUDFLARE_API_TOKEN;";

export function prepareStagingWorkersAiDiagnostic(source) {
  if (typeof source !== "string" ||
      createHash("sha256").update(source).digest("hex") !== REVIEWED_ENTRY_SHA256) {
    throw new Error("Serving staging entry module does not match the reviewed baseline");
  }
  if (source.split(ENTRY_ANCHOR).length !== 2 ||
      source.split(THINK_ANCHOR).length !== 2 ||
      source.includes(OLD_THINK_ANCHOR) ||
      source.includes(DIAGNOSTIC_PATH) ||
      (source.match(/CLOUDFLARE_API_TOKEN/g) || []).length !== 15) {
    throw new Error("Unexpected entry point, Think credential, or diagnostic path");
  }
  const insertion = `${handleBuildCustomWorkersAiDiagnostic.toString()}\n`;
  const patched = source.replace(ENTRY_ANCHOR,
    `${insertion}${ENTRY_ANCHOR}const diagnosticResponse = await handleBuildCustomWorkersAiDiagnostic(request, env);\nif (diagnosticResponse) return diagnosticResponse;\n`);
  if (patched === source || patched.split(DIAGNOSTIC_PATH).length !== 2 ||
      patched.split(THINK_ANCHOR).length !== 2 ||
      (patched.match(/CLOUDFLARE_API_TOKEN/g) || []).length !== 15) {
    throw new Error("Patch changed an unexpected part of the entry module");
  }
  return patched;
}