/**
 * Offline-only patch for the reviewed isolated staging Worker.
 * This file performs no network calls, deployments, or secret reads.
 */
import { createHash } from "node:crypto";

export const STAGING_ACCOUNT_ID = "03ef1e6e42498920987f07059e107538";
export const STAGING_WORKER = "buildcustom-vibesdk-migration-staging";
export const CLEAN_ENTRY_SHA256 = "41a9330dd56ce9a73dfdc8ec224122b74a1cabd908774c55533acae4c5dae57a";
export const VERIFY_PATH = "/__internal/buildcustom/verify-think-token";

// Inserted verbatim into the clean staging entry module only.
async function handleBuildCustomThinkTokenVerify(request, env) {
  const route = "/__internal/buildcustom/verify-think-token";
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
  if (typeof env.BUILDCUSTOM_THINK_API_TOKEN !== "string" ||
      !env.BUILDCUSTOM_THINK_API_TOKEN) {
    return respond({ verificationHttpStatus: null, verified: false, tokenId: null,
      tokenStatus: null, errorCode: "THINK_CREDENTIAL_UNAVAILABLE" }, 500);
  }

  let upstream;
  try {
    upstream = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/tokens/verify`,
      {
        method: "GET",
        redirect: "manual",
        headers: { Authorization: `Bearer ${env.BUILDCUSTOM_THINK_API_TOKEN}` },
      },
    );
  } catch {
    return respond({ verificationHttpStatus: null, verified: false, tokenId: null,
      tokenStatus: null, errorCode: "VERIFY_TRANSPORT_ERROR" }, 502);
  }

  const body = await upstream.json().catch(() => null);
  const id = body?.result?.id;
  const status = body?.result?.status;
  const verified = upstream.ok && body?.success === true &&
    typeof id === "string" && /^[0-9a-f]{32}$/.test(id);
  return respond({
    verificationHttpStatus: upstream.status,
    verified,
    tokenId: verified ? id : null,
    tokenStatus: verified && ["active", "disabled", "expired"].includes(status) ? status : null,
  }, upstream.status >= 200 && upstream.status <= 599 &&
     ![204, 205, 304].includes(upstream.status) ? upstream.status : 502);
}

const ENTRY_ANCHOR = "var worker_entry_default = { async fetch(request, env, ctx) {\n";
const THINK_ANCHOR = "const cloudflareToken = this.env.BUILDCUSTOM_THINK_API_TOKEN;";

export function prepareStagingThinkTokenVerify(source) {
  if (typeof source !== "string" ||
      createHash("sha256").update(source).digest("hex") !== CLEAN_ENTRY_SHA256) {
    throw new Error("Serving staging entry does not match reviewed clean baseline");
  }
  if (source.split(ENTRY_ANCHOR).length !== 2 ||
      source.split(THINK_ANCHOR).length !== 2 ||
      source.includes(VERIFY_PATH) ||
      source.includes("/__internal/buildcustom/google-unified-diagnostic") ||
      (source.match(/CLOUDFLARE_API_TOKEN/g) || []).length !== 15) {
    throw new Error("Unexpected entry, Think credential, or temporary route");
  }
  const insertion = `${handleBuildCustomThinkTokenVerify.toString()}\n`;
  const patched = source.replace(ENTRY_ANCHOR,
    `${insertion}${ENTRY_ANCHOR}const verifyResponse = await handleBuildCustomThinkTokenVerify(request, env);\nif (verifyResponse) return verifyResponse;\n`);
  if (patched === source || patched.split(VERIFY_PATH).length !== 2 ||
      patched.split(THINK_ANCHOR).length !== 2 ||
      (patched.match(/CLOUDFLARE_API_TOKEN/g) || []).length !== 15) {
    throw new Error("Patch changed an unexpected part of the entry module");
  }
  return patched;
}