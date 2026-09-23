const MAX_PREVIEW_IMAGE_BYTES = 5_000_000;

export type BrowserRunBinding = {
  quickAction: (action: "screenshot", options: Record<string, unknown>) => Promise<Response>;
};

export async function capturePreviewImage(browser: BrowserRunBinding | undefined, url: string): Promise<Uint8Array> {
  if (!browser) throw new Error("Cloudflare Browser Rendering is not configured.");
  const response = await browser.quickAction("screenshot", {
    url,
    viewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
    gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
    waitForTimeout: 1_200,
    screenshotOptions: { type: "jpeg", quality: 85, fullPage: false, captureBeyondViewport: false },
  });
  if (!response.ok) throw new Error(`Preview screenshot failed with status ${response.status}.`);
  if (response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/jpeg") {
    throw new Error("Preview screenshot returned an unsupported format.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.byteLength > MAX_PREVIEW_IMAGE_BYTES) {
    throw new Error("Preview screenshot returned an invalid image.");
  }
  return bytes;
}

export function imageDataUri(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:image/jpeg;base64,${btoa(binary)}`;
}

export const previewImageKey = (slug: string) => `preview:${slug}`;