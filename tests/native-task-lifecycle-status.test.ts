import test from "node:test";
import assert from "node:assert/strict";
import { projectOwnerNativeTaskLifecycle } from "../cloudflare/staging/think-runtime";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { parseThinkOperationLimits, createThinkTaskOperation, recoverThinkTaskOperation } from
  "../production/vibesdk-launch/runtime-source/worker/agents/think/finish-task-tool";

test("owner status projects existing authoritative lifecycle without summary or credentials", () => {
  assert.deepEqual(projectOwnerNativeTaskLifecycle({
    status: "INCOMPLETE_RESOURCE_LIMIT", reason: "credit_limit", updatedAt: 1234,
    summary: "private summary", userId: "other-user", prompt: "private prompt", token: "private credential",
  }), { status: "INCOMPLETE_RESOURCE_LIMIT", reason: "credit_limit", updatedAt: 1234, customerStatus: "CONTINUE_AVAILABLE" });
});

test("owner lifecycle rejects malformed authoritative status rather than claiming idle completion", () => {
  for (const value of [null, {}, { status: "COMPLETE" }, { status: "wrong", updatedAt: 1 },
    { status: "COMPLETE", updatedAt: NaN }]) {
    assert.throws(() => projectOwnerNativeTaskLifecycle(value));
  }
  assert.equal(projectOwnerNativeTaskLifecycle(undefined), undefined);
});

test("unknown free-form resource reasons are not returned to owner", () => {
  assert.deepEqual(projectOwnerNativeTaskLifecycle({
    status: "INCOMPLETE_RESOURCE_LIMIT", reason: "arbitrary text", updatedAt: 1234,
  }), { status: "INCOMPLETE_RESOURCE_LIMIT", updatedAt: 1234, customerStatus: "STOPPED" });
});

test("owner customer status cannot contradict blocked, input, completion or account restriction facts", () => {
  const cases = [
    ["BLOCKED", "continuation_budget_exhausted", "STOPPED"],
    ["USER_INPUT_REQUIRED", undefined, "NEEDS_INPUT"],
    ["COMPLETE", undefined, "BUILD_COMPLETE"],
    ["RUNNING", undefined, "WORKING"],
    ["INCOMPLETE_RESOURCE_LIMIT", "available_credits_limit", "STOPPED"],
  ];
  for (const [status, reason, expected] of cases) {
    assert.equal(projectOwnerNativeTaskLifecycle({
      status, reason, updatedAt: 10, customerStatus: "BUILD_COMPLETE",
    })?.customerStatus, expected);
  }
});

test("owner diagnostic projection carries only bounded identities and explicit accounting", () => {
  const projected = projectOwnerNativeTaskLifecycle({
    status: "RUNNING", updatedAt: 10, taskId: "think-queue:T1", operationId: "think-approved:O2",
    accounting: { startedAt: 10, creditsUsed: 0, turnsUsed: 0, continuationsUsed: 0, modelCalls: 0, toolCalls: 0, privateData: "omit" },
    originalIntent: "omit", summary: "omit", userId: "omit",
  });
  assert.deepEqual(projected, {
    status: "RUNNING", updatedAt: 10, customerStatus: "WORKING",
    taskId: "think-queue:T1", operationId: "think-approved:O2",
    accounting: { startedAt: 10, creditsUsed: 0, turnsUsed: 0, continuationsUsed: 0, modelCalls: 0, toolCalls: 0 },
  });
});

test("a terminal native boundary is not offered while its host still has pending work", () => {
  assert.equal(projectOwnerNativeTaskLifecycle({
    status: "INCOMPLETE_RESOURCE_LIMIT", reason: "continuation_budget_exhausted",
    updatedAt: 10, approvalReady: false,
  })?.customerStatus, "WORKING");
  assert.equal(projectOwnerNativeTaskLifecycle({
    status: "COMPLETE", updatedAt: 10, approvalReady: false,
  })?.customerStatus, "WORKING", "an old completion must not become green while another request is queued");
});

// Execute the actual policy-update method, without loading the native SDK's
// Worker-incompatible shell dependency. Only its SDK config store is simulated.
function actualPolicyUpdater() {
  const source = readFileSync("production/vibesdk-launch/runtime-source/worker/agents/think/ThinkAgent.ts", "utf8");
  const ast = ts.createSourceFile("ThinkAgent.ts", source, ts.ScriptTarget.Latest, true);
  const nativeClass = ast.statements.find((node) => ts.isClassDeclaration(node) && node.name?.text === "ThinkAgent");
  assert(nativeClass && ts.isClassDeclaration(nativeClass));
  const method = nativeClass.members.find((node) =>
    ts.isMethodDeclaration(node) && node.name.getText(ast) === "configureOperationLimits");
  assert(method);
  const compiled = ts.transpileModule(`class PolicyUnderTest { ${method.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function("parseThinkOperationLimits", `${compiled}; return new PolicyUnderTest();`)(
    parseThinkOperationLimits,
  );
}

test("actual native policy method preserves provider/owner configuration and old operation, updates next operation", async () => {
  const updater = actualPolicyUpdater();
  let config: any = {
    userId: "fixture-owner",
    model: { headers: { Authorization: "fixture-provider-header" }, modelName: "fixture-model" },
    systemPrompt: "fixture-context", previewUrl: "https://fixture.invalid/preview/",
    operationLimits: { maxCredits: 100, maxContinuations: 4, maxElapsedMs: 900000 },
  };
  const original = structuredClone(config);
  const oldOperation = { ...createThinkTaskOperation("old", "conversation", config.operationLimits),
    modelCalls: 50, creditsConsumed: 100 };
  updater.getConfig = () => config;
  updater.configure = (next: any) => { config = next; };
  await updater.configureOperationLimits({ maxCredits: 250, maxContinuations: 4, maxElapsedMs: 900000 });
  assert.deepEqual(config.model, original.model);
  assert.equal(config.userId, original.userId);
  assert.equal(config.systemPrompt, original.systemPrompt);
  assert.equal(config.previewUrl, original.previewUrl);
  const recovered = recoverThinkTaskOperation(oldOperation, config.operationLimits);
  assert.equal(recovered.limits.maxCredits, 100);
  assert.equal(recovered.creditsConsumed, 100);
  assert.equal(createThinkTaskOperation("new", "new-conversation", config.operationLimits).limits.maxCredits, 250);
});

test("actual native policy update fails closed for absent config or invalid limits", async () => {
  const updater = actualPolicyUpdater();
  let writes = 0;
  updater.configure = () => { writes++; };
  updater.getConfig = () => undefined;
  await assert.rejects(updater.configureOperationLimits({ maxCredits: 250 }));
  updater.getConfig = () => ({ operationLimits: { maxCredits: 100 } });
  await assert.rejects(updater.configureOperationLimits({ maxCredits: Infinity }));
  assert.equal(writes, 0);
});