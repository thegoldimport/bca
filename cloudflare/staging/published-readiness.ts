import type { BrowserRunBinding } from "./preview-image";

export type RequiredAsset = { path: string; kind: "css" | "js" | "image" | "other" };
export type ReadinessFailure = { layer: string; status?: number; type?: string | null; path?: string; cache?: string | null; age?: string | null };
export type ReadinessResult = { attempts: number; elapsedMs: number; assets: number; firstReadyAt: number };

export class StagingPublishNotReadyError extends Error {
  constructor(readonly failure: ReadinessFailure, readonly attempts: number, readonly elapsedMs: number) {
    super(`Staging app not ready after ${elapsedMs}ms (${failure.layer}${failure.status ? ` HTTP ${failure.status}` : ""}${failure.path ? ` ${failure.path}` : ""}). Retry publishing to check the existing deployment.`);
    this.name = "StagingPublishNotReadyError";
  }
}

export function requiredAssets(html: string, url: string): RequiredAsset[] {
  // Inline JSX and string literals are not HTML asset references.
  const tags = html.replace(/(<script\b[^>]*>)[\s\S]*?<\/script>/gi, "$1</script>");
  const assets = new Map<string, RequiredAsset>();
  for (const [tag] of tags.matchAll(/<(link|script|img|source)\b[^>]*>/gi)) {
    const value = tag.match(/\b(?:src|href)=["']([^"']+)["']/i)?.[1];
    if (!value || /^(?:data:|javascript:|mailto:|#)/i.test(value)) continue;
    let target: URL;
    try { target = new URL(value, url); } catch { continue; }
    if (target.origin !== new URL(url).origin) continue;
    const kind = /\.css$/i.test(target.pathname) ? "css"
      : /\.m?js$/i.test(target.pathname) ? "js"
      : /\.(?:svg|png|jpe?g|gif|webp|ico|avif)$/i.test(target.pathname) ? "image" : "other";
    assets.set(target.href, { path: target.pathname + target.search, kind });
  }
  return [...assets.values()];
}

export function browserContent(body: string): string {
  try {
    const parsed = JSON.parse(body);
    if (typeof parsed === "string") return parsed;
    if (typeof parsed?.result === "string") return parsed.result;
  } catch { /* Browser Rendering may return HTML directly. */ }
  return body;
}

export function renderedBodyHasContent(html: string): boolean {
  const body = html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || "";
  const withoutScripts = body.replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, "");
  const visibleText = withoutScripts.replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|amp|lt|gt);/gi, " ").replace(/\s+/g, " ").trim();
  return visibleText.length >= 8 || /<(?:img|svg|canvas)\b/i.test(withoutScripts);
}

function failure(layer: string, response: Response, path?: string): ReadinessFailure {
  return { layer, status: response.status, type: response.headers.get("content-type"),
    path, cache: response.headers.get("cf-cache-status"), age: response.headers.get("age") };
}

export async function checkStagingAppReady(
  url: string, gateway: Fetcher, browser: BrowserRunBinding | undefined,
): Promise<{ assets: number; failure?: ReadinessFailure }> {
  const root = await gateway.fetch(new Request(url));
  if (root.status !== 200 || !root.headers.get("content-type")?.includes("text/html")) {
    return { assets: 0, failure: failure("html", root, "/") };
  }
  const html = await root.text();
  const assets = requiredAssets(html, url);
  if (assets.length > 32) return { assets: assets.length, failure: { layer: "too-many-assets" } };
  for (const asset of assets) {
    const response = await gateway.fetch(new Request(new URL(asset.path, url)));
    const type = response.headers.get("content-type")?.toLowerCase() || "";
    const mimeOkay = asset.kind === "css" ? type.includes("text/css")
      : asset.kind === "js" ? /javascript|ecmascript/.test(type)
      : asset.kind === "image" ? type.startsWith("image/") : true;
    if (response.status !== 200 || !mimeOkay) return { assets: assets.length, failure: failure("asset", response, asset.path) };
    await response.body?.cancel();
  }
  if (!browser) return { assets: assets.length, failure: { layer: "browser-unavailable" } };
  const rendered = await browser.quickAction("content", {
    url, gotoOptions: { waitUntil: "networkidle2", timeout: 15_000 }, waitForTimeout: 250,
  });
  if (!rendered.ok) return { assets: assets.length, failure: failure("browser", rendered, "/") };
  if (!renderedBodyHasContent(browserContent(await rendered.text()))) {
    return { assets: assets.length, failure: { layer: "rendered-content" } };
  }
  return { assets: assets.length };
}

export async function waitForStagingAppReady(
  url: string, gateway: Fetcher, browser: BrowserRunBinding | undefined, verifyRoute: () => Promise<void>,
  options: { timeoutMs?: number; now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<ReadinessResult> {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 25_000;
  const started = now();
  let attempts = 0;
  let last: ReadinessFailure = { layer: "not-checked" };
  do {
    attempts++;
    try {
      await verifyRoute();
      const result = await checkStagingAppReady(url, gateway, browser);
      if (!result.failure) return { attempts, elapsedMs: now() - started, assets: result.assets, firstReadyAt: now() };
      last = result.failure;
    } catch (error) {
      last = { layer: "route-or-upstream", type: error instanceof Error ? error.name : "unknown" };
    }
    const remaining = timeoutMs - (now() - started);
    if (remaining <= 0) break;
    await sleep(Math.min(remaining, Math.min(2000, 500 * attempts)));
  } while (now() - started < timeoutMs);
  throw new StagingPublishNotReadyError(last, attempts, now() - started);
}