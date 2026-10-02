import fs from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
const require = createRequire(`${process.cwd()}/lab/bc-vibesdk-lab-20260925/package.json`);
const puppeteer = require("puppeteer");
const directory = "/tmp/p8-operation-customer";
await fs.mkdir(directory, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: "/repl/tools/bin/chromium", headless: true,
  userDataDir: "/tmp/p8-customer-loop/profile",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = (await browser.pages())[0] ?? await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
await page.goto("https://app.buildcustom.ai/app/project/8", { waitUntil: "networkidle2", timeout: 60_000 });
const read = async path => page.evaluate(async path => {
  const response = await fetch(path, { credentials: "same-origin" });
  return { status: response.status, body: await response.json() };
}, path);
const baseline = {
  at: new Date().toISOString(),
  status: await read("/api/projects/8/runtime/status"),
  revision: await read("/api/projects/8/runtime/revision"),
  turns: await read("/api/projects/8/runtime/turns"),
  releases: await read("/api/projects/8/runtime/releases"),
};
await fs.writeFile(`${directory}/baseline.json`, JSON.stringify(baseline, null, 2));
for (const button of await page.$$("button")) {
  if (await button.evaluate(e => e.textContent?.trim() === "Open Builder" && !e.disabled)) {
    await button.click();
    break;
  }
}
await new Promise(resolve => setTimeout(resolve, 5000));
await page.screenshot({ path: `${directory}/editor-before.jpg`, fullPage: true });
const controls = await page.evaluate(() => ({
  textareas: [...document.querySelectorAll("textarea")].map(e => ({
    placeholder: e.placeholder, disabled: e.disabled, testId: e.dataset.testid,
  })),
  buttons: [...document.querySelectorAll("button")].filter(e => e.offsetParent !== null).map(e => ({
    text: e.textContent?.trim(), label: e.getAttribute("aria-label"), disabled: e.disabled,
  })).filter(e => /send|publish|build|stop/i.test(`${e.text} ${e.label}`)),
}));
console.log(JSON.stringify({
  stage: "READY_CHECK", path: new URL(page.url()).pathname, controls,
  statusCode: baseline.status.status, statusKeys: Object.keys(baseline.status.body),
  lifecycle: baseline.status.body.nativeTaskLifecycle,
  revision: baseline.revision.body.commitHash ?? baseline.revision.body.revision?.commitHash,
}));
// Keep this exact browser session available for the single customer action.
await fs.writeFile(`${directory}/browser-endpoint`, browser.wsEndpoint());
await browser.disconnect();
await new Promise(() => {}); // Background owner keeps this browser alive.