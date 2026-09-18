import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("project SEO form validates uploads and metadata before saving", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://buildcustom.test/projects/41",
  });
  const previousGlobals = new Map<string, unknown>();
  for (const key of [
    "window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement",
    "HTMLTextAreaElement", "File", "FileReader", "MutationObserver",
  ]) {
    previousGlobals.set(key, (globalThis as any)[key]);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: (dom.window as any)[key],
    });
  }

  const requests: Array<{ url: string; method: string; body: any }> = [];
  const initialSettings = {
    metaTitle: "",
    metaDescription: "",
    focusKeyword: "",
    schemaJson: "{}",
    faviconData: "",
    canonicalUrl: "",
    ogTitle: "",
    ogDescription: "",
    ogImageUrl: "",
    allowIndexing: true,
  };
  const initialPublishingSettings = {
    subdomainSlug: "",
    hostingProvider: "buildcustom",
    customDomain: "",
    customOrigin: "",
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    const method = init?.method || "GET";
    if (method === "PUT") {
      const body = JSON.parse(String(init?.body || "{}"));
      requests.push({ url, method, body });
      const responseBody = url.endsWith("/runtime/publishing-settings")
        ? { ...initialPublishingSettings, ...body, customDomain: "saved.example.com" }
        : { ...initialSettings, ...body };
      return new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    const responseBody = url.endsWith("/runtime/publishing-settings") ? initialPublishingSettings : initialSettings;
    return new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const React = await import("react");
  previousGlobals.set("React", (globalThis as any).React);
  Object.defineProperty(globalThis, "React", {
    configurable: true,
    writable: true,
    value: React,
  });
  const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
  const { render, fireEvent, screen, waitFor, cleanup } = await import("@testing-library/react");
  const { ThemeProvider } = await import("../client/src/contexts/theme-context");
  const { PublishingSettingsCard, SEOTab } = await import("../client/src/pages/project-detail");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  const withProviders = (child: React.ReactElement) => React.createElement(
    ThemeProvider,
    null,
    React.createElement(QueryClientProvider, { client: queryClient }, child),
  );

  try {
    const publishingView = render(withProviders(React.createElement(PublishingSettingsCard, { projectId: 41 })));
    const subdomain = await screen.findByTestId("settings-subdomain");
    fireEvent.change(subdomain, { target: { value: "My New Site!" } });
    fireEvent.click(screen.getByTestId("settings-use-custom-domain"));
    fireEvent.change(await screen.findByTestId("settings-custom-domain"), { target: { value: "draft.example.com" } });
    fireEvent.click(screen.getByText("Save publishing settings"));
    await screen.findByText("Publishing settings saved.");
    assert.deepEqual(requests[0], {
      url: "/api/projects/41/runtime/publishing-settings",
      method: "PUT",
      body: {
        subdomainSlug: "mynewsite",
        hostingProvider: "buildcustom",
        customDomain: "draft.example.com",
        customOrigin: "",
      },
    });
    await waitFor(() => assert.equal((screen.getByTestId("settings-custom-domain") as HTMLInputElement).value, "saved.example.com"));
    publishingView.unmount();
    queryClient.clear();

    const view = render(
      withProviders(React.createElement(SEOTab, { projectId: 41 })),
    );

    await screen.findByTestId("input-meta-title");
    const faviconInput = view.container.querySelector('input[type="file"]') as HTMLInputElement;
    const validFavicon = new dom.window.File(["favicon"], "favicon.png", { type: "image/png" });
    fireEvent.change(faviconInput, { target: { files: [validFavicon] } });
    const preview = await screen.findByAltText("Custom favicon preview") as HTMLImageElement;
    assert.match(preview.src, /^data:image\/png;base64,/);

    fireEvent.click(screen.getByTestId("button-save-meta"));
    await waitFor(() => assert.equal(requests.length, 2));
    assert.equal(requests[1].url, "/api/projects/41/seo");
    assert.equal(requests[1].body.metaTitle, "");
    assert.equal(requests[1].body.metaDescription, "");
    assert.match(requests[1].body.faviconData, /^data:image\/png;base64,/);

    const canonical = screen.getByTestId("input-canonical-url");
    fireEvent.change(canonical, { target: { value: "not a URL" } });
    fireEvent.click(screen.getByTestId("button-save-meta"));
    assert.equal((await screen.findByRole("alert")).textContent, "Enter a valid canonical URL.");
    assert.equal(requests.length, 2);

    fireEvent.change(canonical, { target: { value: "" } });
    fireEvent.change(screen.getByTestId("input-social-image-url"), { target: { value: "ftp://example.com/image.jpg" } });
    fireEvent.click(screen.getByTestId("button-save-meta"));
    assert.equal((await screen.findByRole("alert")).textContent, "Enter a valid social image URL.");
    assert.equal(requests.length, 2);
    await waitFor(
      () => assert.equal(screen.getByTestId("button-save-meta").textContent?.trim(), "Save Meta Tags"),
      { timeout: 3_000 },
    );

    const invalidFavicon = new dom.window.File(["plain text"], "favicon.txt", { type: "text/plain" });
    fireEvent.change(faviconInput, { target: { files: [invalidFavicon] } });
    assert.equal((await screen.findByText("Upload a PNG, ICO, SVG, or WebP favicon.")).textContent, "Upload a PNG, ICO, SVG, or WebP favicon.");

    fireEvent.click(screen.getByTestId("seo-tab-schema"));
    fireEvent.change(await screen.findByTestId("input-schema"), { target: { value: "{invalid" } });
    fireEvent.click(screen.getByTestId("button-save-schema"));
    assert.equal((await screen.findByRole("alert")).textContent, "Enter valid structured data as a JSON object.");
    assert.equal(requests.length, 2);
  } finally {
    cleanup();
    queryClient.clear();
    globalThis.fetch = originalFetch;
    // Node isolates test files in separate workers. Keep this worker's DOM globals
    // available for deferred React/animation cleanup scheduled during unmount.
  }
});
