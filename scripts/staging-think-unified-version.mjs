/**
 * Narrow, rollback-safe upload for the isolated staging Worker only.
 * Check first: node scripts/staging-think-unified-version.mjs
 * Upload an undeployed version: node scripts/staging-think-unified-version.mjs --upload
 * Never prints or persists credential values or the fetched Worker bundle.
 */
import { spawnSync } from 'node:child_process';

const account = '03ef1e6e42498920987f07059e107538';
const worker = 'buildcustom-vibesdk-migration-staging';
const baseline = 'e8a7042e-8b17-4d6b-ac1a-f02e77c3511f';
const gateway = 'buildcustom-think-unified-staging';
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Cloudflare management credential unavailable');

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
  return response;
}

async function json(path) {
  const response = await request(path);
  if (!response.ok) throw new Error(`Cloudflare read failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.success) throw new Error('Cloudflare read failed');
  return payload.result;
}

const deployments = await json(`${base}/deployments`);
const serving = deployments.deployments?.[0]?.versions?.[0];
if (serving?.version_id !== baseline || serving?.percentage !== 100) {
  throw new Error('Staging version changed since rollback baseline; refusing upload');
}
const settings = await json(`${base}/settings`);
const bindings = settings.bindings ?? [];
if (
  bindings.length < 25 ||
  bindings.some(({ name }) => ['BUILDCUSTOM_UNIFIED_BILLING', 'CLOUDFLARE_AI_GATEWAY'].includes(name)) ||
  settings.compatibility_date !== '2026-05-23'
) {
  throw new Error('Staging settings changed since rollback baseline; refusing upload');
}

const response = await request(base);
if (!response.ok) throw new Error(`Cloudflare bundle read failed: HTTP ${response.status}`);
const contentType = response.headers.get('content-type') ?? '';
const boundary = /boundary="?([^";]+)"?/.exec(contentType)?.[1];
if (!boundary) throw new Error('Expected multipart Worker bundle');
const bundle = Buffer.from(await response.arrayBuffer());
const separator = Buffer.from(`--${boundary}`);
const newline = Buffer.from('\r\n');
const headersEnd = Buffer.from('\r\n\r\n');
const parts = [];
let cursor = 0;
while (true) {
  const start = bundle.indexOf(separator, cursor);
  if (start < 0) break;
  if (bundle.subarray(start + separator.length, start + separator.length + 2).equals(Buffer.from('--'))) break;
  const headerStart = start + separator.length + newline.length;
  if (!bundle.subarray(start + separator.length, headerStart).equals(newline)) throw new Error('Malformed multipart boundary');
  const split = bundle.indexOf(headersEnd, headerStart);
  const next = bundle.indexOf(separator, split + headersEnd.length);
  if (split < 0 || next < 0) throw new Error('Malformed multipart part');
  const header = bundle.subarray(headerStart, split).toString('utf8');
  const name = /name="([^"]+)"/.exec(header)?.[1];
  if (!name || !bundle.subarray(next - 2, next).equals(newline)) throw new Error('Malformed module part');
  parts.push({ name, bytes: bundle.subarray(split + headersEnd.length, next - 2) });
  cursor = next;
}
if (parts.length !== 7 || !parts.some(({ name }) => name === 'index.js') ||
    !parts.some(({ name }) => name.endsWith('.wasm'))) {
  throw new Error(`Unexpected multipart Worker modules (${parts.length}: ${parts.map(p => p.name).join(', ')}); refusing upload`);
}
const entry = parts.find(({ name }) => name === 'index.js');
const source = entry.bytes.toString('utf8');
if (!Buffer.from(source).equals(entry.bytes)) throw new Error('Unexpected index.js encoding');
const needle = '\t\tconst modelName = aiModelConfig.directOverride ? THINK_MODEL_ID.split("/").at(-1) : THINK_MODEL_ID;\n\t\tlet conf;';
if (source.split(needle).length !== 2 || !source.includes('directOverride: true')) {
  throw new Error('Deployed Think logic differs from reviewed baseline; refusing upload');
}
const replacement = `\t\t// Isolated BuildCustom staging: Cloudflare-managed Unified Billing, never Google BYOK.
\t\tconst unifiedBilling = this.env.BUILDCUSTOM_UNIFIED_BILLING === "true";
\t\tconst modelName = unifiedBilling ? "google/gemini-3.6-flash" : aiModelConfig.directOverride ? THINK_MODEL_ID.split("/").at(-1) : THINK_MODEL_ID;
\t\tif (unifiedBilling) {
\t\t\tconst accountId = this.env.CLOUDFLARE_ACCOUNT_ID;
\t\t\tconst cloudflareToken = this.env.CLOUDFLARE_API_TOKEN;
\t\t\tconst gatewayId = this.env.CLOUDFLARE_AI_GATEWAY;
\t\t\tif (!accountId || !cloudflareToken || gatewayId !== "buildcustom-think-unified-staging") throw new Error("Staging Unified Billing configuration incomplete");
\t\t\tconst config = {
\t\t\t\tuserId,
\t\t\t\tmodel: {
\t\t\t\t\tbaseURL: "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/ai/v1",
\t\t\t\t\tapiKey: cloudflareToken,
\t\t\t\t\tmodelName,
\t\t\t\t\tcontextSize: aiModelConfig.contextSize,
\t\t\t\t\theaders: { "cf-aig-gateway-id": gatewayId },
\t\t\t\t\tuseStoredKeys: false
\t\t\t\t},
\t\t\t\tsystemPrompt: this.buildSystemPrompt("gemini-3.6-flash", "google"),
\t\t\t\tpreviewUrl: await this.getBrowserPreviewURL(0).catch(() => void 0)
\t\t\t};
\t\t\tawait (await this.getThinkStub()).configureVibe(config);
\t\t\treturn;
\t\t}
\t\tlet conf;`;
const patched = source.replace(needle, replacement);
const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], {
  input: patched,
  encoding: 'utf8',
  maxBuffer: 1024 * 1024,
});
if (syntax.status !== 0) throw new Error(`Patched module syntax check failed: ${syntax.stderr.slice(0, 400)}`);
entry.bytes = Buffer.from(patched);
console.log(`Validated seven original modules, unchanged binary assets, patched Think branch, and JS syntax. Previous version: ${baseline}.`);
if (!process.argv.includes('--upload')) process.exit(0);

const metadata = {
  main_module: 'index.js',
  compatibility_date: settings.compatibility_date,
  compatibility_flags: settings.compatibility_flags,
  bindings: [
    ...bindings.map(({ name }) => ({ type: 'inherit', name, version_id: 'latest' })),
    { type: 'plain_text', name: 'BUILDCUSTOM_UNIFIED_BILLING', text: 'true' },
    { type: 'plain_text', name: 'CLOUDFLARE_AI_GATEWAY', text: gateway },
  ],
  annotations: { 'workers/message': 'Isolated staging Think Unified Billing; preserve previous version for rollback' },
};
const uploadBoundary = '----BuildCustomThinkUnifiedVersion';
const chunks = [];
function append(header, bytes) {
  chunks.push(Buffer.from(`--${uploadBoundary}\r\n${header}\r\n\r\n`), bytes, Buffer.from('\r\n'));
}
append('Content-Disposition: form-data; name="metadata"\r\nContent-Type: application/json', Buffer.from(JSON.stringify(metadata)));
for (const part of parts) {
  const type = part.name.endsWith('.wasm') ? 'application/wasm' : 'application/javascript+module';
  append(`Content-Disposition: form-data; name="${part.name}"; filename="${part.name}"\r\nContent-Type: ${type}`, part.bytes);
}
chunks.push(Buffer.from(`--${uploadBoundary}--\r\n`));
const upload = await request(`${base}/versions?bindings_inherit=strict`, {
  method: 'POST',
  headers: { 'Content-Type': `multipart/form-data; boundary=${uploadBoundary}` },
  body: Buffer.concat(chunks),
});
const result = await upload.json();
if (!upload.ok || !result.success) {
  console.error('Upload failed:', upload.status, (result.errors ?? []).map(({ code, message }) => ({ code, message })));
  process.exit(1);
}
console.log(`Uploaded undeployed staging version ${result.result?.id ?? 'unknown'}; verify inherited bindings before deployment.`);