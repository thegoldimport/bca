import { createOpenAI } from "@ai-sdk/openai";
import { describe, expect, it } from "vitest";
import { protectAiCredentialForStorage } from "../../../shared/ai-credential-crypto";
import type { BuildDiagnosticContext } from "./build-diagnostics";
import { createBuildProviderFetch } from "./build-provider-fetch";

const secret = "test-only-buildcustom-encryption-secret";
const apiKey = "sk-ant-test-only-credential";
const diagnostics: BuildDiagnosticContext = {
	attemptId: "attempt-test-1",
	projectId: 10,
	userId: "customer-1",
	agentId: "agent-10",
};

function makeDb() {
	const statements: Array<{ sql: string; values: unknown[] }> = [];
	const db = {
		prepare(sql: string) {
			const statement: { sql: string; values: unknown[]; bind: (...values: unknown[]) => any } = {
				sql,
				values: [],
				bind(...values: unknown[]) {
					this.values = values;
					return this;
				},
			};
			return statement;
		},
		async batch(batchStatements: Array<{ sql: string; values: unknown[] }>) {
			statements.push(...batchStatements.map(({ sql, values }) => ({ sql, values })));
			return [];
		},
		statements,
	};
	return db;
}

describe("BuildCustom provider fetch boundary", () => {
	it("decrypts only for the outbound request and records no credential or body", async () => {
		const { encryptedApiKey } = await protectAiCredentialForStorage(secret, apiKey);
		const db = makeDb();
		let captured: { input: RequestInfo; init?: RequestInit } | null = null;
		const fetcher = createBuildProviderFetch({
			model: {
				providerId: "anthropic",
				modelId: "anthropic/claude-haiku-5-5",
				encryptedApiKey,
			},
			db: db as unknown as D1Database,
			buildDiagnostics: diagnostics,
			encryptionSecret: secret,
			fetchImpl: async (input, init) => {
				captured = { input, init };
				return new Response("PRIVATE_PROVIDER_BODY", {
					status: 200,
					headers: { "cf-ray": "safe-ray-123" },
				});
			},
		});

		await fetcher("https://gateway.example/compat/chat/completions", {
			method: "POST",
			headers: {
				authorization: "Bearer placeholder",
				"cf-aig-authorization": "gateway-header",
			},
			body: "PRIVATE_PROMPT_BODY",
		});

		expect(captured).not.toBeNull();
		const capturedHeaders = new Headers(captured?.init?.headers);
		expect(capturedHeaders.get("authorization")).toBe(`Bearer ${apiKey}`);
		expect(capturedHeaders.get("cf-aig-authorization")).toBe("gateway-header");
		const written = JSON.stringify(db.statements);
		for (const privateValue of [apiKey, encryptedApiKey, "PRIVATE_PROVIDER_BODY", "PRIVATE_PROMPT_BODY"]) {
			expect(written).not.toContain(privateValue);
		}
		expect(written).toContain("provider_request_started");
		expect(written).toContain("provider_response_received");
	});

	it("fails closed when BYOK decryption cannot be performed and does not call the provider", async () => {
		const db = makeDb();
		let requests = 0;
		const fetcher = createBuildProviderFetch({
			model: {
				providerId: "anthropic",
				modelId: "anthropic/claude-haiku-5-5",
				encryptedApiKey: "not-valid-ciphertext",
			},
			db: db as unknown as D1Database,
			buildDiagnostics: diagnostics,
			fetchImpl: async () => {
				requests += 1;
				return new Response(null, { status: 200 });
			},
		});

		await expect(fetcher("https://gateway.example/compat/chat/completions"))
			.rejects.toThrow("The saved AI provider settings could not be applied.");
		expect(requests).toBe(0);
		expect(JSON.stringify(db.statements)).toContain("PROVIDER_CONFIG_FAILED");
		expect(JSON.stringify(db.statements)).not.toContain("not-valid-ciphertext");
	});

	it("records provider auth, billing, rate-limit, and unavailable responses without bodies", async () => {
		for (const [status, code] of [
			[401, "PROVIDER_AUTH_FAILED"],
			[402, "PROVIDER_BILLING_FAILED"],
			[429, "PROVIDER_RATE_LIMITED"],
			[503, "PROVIDER_UNAVAILABLE"],
		] as const) {
			const db = makeDb();
			const fetcher = createBuildProviderFetch({
				model: { providerId: "anthropic", modelId: "anthropic/claude-haiku-5-5" },
				db: db as unknown as D1Database,
				buildDiagnostics: diagnostics,
				fetchImpl: async () => new Response("PRIVATE_PROVIDER_BODY", { status }),
			});

			await fetcher("https://gateway.example/compat/chat/completions");
			const written = JSON.stringify(db.statements);
			expect(written).toContain(code);
			expect(written).toContain(String(status));
			expect(written).not.toContain("PRIVATE_PROVIDER_BODY");
		}
	});

	it("replaces network exceptions with a safe category and preserves stored-key header handling", async () => {
		const networkDb = makeDb();
		const networkFetch = createBuildProviderFetch({
			model: { providerId: "anthropic", modelId: "anthropic/claude-haiku-5-5" },
			db: networkDb as unknown as D1Database,
			buildDiagnostics: diagnostics,
			fetchImpl: async () => {
				throw new Error("PRIVATE_NETWORK_DETAIL");
			},
		});
		await expect(networkFetch("https://gateway.example/compat/chat/completions"))
			.rejects.toThrow("The runtime could not reach the AI provider.");
		expect(JSON.stringify(networkDb.statements)).toContain("PROVIDER_NETWORK_ERROR");
		expect(JSON.stringify(networkDb.statements)).not.toContain("PRIVATE_NETWORK_DETAIL");

		let authHeader: string | null = null;
		const storedKeyFetch = createBuildProviderFetch({
			model: { providerId: "anthropic", modelId: "anthropic/claude-haiku-5-5", useStoredKeys: true },
			db: makeDb() as unknown as D1Database,
			buildDiagnostics: diagnostics,
			fetchImpl: async (_input, init) => {
				const headers = new Headers(init?.headers);
				authHeader = headers.get("authorization");
				expect(headers.get("cf-aig-authorization")).toBe("gateway-header");
				return new Response(null, { status: 200 });
			},
		});
		await storedKeyFetch("https://gateway.example/compat/chat/completions", {
			headers: { authorization: "Bearer placeholder", "cf-aig-authorization": "gateway-header" },
		});
		expect(authHeader).toBeNull();
	});

	it("initializes the Anthropic chat model through the existing compatible adapter without calling a provider", () => {
		const model = createOpenAI({
			baseURL: "https://gateway.example/compat",
			apiKey: "test-only-placeholder",
			fetch: createBuildProviderFetch({
				model: { providerId: "anthropic", modelId: "anthropic/claude-haiku-5-5" },
				buildDiagnostics: diagnostics,
				fetchImpl: async () => {
					throw new Error("The model must not be invoked in this test.");
				},
			}),
		}).chat("claude-haiku-5-5");
		expect(model).toBeDefined();
		expect(model.modelId).toContain("claude-haiku-5-5");
	});
});
