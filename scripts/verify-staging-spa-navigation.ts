import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function verifyStagingSpaNavigation(url: string, homeMarker: string, aboutMarker: string) {
  const profile = mkdtempSync(join(tmpdir(), "buildcustom-staging-chrome-"));
  const chrome = spawn("chromium", [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--remote-debugging-port=0", "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, "about:blank",
  ], { stdio: "ignore", detached: true });
  let socket: WebSocket | undefined;
  try {
    let port = "";
    const until = Date.now() + 10_000;
    while (Date.now() < until) {
      try { port = readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { /* Chrome is starting. */ }
      if (port) break;
      await pause(100);
    }
    if (!port) throw new Error("Chromium did not start its local debugging port.");
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as Array<{type:string;webSocketDebuggerUrl?:string}>;
    const endpoint = targets.find((target) => target.type === "page")?.webSocketDebuggerUrl;
    if (!endpoint) throw new Error("Chromium did not expose a page target.");
    socket = new WebSocket(endpoint);
    await new Promise<void>((resolve, reject) => {
      socket!.addEventListener("open", () => resolve(), { once: true });
      socket!.addEventListener("error", () => reject(new Error("Chromium debugging connection failed.")), { once: true });
    });
    let id = 0;
    const pending = new Map<number, (result: any) => void>();
    socket.addEventListener("message", (event) => {
      const response = JSON.parse(String(event.data));
      if (typeof response.id === "number") {
        pending.get(response.id)?.(response);
        pending.delete(response.id);
      }
    });
    const command = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
      const next = ++id;
      pending.set(next, (response) => response.error ? reject(new Error(response.error.message)) : resolve(response.result));
      socket!.send(JSON.stringify({ id: next, method, params }));
    });
    const evaluate = async (expression: string): Promise<unknown> => {
      const response = await command("Runtime.evaluate", { expression, returnByValue: true });
      if (response.exceptionDetails) throw new Error("Chromium page evaluation failed.");
      return response.result?.value;
    };
    const waitFor = async (expression: string, label: string) => {
      const deadline = Date.now() + 12_000;
      while (Date.now() < deadline) {
        try { if (await evaluate(expression)) return; } catch { /* Navigation may reset the execution context. */ }
        await pause(200);
      }
      throw new Error(`SPA ${label} did not render before the browser deadline.`);
    };
    await command("Page.enable");
    await command("Runtime.enable");
    await command("Page.navigate", { url });
    await waitFor(`location.pathname === "/" && document.body.innerText.includes(${JSON.stringify(homeMarker)})`, "home");
    const clicked = await evaluate(`Boolean(document.querySelector('a[href="/about"]')?.click() ?? document.querySelector('a[href="/about"]'))`);
    if (!clicked) throw new Error("SPA has no clickable About link.");
    await waitFor(`location.pathname === "/about" && document.body.innerText.includes(${JSON.stringify(aboutMarker)})`, "client navigation");
    await command("Page.reload", { ignoreCache: true });
    await waitFor(`location.pathname === "/about" && document.body.innerText.includes(${JSON.stringify(aboutMarker)})`, "About refresh");
    return { home: true, click: true, refresh: true };
  } finally {
    socket?.close();
    if (chrome.pid) {
      try { process.kill(-chrome.pid, "SIGTERM"); } catch { /* Chromium may have exited already. */ }
    }
    if (chrome.exitCode === null && chrome.signalCode === null) {
      await new Promise<void>((resolve) => {
        chrome.once("exit", () => resolve());
        setTimeout(resolve, 2000);
      });
    }
    await pause(300);
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
        break;
      } catch (error) {
        if (attempt === 9) throw error;
        await pause(300);
      }
    }
  }
}