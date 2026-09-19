import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

test("Cloudflare migration review shows the DNS checklist before nameserver setup", async () => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://buildcustom.test/projects/41",
  });
  const previousGlobals = new Map<string, unknown>();
  for (const key of [
    "window", "document", "navigator", "localStorage", "HTMLElement", "HTMLInputElement",
    "MutationObserver",
  ]) {
    previousGlobals.set(key, (globalThis as any)[key]);
    Object.defineProperty(globalThis, key, {
      configurable: true,
      writable: true,
      value: (dom.window as any)[key],
    });
  }

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith("/runtime/custom-domain/inspect") && init?.method === "POST") {
      return new Response(JSON.stringify({
        hostname: "example.com",
        records: [
          { name: "example.com", type: "A", value: "192.0.2.10" },
          { name: "example.com", type: "MX", value: "10 mail.example.com" },
          { name: "_legacy.example.com", type: "TXT", value: "legacy-verification" },
        ],
        replacementPlan: {
          records: [
            {
              name: "example.com",
              type: "A",
              value: "192.0.2.10",
              action: "replace",
              reason: "This record currently serves the old website.",
            },
            {
              name: "example.com",
              type: "MX",
              value: "10 mail.example.com",
              action: "keep",
              reason: "Keep this record so email continues working.",
              proxyGuidance: "dns_only",
            },
            {
              name: "_legacy.example.com",
              type: "TXT",
              value: "legacy-verification",
              action: "review",
              reason: "Confirm whether this verification record is still needed.",
            },
          ],
        },
        proposedRecords: [
          { name: "example.com", type: "CNAME", value: "project.buildcustom.app" },
          { name: "www.example.com", type: "CNAME", value: "project.buildcustom.app" },
        ],
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({
      hostname: "",
      status: null,
      managedUrl: "https://project.buildcustom.app",
      canConnect: true,
      migration: {},
    }), {
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
  const { render, fireEvent, screen, within, cleanup } = await import("@testing-library/react");
  const { ThemeProvider } = await import("../client/src/contexts/theme-context");
  const { DomainTab } = await import("../client/src/pages/project-detail");
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { retry: false, gcTime: 0 },
    },
  });

  try {
    render(
      React.createElement(
        ThemeProvider,
        null,
        React.createElement(
          QueryClientProvider,
          { client: queryClient },
          React.createElement(DomainTab, {
            projectId: 41,
            runtimeStatus: { deploymentUrl: "https://project.buildcustom.app" },
          }),
        ),
      ),
    );

    const hostnameInput = await screen.findByTestId("input-custom-domain");
    assert.ok(screen.getByText("App/login domain"));
    assert.ok(screen.getByText(/Add the CNAME record we provide/));
    assert.ok(screen.getByTestId("input-app-domain"));
    fireEvent.change(hostnameInput, { target: { value: "example.com" } });
    fireEvent.click(screen.getByTestId("button-connect-domain"));

    const checklist = (await screen.findByText("What to keep and what to change")).parentElement?.parentElement;
    assert.ok(checklist);
    const review = within(checklist);

    assert.ok(review.getByText("Replace for your website"));
    assert.ok(review.getByText("192.0.2.10"));
    assert.ok(review.getByText("Keep exactly as they are"));
    assert.ok(review.getByText("10 mail.example.com"));
    assert.ok(review.getByText("Ask your provider if unsure"));
    assert.ok(review.getByText("legacy-verification"));
    assert.ok(review.getByText("Cloudflare: set Proxy status to DNS only."));
    assert.ok(review.getByText("Proposed BuildCustom website records"));
    assert.ok(review.getAllByText("example.com").length >= 2);
    assert.ok(review.getByText("www.example.com"));

    const continueButton = screen.getByRole("button", { name: "Continue to nameservers" }) as HTMLButtonElement;
    assert.equal(continueButton.disabled, true);

    fireEvent.click(screen.getByRole("checkbox", {
      name: "I reviewed Cloudflare’s scan and confirmed that my website and email records are present.",
    }));
    assert.equal(continueButton.disabled, false);
  } finally {
    cleanup();
    queryClient.clear();
    globalThis.fetch = originalFetch;
    // Node isolates test files in separate workers. Keep this worker's DOM globals
    // available for deferred React cleanup scheduled during unmount.
  }
});