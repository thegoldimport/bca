import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(`${process.cwd()}/lab/bc-vibesdk-lab-20260925/package.json`);
const puppeteer = require("puppeteer");
const directory = "/tmp/p8-operation-customer";
const prompt = "Please continue fixing the preview. My leads still aren't loading and the Recent Activity card is still missing. Make sure the existing CRM features keep working, verify the app when you're done, and fix any errors you encounter before finishing.";
const output = `${directory}/repair.json`;
try {
  const previous = JSON.parse(await fs.readFile(output, "utf8"));
  if (previous.attempted) throw new Error("A customer click was already attempted. Refusing a second instruction.");
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const browser = await puppeteer.connect({ browserWSEndpoint: (await fs.readFile(`${directory}/browser-endpoint`, "utf8")).trim() });
const page = (await browser.pages()).find(p => p.url().includes("/app/editor/8"));
if (!page) throw new Error("Existing Project 8 editor session is unavailable.");
const read = async endpoint => page.evaluate(async endpoint => {
  const r = await fetch(`/api/projects/8/runtime/${endpoint}`, { credentials: "same-origin" });
  if (!r.ok) throw new Error(`Supported ${endpoint} read failed (${r.status})`);
  return r.json();
}, endpoint);
const status = await read("status");
if (status.nativeTaskLifecycle?.status !== "INCOMPLETE_RESOURCE_LIMIT"
  || status.nativeTaskLifecycle.updatedAt !== 1790975250207
  || status.state?.shouldBeGenerating) throw new Error("Failed request is not historical/idle as expected.");
const input = await page.$('[data-testid="input-editor-chat"]');
if (!input || await input.evaluate(e => e.disabled)) throw new Error("Editor cannot accept the new request.");
const cdp = await page.createCDPSession();
await cdp.send("Network.enable");
const evidence = { startedAt: new Date().toISOString(), attempted: false, outgoingInstructions: 0, promptSha256: createHash("sha256").update(prompt).digest("hex"), historyConfirmed: true, frames: [], polls: [] };
const save = () => fs.writeFile(output, JSON.stringify(evidence, null, 2));
cdp.on("Network.webSocketFrameSent", event => {
  try {
    const frame = JSON.parse(event.response.payloadData);
    if (frame.type === "user_suggestion") {
      evidence.outgoingInstructions++;
      evidence.exactPrompt = frame.message === prompt;
      console.log(JSON.stringify({ stage: "CUSTOMER_INSTRUCTION_SENT", count: evidence.outgoingInstructions, exact: evidence.exactPrompt }));
      void save();
    }
  } catch {}
});
cdp.on("Network.webSocketFrameReceived", event => {
  try {
    const f = JSON.parse(event.response.payloadData);
    if (["generation_complete", "error", "file_generated", "phase_generating", "phase_generated"].includes(f.type)) {
      evidence.frames.push({ at: Date.now(), type: f.type, code: f.code, reason: f.reason, operationId: f.operationId, conversationId: f.conversationId });
    }
  } catch {}
});
await input.click({ clickCount: 3 });
await input.press("Backspace");
await input.type(prompt, { delay: 1 });
const send = await page.$('[data-testid="button-send-chat"]');
if (!send || await send.evaluate(e => e.disabled) || await input.evaluate(e => e.value) !== prompt) throw new Error("Controlled input is not ready; no instruction sent.");
const acceptedAt = Date.now();
evidence.attempted = true;
evidence.acceptedAt = acceptedAt;
await save(); // Checkpoint before the one-time click, even if this process stops.
await send.click();
let observedWork = false;
for (let index = 0; index < 100; index++) {
  await new Promise(resolve => setTimeout(resolve, 12_000));
  const s = await read("status");
  const r = await read("revision");
  const lifecycle = s.nativeTaskLifecycle;
  const generating = !!s.state?.shouldBeGenerating;
  const historical = !lifecycle || lifecycle.updatedAt < acceptedAt;
  if (generating || (!historical && lifecycle.status === "RUNNING")) observedWork = true;
  const poll = { at: Date.now(), generating, lifecycle, revision: r.commitHash, observedWork };
  evidence.polls.push(poll);
  await save();
  console.log(JSON.stringify({ stage: "POLL", ...poll }));
  if (!historical && lifecycle.status === "INCOMPLETE_RESOURCE_LIMIT" && !generating) {
    evidence.result = "PLATFORM_FAILURE_RESOURCE_LIMIT";
    break;
  }
  if (observedWork && !generating && !historical && lifecycle.status !== "RUNNING") {
    evidence.result = lifecycle.status;
    break;
  }
  if (observedWork && !generating && evidence.frames.some(f => f.type === "generation_complete")) {
    evidence.result = lifecycle?.status ?? "IDLE";
    break;
  }
}
evidence.finalStatus = await read("status");
evidence.finalRevision = await read("revision");
evidence.finalTurns = await read("turns");
evidence.finalReleases = await read("releases");
evidence.completedAt = new Date().toISOString();
evidence.result ??= "PLATFORM_FAILURE_NO_RETURN_WITHIN_20_MINUTES";
await page.screenshot({ path: `${directory}/editor-after.jpg`, fullPage: true });
await save();
console.log(JSON.stringify({ stage: "REPAIR_FINISHED", result: evidence.result, instructions: evidence.outgoingInstructions, revision: evidence.finalRevision.commitHash }));
await browser.disconnect();
process.exit(0);