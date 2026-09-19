const MAX_PREVIEW_IMAGE_BYTES = 5_000_000;

export async function captureProjectPreviewImage(url: string) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) throw new Error("Cloudflare Browser Rendering is not configured.");

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/browser-rendering/screenshot?cacheTTL=0`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        viewport: { width: 1200, height: 630, deviceScaleFactor: 1 },
        gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
        waitForTimeout: 1_200,
        screenshotOptions: {
          type: "jpeg",
          quality: 85,
          fullPage: false,
          captureBeyondViewport: false,
        },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  if (!response.ok) throw new Error(`Preview screenshot failed with status ${response.status}.`);
  const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "image/jpeg") throw new Error("Preview screenshot returned an unsupported format.");
  const image = Buffer.from(await response.arrayBuffer());
  if (!image.length || image.length > MAX_PREVIEW_IMAGE_BYTES) throw new Error("Preview screenshot returned an invalid image.");
  return `data:image/jpeg;base64,${image.toString("base64")}`;
}