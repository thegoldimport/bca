import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

// Reuse the authorized customer browser. No new login, prompt, click or publish.
const endpoint = (await readFile("/tmp/p8-persistence-customer/browser-endpoint", "utf8")).trim();
const socket = new WebSocket(endpoint);
const pending = new Map();
let sequence = 0;
socket.addEventListener("message", event => {
  const data = JSON.parse(event.data);
  const resolve = pending.get(data.id);
  if (resolve) { pending.delete(data.id); resolve(data); }
});
await new Promise((resolve, reject) => {
  socket.addEventListener("open", resolve, { once: true });
  socket.addEventListener("error", () => reject(new Error("Existing customer browser unavailable")), { once: true });
});
async function cdp(method, params = {}, sessionId) {
  const id = ++sequence;
  const response = new Promise(resolve => pending.set(id, resolve));
  socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  const data = await Promise.race([response, new Promise((_, reject) => setTimeout(() => reject(new Error("Browser observation timed out")), 20000).unref())]);
  assert(!data.error, `Browser observation failed: ${method}`);
  return data.result;
}
const targets = await cdp("Target.getTargets");
const target = targets.targetInfos.find(item => item.type === "page" && item.url === "https://app.buildcustom.ai/app/editor/8");
assert(target, "Existing Project 8 customer page missing; do not create a replacement session");
const { sessionId } = await cdp("Target.attachToTarget", { targetId: target.targetId, flatten: true });
if (process.argv[2] === "reload") {
  await cdp("Page.reload", { ignoreCache: true }, sessionId);
  await new Promise(resolve => setTimeout(resolve, 10000));
}
const result = await cdp("Runtime.evaluate", {
  expression: `(async () => {
    const response = await fetch('/api/projects/8/runtime/status', { credentials: 'same-origin', cache: 'no-store' });
    const status = await response.json();
    const lifecycle = status.nativeTaskLifecycle;
    const chat = document.querySelector('[data-testid="input-editor-chat"]');
    const buttons = [...document.querySelectorAll('button')];
    return {
      path: location.pathname, httpStatus: response.status,
      nativeTaskLifecycle: lifecycle,
      shouldBeGenerating: status.state?.shouldBeGenerating ?? status.shouldBeGenerating ?? null,
      nativeBuildCompleteShown: !!document.querySelector('[data-testid="native-build-complete"]'),
      continueShown: !!document.querySelector('[data-testid="button-native-continue"]'),
      chatUsable: !!chat && !chat.disabled,
      publishClicked: false, repairMessagesSent: 0,
      internalReasonExposed: /continuation_budget_exhausted|INCOMPLETE_RESOURCE_LIMIT|credit_limit|elapsed_time_limit/.test(document.body.innerText),
      taskUi: [...document.querySelectorAll('[role="status"]')].map(item => item.innerText).filter(text => /build|working|continue|input|incomplete/i.test(text)),
    };
  })()`,
  awaitPromise: true, returnByValue: true,
}, sessionId);
assert(!result.exceptionDetails, "Customer status observation failed");
const evidence = result.result.value;
assert.equal(evidence.httpStatus, 200);
const filename = process.argv[2] === "reload"
  ? "production/vibesdk-launch/user-approved-continuation-project8-after.json"
  : "production/vibesdk-launch/user-approved-continuation-project8-before.json";
await writeFile(filename, JSON.stringify(evidence, null, 2) + "\n");
console.log(JSON.stringify(evidence));
await cdp("Target.detachFromTarget", { sessionId });
socket.close();