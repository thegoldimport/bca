import assert from "node:assert/strict";
import test from "node:test";
import { handleProjectBuildActivityRoute } from "../cloudflare/build-activity-routes";

function makeEnv(ownerId = "owner-1") {
  const reads = { attempts: 0, events: 0, connections: 0 };
  const env = {
    DB: {
      prepare(sql: string) {
        let values: unknown[] = [];
        const statement = {
          bind(...args: unknown[]) {
            values = args;
            return statement;
          },
          async first() {
            return sql.includes("FROM projects WHERE id=? AND user_id=?")
              && Number(values[0]) === 10 && values[1] === ownerId ? { id: 10 } : null;
          },
          async all() {
            if (sql.includes("FROM native_build_attempts")) {
              reads.attempts += 1;
              return {
                results: [{
                  attempt_id: "attempt-uuid-1",
                  started_at_ms: 1_800_000_000_000,
                  finished_at_ms: 1_800_000_000_100,
                  status: "failed",
                  last_stage: "provider_response",
                  last_successful_stage: "provider_configuration",
                  failure_stage: "provider_response",
                  error_code: "PROVIDER_AUTH_FAILED",
                  customer_message: "The AI provider rejected the configured credentials.",
                  correlation_id: "attempt-uuid-1",
                  provider: "anthropic",
                  model_id: "anthropic/claude-haiku-5-5",
                  encrypted_api_key: "PRIVATE_ENCRYPTED_KEY",
                  raw_error: "PRIVATE_RAW_PROVIDER_BODY",
                  prompt: "PRIVATE_PROMPT",
                }],
              };
            }
            if (sql.includes("FROM native_build_events")) {
              reads.events += 1;
              return {
                results: [{
                  id: "event-1",
                  attempt_id: "attempt-uuid-1",
                  occurred_at_ms: 1_800_000_000_050,
                  event_type: "provider_response_received",
                  stage: "provider_response",
                  status: "error",
                  error_code: "PROVIDER_AUTH_FAILED",
                  customer_message: "The AI provider rejected the configured credentials.",
                  correlation_id: "attempt-uuid-1",
                  provider_status: 401,
                  raw_error: "PRIVATE_RAW_PROVIDER_BODY",
                  api_key: "PRIVATE_API_KEY",
                }],
              };
            }
            if (sql.includes("FROM native_connection_attempts")) {
              reads.connections += 1;
              return {
                results: [{
                  attempt_id: "connection-attempt-1",
                  started_at_ms: 1_800_000_000_000,
                  finished_at_ms: 1_800_000_000_100,
                  status: "failed",
                  stage: "ai_settings_refresh",
                  http_status: 403,
                  error_code: "NATIVE_AI_CONFIG_REFRESH_REJECTED",
                  correlation_id: "ray-reference-1",
                  timeout_reason: null,
                  last_completed_stage: "project_link_check",
                  cookie: "PRIVATE_COOKIE",
                  csrf: "PRIVATE_CSRF",
                }],
              };
            }
            return { results: [] };
          },
        };
        return statement;
      },
    },
  };
  return { env: env as any, reads };
}

test("build activity returns not-found for a different customer and does not read diagnostics", async () => {
  const { env, reads } = makeEnv("customer-1");
  const response = await handleProjectBuildActivityRoute(
    env,
    new Request("https://app.buildcustom.ai/api/projects/10/build-activity"),
    "customer-2",
  );

  assert.equal(response?.status, 404);
  assert.deepEqual(reads, { attempts: 0, events: 0, connections: 0 });
});

test("build activity returns persistent customer-safe events without provider secrets or source", async () => {
  const { env, reads } = makeEnv();
  const response = await handleProjectBuildActivityRoute(
    env,
    new Request("https://app.buildcustom.ai/api/projects/10/build-activity"),
    "owner-1",
  );

  assert.equal(response?.status, 200);
  const body = await response!.json() as any;
  assert.equal(body.attempts[0].errorCode, "PROVIDER_AUTH_FAILED");
  assert.equal(body.attempts[0].lastSuccessfulStage, "provider_configuration");
  assert.equal(body.attempts[0].events[0].message, "The AI provider rejected the configured credentials.");
  assert.equal(body.attempts[0].provider, undefined);
  assert.equal(body.attempts[0].modelId, undefined);
  assert.equal(body.attempts[0].events[0].providerStatus, undefined);
  assert.equal(body.connections[0].stage, "ai_settings_refresh");
  assert.equal(body.connections[0].httpStatus, 403);
  assert.equal(body.connections[0].lastCompletedStage, "project_link_check");
  assert.equal(body.connections[0].cookie, undefined);
  assert.equal(body.connections[0].csrf, undefined);
  assert.deepEqual(reads, { attempts: 1, events: 1, connections: 1 });
  const serialized = JSON.stringify(body);
  for (const privateValue of [
    "PRIVATE_ENCRYPTED_KEY",
    "PRIVATE_RAW_PROVIDER_BODY",
    "PRIVATE_PROMPT",
    "PRIVATE_API_KEY",
    "anthropic/claude-haiku-5-5",
    "PRIVATE_COOKIE",
    "PRIVATE_CSRF",
  ]) assert.equal(serialized.includes(privateValue), false, `customer response must omit ${privateValue}`);
});

test("build activity is read-only", async () => {
  const { env } = makeEnv();
  const response = await handleProjectBuildActivityRoute(
    env,
    new Request("https://app.buildcustom.ai/api/projects/10/build-activity", { method: "DELETE" }),
    "owner-1",
  );
  assert.equal(response?.status, 405);
});
