import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as operationHelpers from "../production/vibesdk-launch/runtime-source/worker/agents/think/finish-task-tool";
import * as continuationHelpers from "../production/vibesdk-launch/runtime-source/worker/agents/think/user-approved-continuation";
import { selectThinkContextMessages } from "../production/vibesdk-launch/runtime-source/worker/agents/think/context-selector";
import { allowedNativeClientFrame } from "../cloudflare/staging/think-runtime";

const limits = { maxContinuations: 4, maxCredits: 250, maxElapsedMs: 900000, maxModelCalls: 650, maxToolCalls: 1300 };
const boundary = { status: "INCOMPLETE_RESOURCE_LIMIT" as const, reason: "continuation_budget_exhausted", summary: "diagnostic", updatedAt: 1 };

// Sandboxed storage/service adapters executing the actual production methods.
// No real runtime attachment, credentials, generated-project inspection or AI.
function nativeFixture() {
  const source = readFileSync("production/vibesdk-launch/runtime-source/worker/agents/think/ThinkAgent.ts", "utf8");
  const ast = ts.createSourceFile("ThinkAgent.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "ThinkAgent") as ts.ClassDeclaration;
  assert.ok(declaration);
  const wanted = new Set(["approveTaskContinuation", "beginTask", "getTaskLifecycle", "getTaskOperation", "getTaskLifecycleSnapshot"]);
  const methods = declaration.members.filter(node => ts.isMethodDeclaration(node) && wanted.has(node.name.getText(ast)));
  assert.equal(methods.length, wanted.size);
  const keys = declaration.members.filter(node => ts.isPropertyDeclaration(node) && /^task.*Key$/.test(node.name.getText(ast)));
  const body = [...keys, ...methods].map(node => node.getText(ast)).join("\n");
  const dependencies = { ...operationHelpers, ...continuationHelpers };
  const compiled = ts.transpileModule(`return class NativeFixture { ${body} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const Fixture = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const native = new Fixture();
  const store = new Map<string, unknown>();
  native.ctx = { storage: { kv: {
    get: (key: string) => structuredClone(store.get(key)),
    put: (key: string, value: unknown) => store.set(key, structuredClone(value)),
  } } };
  native.putTaskDiagnostic = native.ctx.storage.kv.put;
  native.getConfig = () => ({ operationLimits: limits });
  const workspace = { revision: "current-O1-revision", files: new Map([["app.ts", "O1 latest edits"]]) };
  native.getMessages = async () => [{ role: "user", content: "Fix CRM persistence and activity ordering." }];
  native.readCurrentRevisionEvidence = async () => ({
    headCommitHash: workspace.revision, workingTreeClean: true, workspaceStatusFingerprint: "latest-workspace",
  });
  const previous = {
    ...operationHelpers.createThinkTaskOperation("think-queue:O1", "same-conversation", limits),
    customerTaskId: "think-queue:T1", originalIntent: "Fix CRM persistence and activity ordering.",
    creditsConsumed: 250, completedPassCount: 5, continuationCount: 4,
    modelCalls: 98, toolCalls: 94, startedAt: 1, resourceLimitReason: "continuation_budget_exhausted" as const,
  };
  store.set("think_task_operation", previous);
  store.set("think_task_lifecycle", boundary);
  store.set("think_task_evidence", { preflightSucceeded: true, headCommitHash: workspace.revision });
  return { native, store, workspace, previous, approval: { taskId: previous.customerTaskId, operationId: previous.taskId } };
}

function hostFixture(native: ReturnType<typeof nativeFixture>["native"]) {
  const source = readFileSync("production/vibesdk-launch/runtime-source/worker/agents/core/behaviors/think.ts", "utf8");
  const ast = ts.createSourceFile("think.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isClassDeclaration(node)) as ts.ClassDeclaration;
  const method = declaration.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(ast) === "handleUserInput");
  assert.ok(method);
  const dependencies = { ...continuationHelpers, IdGenerator: { generateConversationId: () => "new-customer-queue-item" } };
  const compiled = ts.transpileModule(`return class HostFixture { ${method.getText(ast)} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const Fixture = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const host = new Fixture();
  host.state = { pendingUserInputs: [] };
  host.queueIds = [];
  host.getThinkStub = async () => native;
  host.isCodeGenerating = () => false;
  host.getPendingTaskQueueIds = () => host.queueIds;
  host.setThinkPendingInputs = (messages: string[], ids: string[]) => {
    host.state.pendingUserInputs = messages;
    host.queueIds = ids;
  };
  return host;
}

test("actual host queues the approved native identity exactly once across a double click", async () => {
  const { native, approval } = nativeFixture();
  const host = hostFixture(native);
  await Promise.all([host.handleUserInput("Continue", undefined, approval), host.handleUserInput("Continue", undefined, approval)]);
  assert.equal(host.queueIds.length, 1);
  assert.ok(host.queueIds[0].startsWith("think-approved:"));
  assert.deepEqual(host.state.pendingUserInputs, [continuationHelpers.APPROVED_CONTINUATION_PROMPT]);
  assert.equal((await native.getTaskOperation()).taskId, approval.operationId);
});

test("actual host conversational yes uses the same native approval and bounded queue action", async () => {
  const { native } = nativeFixture();
  const host = hostFixture(native);
  await host.handleUserInput("yes");
  assert.equal(host.queueIds.length, 1);
  assert.ok(host.queueIds[0].startsWith("think-approved:"));
  assert.deepEqual(host.state.pendingUserInputs, [continuationHelpers.APPROVED_CONTINUATION_PROMPT]);
});

test("actual host yes without pending continuation remains a normal customer message", async () => {
  const { native, store } = nativeFixture();
  store.set("think_task_lifecycle", { status: "COMPLETE", updatedAt: 2 });
  const host = hostFixture(native);
  await host.handleUserInput("yes");
  assert.deepEqual(host.queueIds, ["new-customer-queue-item"]);
  assert.deepEqual(host.state.pendingUserInputs, ["yes"]);
  assert.equal([...store.keys()].filter(key => key.startsWith("think_approved_start:")).length, 0);
});

test("actual native approval reserves one deterministic next operation across concurrent double click", async () => {
  const { native, approval, store } = nativeFixture();
  const results = await Promise.all([native.approveTaskContinuation(approval), native.approveTaskContinuation(approval)]);
  assert.equal(results[0].operationId, results[1].operationId);
  assert.equal([...store.keys()].filter(key => key.startsWith("think_approved_start:")).length, 1);
  assert.equal((await native.getTaskOperation()).taskId, approval.operationId, "reservation alone does not start or reset work");
});

test("actual beginTask preserves workspace, task, history, intent and relevant prior verification with fresh bounded accounting", async () => {
  const { native, approval, store, workspace, previous } = nativeFixture();
  const accepted = await native.approveTaskContinuation(approval);
  const next = await native.beginTask(accepted.operationId, "must-not-replace-conversation", "Continue");
  assert.equal(next.customerTaskId, previous.customerTaskId);
  assert.equal(next.parentOperationId, previous.taskId);
  assert.equal(next.conversationId, previous.conversationId);
  assert.equal(next.originalIntent, previous.originalIntent);
  assert.equal(next.startingHead, workspace.revision);
  assert.equal(workspace.files.get("app.ts"), "O1 latest edits");
  assert.equal((await native.getMessages())[0].content, previous.originalIntent);
  assert.deepEqual(next.limits, limits);
  for (const key of ["creditsConsumed", "modelCalls", "toolCalls", "completedPassCount", "continuationCount"]) assert.equal(next[key], 0);
  assert.ok(next.startedAt > previous.startedAt);
  assert.equal(next.resourceLimitReason, undefined);
  assert.equal(next.resourceLimitAt, undefined);
  assert.deepEqual(store.get(`think_completed_task:${previous.taskId}`), previous);
  assert.equal((store.get(`think_completed_evidence:${previous.taskId}`) as any).headCommitHash, workspace.revision);
  assert.equal((await native.getTaskLifecycle()).status, "RUNNING");
  const retry = await native.approveTaskContinuation(approval);
  assert.equal(retry.operationId, next.taskId);
  assert.equal(retry.alreadyStarted, true);
  const replay = await native.beginTask(next.taskId, "ignored-on-retry");
  assert.equal(replay.startedAt, next.startedAt, "retry must not reset the elapsed window");
});

test("actual second customer approval starts another bounded session for the original task", async () => {
  const { native, approval, store } = nativeFixture();
  const accepted = await native.approveTaskContinuation(approval);
  const second = await native.beginTask(accepted.operationId, "unused");
  store.set("think_task_lifecycle", boundary);
  const thirdApproval = { taskId: second.customerTaskId, operationId: second.taskId };
  const thirdReservation = await native.approveTaskContinuation(thirdApproval);
  const third = await native.beginTask(thirdReservation.operationId, "unused");
  assert.notEqual(third.taskId, second.taskId);
  assert.equal(third.customerTaskId, approval.taskId);
  assert.equal(third.parentOperationId, second.taskId);
  assert.equal(third.creditsConsumed, 0);
  assert.equal(third.continuationCount, 0);
});

test("fresh approved work uses current configured ceilings without rewriting the prior operation", async () => {
  const { native, approval, store } = nativeFixture();
  const previous = store.get("think_task_operation") as operationHelpers.ThinkTaskOperation;
  previous.limits.maxCredits = 100;
  store.set("think_task_operation", previous);
  const accepted = await native.approveTaskContinuation(approval);
  const next = await native.beginTask(accepted.operationId, "unused");
  assert.deepEqual(next.limits, limits);
  assert.equal((store.get(`think_completed_task:${previous.taskId}`) as operationHelpers.ThinkTaskOperation).limits.maxCredits, 100);
});

test("actual native approval fails closed for input, completed, blocked, running, account limit and different task", async () => {
  for (const status of ["COMPLETE", "BLOCKED", "USER_INPUT_REQUIRED", "RUNNING"]) {
    const { native, approval, store } = nativeFixture();
    store.set("think_task_lifecycle", { ...boundary, status });
    await assert.rejects(native.approveTaskContinuation(approval));
    assert.equal([...store.keys()].filter(key => key.startsWith("think_approved_start:")).length, 0);
  }
  const { native, approval, store } = nativeFixture();
  store.set("think_task_lifecycle", { ...boundary, reason: "available_credits_limit" });
  await assert.rejects(native.approveTaskContinuation(approval));
  await assert.rejects(native.approveTaskContinuation({ ...approval, taskId: "another-owner-task" }));
});

test("new customer task uses existing new-message identity and prevents old continuation replay", async () => {
  const { native, approval } = nativeFixture();
  const replacement = await native.beginTask("think-queue:new-direction", "new-conversation", "Actually add settings instead.");
  assert.equal(replacement.customerTaskId, replacement.taskId);
  assert.equal(replacement.originalIntent, "Actually add settings instead.");
  await assert.rejects(native.approveTaskContinuation(approval));
});

test("approved prompt retains original customer request through the actual context selector", () => {
  const original = { role: "user" as const, content: "Fix CRM persistence and activity ordering." };
  const messages = [
    { role: "system" as const, content: "System instructions" }, original,
    ...Array.from({ length: 45 }, (_, index) => ({ role: "assistant" as const, content: `Progress ${index}` })),
    { role: "user" as const, content: continuationHelpers.APPROVED_CONTINUATION_PROMPT },
  ];
  const selected = selectThinkContextMessages(messages);
  assert.ok(selected.includes(original));
  assert.ok(selected.some(message => message.content === continuationHelpers.APPROVED_CONTINUATION_PROMPT));
});

test("owner bridge permits only bounded continuation identities and rejects mixed new direction or image context", () => {
  const approved = { type: "user_suggestion", message: "Continue", continuationApproval: { taskId: "think-queue:T1", operationId: "think-queue:O1" } };
  assert.deepEqual(allowedNativeClientFrame({ ...approved, agentId: "cannot-override-owner", token: "discard" }), approved);
  assert.equal(allowedNativeClientFrame({ ...approved, message: "Actually add settings instead." }), null);
  assert.equal(allowedNativeClientFrame({ ...approved, continuationApproval: { taskId: "x".repeat(257), operationId: "O1" } }), null);
  assert.equal(allowedNativeClientFrame({ ...approved, images: [{}] }), null);
});