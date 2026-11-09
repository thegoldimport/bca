import { describe, expect, it } from "vitest";
import {
	classifyGatewayStatus,
	latestBuildErrorCode,
	recordBuildEvent,
	safeBuildError,
	startBuildAttempt,
	type BuildDiagnosticDatabase,
} from "./build-diagnostics";

function makeDb() {
	const statements: Array<{ sql: string; values: unknown[] }> = [];
	let latestError: string | null = "PROVIDER_AUTH_FAILED";
	const db = {
		prepare(sql: string) {
			const statement: { sql: string; values: unknown[]; bind: (...values: unknown[]) => any; first: <T>() => Promise<T | null> } = {
				sql,
				values: [],
				bind(...values: unknown[]) {
					this.values = values;
					return this;
				},
				async first<T>() {
					if (sql.includes("runtime_project_links")) {
						return { project_id: 10, user_id: "customer-1" } as T;
					}
					if (sql.includes("native_build_events")) {
						return (latestError ? { error_code: latestError } : null) as T | null;
					}
					return null;
				},
			};
			return statement;
		},
		async batch(batchStatements: Array<{ sql: string; values: unknown[] }>) {
			statements.push(...batchStatements.map((statement) => ({
				sql: statement.sql,
				values: statement.values,
			})));
			return [];
		},
		setLatestError(value: string | null) {
			latestError = value;
		},
		statements,
	};
	return db;
}

describe("native build diagnostics", () => {
	it("creates an owner-scoped attempt with only generated identifiers and timestamps", async () => {
		const db = makeDb();
		const context = await startBuildAttempt(db as unknown as BuildDiagnosticDatabase, {
			userId: "customer-1",
			agentId: "agent-10",
		});

		expect(context).toMatchObject({ projectId: 10, userId: "customer-1", agentId: "agent-10" });
		expect(context?.attemptId).toMatch(/^[0-9a-f-]{36}$/i);
		expect(db.statements).toHaveLength(3);
		expect(db.statements.map((statement) => statement.sql).join("\n")).toContain("agent_connection_established");
		expect(db.statements.map((statement) => statement.sql).join("\n")).toContain("build_request_received");
		expect(JSON.stringify(db.statements)).not.toContain("prompt");
	});

	it("persists allowlisted event fields and replaces arbitrary provider text with a fixed explanation", async () => {
		const db = makeDb();
		const context = await startBuildAttempt(db as unknown as BuildDiagnosticDatabase, {
			userId: "customer-1",
			agentId: "agent-10",
		});
		await recordBuildEvent(db as unknown as BuildDiagnosticDatabase, context, {
			eventType: "provider_response_received",
			stage: "provider_response",
			status: "error",
			errorCode: "PROVIDER_AUTH_FAILED",
			provider: "Anthropic",
			modelId: "anthropic/claude-haiku-5-5",
providerStatus: 401,
			correlationId: "ray_1234",
		});

		const written = db.statements.at(-1)!;
		expect(written.values).toContain("PROVIDER_AUTH_FAILED");
		expect(written.values).toContain("The AI provider rejected the configured credentials. Check your provider settings.");
		expect(written.values).toContain(401);
		expect(JSON.stringify(written.values)).not.toContain("claude-haiku");
		expect(JSON.stringify(written.values)).not.toContain("PRIVATE_PROMPT");
	});

	it("maps provider gateway status without retaining response text", () => {
		expect(classifyGatewayStatus(401)).toBe("PROVIDER_AUTH_FAILED");
		expect(classifyGatewayStatus(402)).toBe("PROVIDER_BILLING_FAILED");
		expect(classifyGatewayStatus(429)).toBe("PROVIDER_RATE_LIMITED");
		expect(classifyGatewayStatus(503)).toBe("PROVIDER_UNAVAILABLE");
		expect(classifyGatewayStatus(200)).toBeNull();
		expect(classifyGatewayStatus(999)).toBeNull();
		expect(safeBuildError("PROVIDER_CONFIG_FAILED").message).toContain("No other provider was used");
	});

	it("returns only known provider failure codes for the current attempt", async () => {
		const db = makeDb();
		const context = await startBuildAttempt(db as unknown as BuildDiagnosticDatabase, {
			userId: "customer-1",
			agentId: "agent-10",
		});
		expect(await latestBuildErrorCode(db as unknown as BuildDiagnosticDatabase, context)).toBe("PROVIDER_AUTH_FAILED");
		db.setLatestError("PRIVATE_RAW_PROVIDER_BODY");
		expect(await latestBuildErrorCode(db as unknown as BuildDiagnosticDatabase, context)).toBeNull();
	});
});
