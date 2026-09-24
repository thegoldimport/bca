/**
 * Prepare the isolated staging Worker's Think-only credential switch.
 * Run without flags to validate the actual serving bundle; --upload creates
 * an undeployed version. Never supplies, reads, or prints secret values.
 * The owner adds BUILDCUSTOM_THINK_API_TOKEN in Cloudflare after deployment.
 */
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const account = '03ef1e6e42498920987f07059e107538';
const worker = 'buildcustom-vibesdk-migration-staging';
const servingVersion = '0815f983-7730-41ee-a497-c24d8d93e172';
const servingEntryHash = 'edd32f1858e26a41f1e6a388af6a5130f73f989fd7c6b23e7f1f9062a5ce7205';
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!token) throw new Error('Cloudflare management credential unavailable');
if (process.argv.some(arg => arg.startsWith('--') && arg !== '--upload')) throw new Error('Unsupported option');

async function request(url, options = {}) {
  return fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...options.headers },
  });
}

async function json(url) {
  const response = await request(url);
  if (!response.ok) throw new Error(`Cloudflare read failed: HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.success) throw new Error('Cloudflare read failed');
  return payload.result;
}

const deployments = await json(`${base}/deployments`);
const active = deployments.deployments?.[0]?.versions;
if (active?.length !== 1 || active[0]?.version_id !== servingVersion || active[0]?.percentage !== 100) {
  throw new Error('Serving version differs from reviewed staging baseline; refusing upload');
}
const settings = await json(`${base}/settings`);
const bindings = settings.bindings ?? [];
if (bindings.length !== 32 ||
    !bindings.some(({ name, type }) => name === 'CLOUDFLARE_API_TOKEN' && type === 'secret_text') ||
    bindings.some(({ name }) => name === 'BUILDCUSTOM_THINK_API_TOKEN') ||
    settings.compatibility_date !== '2026-05-23' ||
    JSON.stringify(settings.compatibility_flags) !== '["nodejs_compat"]') {
  throw new Error('Unexpected staging binding or compatibility configuration; refusing upload');
}

const response = await request(base);
if (!response.ok) throw new Error(`Cloudflare bundle read failed: HTTP ${response.status}`);
const boundary = /boundary="?([^";]+)"?/.exec(response.headers.get('content-type') ?? '')?.[1];
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
  if (bundle.subarray(start + separator.length, start + separator.length + 2).toString() === '--') break;
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
  throw new Error('Unexpected Worker modules; refusing upload');
}
const entry = parts.find(({ name }) => name === 'index.js');
const source = entry.bytes.toString('utf8');
if (!Buffer.from(source).equals(entry.bytes) ||
    createHash('sha256').update(entry.bytes).digest('hex') !== servingEntryHash) {
  throw new Error('Deployed source differs from reviewed serving bundle; refusing upload');
}
const before = 'const cloudflareToken = this.env.CLOUDFLARE_API_TOKEN;';
const after = 'const cloudflareToken = this.env.BUILDCUSTOM_THINK_API_TOKEN;';
const anchor = `if (unifiedBilling) {\n\t\t\tconst accountId = this.env.CLOUDFLARE_ACCOUNT_ID;\n\t\t\t${before}`;
if (source.split(anchor).length !== 2 || source.includes(after)) {
  throw new Error('Unified Billing Think branch changed; refusing upload');
}
const patched = source.replace(anchor, anchor.replace(before, after));
if (patched !== source.replace(before, after) ||
    patched.split('BUILDCUSTOM_THINK_API_TOKEN').length !== 2 ||
    patched.split('CLOUDFLARE_API_TOKEN').length !== source.split('CLOUDFLARE_API_TOKEN').length - 1) {
  throw new Error('Patch altered unexpected runtime path');
}
const syntax = spawnSync(process.execPath, ['--check', '--input-type=module'], {
  input: patched, encoding: 'utf8', maxBuffer: 1024 * 1024,
});
if (syntax.status !== 0) throw new Error(`Patched module syntax check failed: ${syntax.stderr.slice(0, 400)}`);
entry.bytes = Buffer.from(patched);
console.log(`Validated exact serving bundle, seven modules, JS syntax, and single Think credential change (${servingVersion}).`);
if (!process.argv.includes('--upload')) process.exit(0);

// Explicitly inherit every existing binding, including the untouched shared
// token. The new secret is deliberately absent until the owner installs it.
const metadata = {
  main_module: 'index.js',
  compatibility_date: settings.compatibility_date,
  compatibility_flags: settings.compatibility_flags,
  bindings: bindings.map(({ name }) => ({ type: 'inherit', name, version_id: 'latest' })),
  annotations: { 'workers/message': 'Isolated staging Think credential separation; secret to be added by owner' },
};
const uploadBoundary = '----BuildCustomThinkCredentialVersion';
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
console.log(`Uploaded undeployed staging version ${result.result?.id ?? 'unknown'}; check binding parity before deploying.`);