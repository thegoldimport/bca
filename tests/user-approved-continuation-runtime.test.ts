import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import * as operationHelpers from "../production/vibesdk-launch/runtime-source/worker/agents/think/finish-task-tool";
import * as continuationHelpers from "../production/vibesdk-launch/runtime-source/worker/agents/think/user-approved-continuation";
import { selectThinkContextMessages } from "../production/vibesdk-launch/runtime-source/worker/agents/think/context-selector";
import { allowedNativeClientFrame } from "../cloudflare/staging/think-runtime";

const limits = { maxContinuations: 4, maxCredits: 250, maxElapsedMs: 900000, maxModelCalls: 650, maxToolCalls: 1300 };
const boundary = { status: "INCOMPLETE_RESOURCE_LIMIT" as const, reason: "continuation_budget_exhausted", summary: "diagnostic", updatedAt: 1 };
let accountDenied = false;

// Sandboxed storage/service adapters executing the actual production methods.
// No real runtime attachment, credentials, generated-project inspection or AI.
function nativeFixture() {
  const source = readFileSync("production/vibesdk-launch/runtime-source/worker/agents/think/ThinkAgent.ts", "utf8");
  const ast = ts.createSourceFile("ThinkAgent.ts", source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "ThinkAgent") as ts.ClassDeclaration;
  assert.ok(declaration);
  const wanted = new Set(["approveTaskContinuation", "beginTask", "getTaskLifecycle", "getTaskOperation", "getTaskLifecycleSnapshot", "setTaskAutoContinue", "assertAutoAuthorization"]);
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
  const methods = declaration.members.filter(node => ts.isMethodDeclaration(node)
    && ["handleUserInput", "setTaskAutoContinue", "disableTaskAutoContinue", "continueAutomatically", "build"].includes(node.name.getText(ast)));
  assert.equal(methods.length, 5);
  const dependencies = {
    ...continuationHelpers,
    createThinkTaskQueueIdentity: (ids: string[]) => "think-queue:" + ids.join(":"),
    IdGenerator: { generateConversationId: () => "new-customer-queue-item" },
    checkUsageAndBalance: async () => ({ allowed: !accountDenied }),
    WebSocketMessageResponses: { ERROR: "error" },
  };
  const compiled = ts.transpileModule(`return class HostFixture { ${methods.map(method => method.getText(ast)).join("\n")} }`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const Fixture = new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
  const host = new Fixture();
  host.state = { pendingUserInputs: [], metadata: { userId: "sandbox-owner" } };
  host.queueIds = [];
  host.getThinkStub = async () => native;
  host.isCodeGenerating = () => false;
  host.broadcast = () => {};
  host.setState = (state: any) => { host.state = state; };
  host.env = {};
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

test("task Auto Continue defaults OFF, persists toggles, and audits authoritative changes", async () => {
  const { native, approval, store } = nativeFixture();
  assert.equal((await native.getTaskLifecycle()).autoContinue.enabled, false);
  const enabled = await native.setTaskAutoContinue(approval.taskId, true);
  assert.equal((await native.getTaskLifecycleSnapshot()).lifecycle.autoContinue.enabled, true);
  assert.deepEqual(await native.setTaskAutoContinue(approval.taskId, true), enabled, "duplicate save does not duplicate authorization");
  const disabled = await native.setTaskAutoContinue(approval.taskId, false);
  assert.ok(disabled.version > enabled.version);
  assert.equal([...store.keys()].filter(key => key.startsWith("think_auto_continue_audit:")).length, 2);
  await assert.rejects(native.setTaskAutoContinue("foreign-task", true));
});

test("Auto Continue OFF leaves the natural boundary unchanged", async () => {
  const { native, store } = nativeFixture();
  const host = hostFixture(native);
  await host.continueAutomatically();
  assert.deepEqual(host.queueIds, []);
  assert.equal([...store.keys()].filter(key => key.startsWith("think_customer_approval:")).length, 0);
});

test("automatic approvals use the same native transition, preserving context with fresh O2 and O3", async () => {
  const { native, approval, store } = nativeFixture();
  const host = hostFixture(native);
  await native.setTaskAutoContinue(approval.taskId, true);
  const original = await native.getTaskOperation();
  for (let i = 0; i < 2; i++) {
    const previous = await native.getTaskOperation();
    await host.continueAutomatically();
    assert.equal(host.queueIds.length, 1);
    const next = await native.beginTask(host.queueIds[0], "must-not-create-another-conversation");
    assert.notEqual(next.taskId, previous.taskId);
    assert.equal(next.customerTaskId, approval.taskId);
    assert.equal(next.conversationId, original.conversationId);
    assert.equal(next.originalIntent, original.originalIntent);
    assert.equal(next.startingHead, "current-O1-revision");
    assert.ok(next.startedAt > original.startedAt);
    assert.equal(next.creditsConsumed, 0);
    assert.equal(next.completedPassCount, 0);
    assert.equal(next.continuationCount, 0);
    assert.deepEqual(next.limits, limits);
    const receipt = store.get(`think_customer_approval:${previous.taskId}`);
    assert.equal(receipt.source, "auto");
    assert.equal(receipt.operationId, next.taskId);
    host.setThinkPendingInputs([], []);
    store.set("think_task_lifecycle", { ...boundary, updatedAt: Date.now() });
  }
});

for (const status of ["COMPLETE", "USER_INPUT_REQUIRED", "BLOCKED", "RUNNING"]) {
  test(`Auto Continue does not approve ${status}`, async () => {
    const { native, approval, store } = nativeFixture();
    const host = hostFixture(native);
    await native.setTaskAutoContinue(approval.taskId, true);
    store.set("think_task_lifecycle", { ...boundary, status });
    await host.continueAutomatically();
    assert.deepEqual(host.queueIds, []);
    assert.equal([...store.keys()].filter(key => key.startsWith("think_customer_approval:")).length, 0);
  });
}

test("automatic approval enforces genuine account admission and stops authorization on failure", async () => {
  const { native, approval, store } = nativeFixture();
  const host = hostFixture(native);
  await native.setTaskAutoContinue(approval.taskId, true);
  accountDenied = true;
  try { await host.continueAutomatically(); } finally { accountDenied = false; }
  assert.deepEqual(host.queueIds, []);
  assert.equal((await native.getTaskLifecycle()).autoContinue.enabled, false);
  assert.equal([...store.keys()].filter(key => key.startsWith("think_customer_approval:")).length, 0);
});

test("disable cancels an unstarted automatic reservation but leaves manual Continue usable", async () => {
  const { native, approval, store } = nativeFixture();
  const preference = await native.setTaskAutoContinue(approval.taskId, true);
  const automatic = await native.approveTaskContinuation({ ...approval, source: "auto", preauthorizationVersion: preference.version });
  await native.setTaskAutoContinue(approval.taskId, false);
  await assert.rejects(native.beginTask(automatic.operationId, "same-conversation"), /no longer enabled/);
  assert.equal((await native.getTaskOperation()).taskId, approval.operationId);
  const manual = await native.approveTaskContinuation(approval);
  const next = await native.beginTask(manual.operationId, "same-conversation");
  assert.notEqual(next.taskId, approval.operationId);
  assert.equal(store.get(`think_customer_approval:${approval.operationId}`).source, "manual");
});

test("new substantive direction disables old authorization and supersedes unstarted approvals", async () => {
  const { native, approval } = nativeFixture();
  const host = hostFixture(native);
  await native.setTaskAutoContinue(approval.taskId, true);
  await host.continueAutomatically();
  await host.handleUserInput("Actually build the settings page instead");
  assert.equal((await native.getTaskLifecycle()).autoContinue.enabled, false);
  assert.deepEqual(host.queueIds, ["new-customer-queue-item"]);
  assert.deepEqual(host.state.pendingUserInputs, ["Actually build the settings page instead"]);
});

test("manual/auto race and duplicate automatic event reserve and queue exactly one next operation", async () => {
  const { native, approval, store } = nativeFixture();
  const host = hostFixture(native);
  await native.setTaskAutoContinue(approval.taskId, true);
  await Promise.all([host.continueAutomatically(), host.continueAutomatically(), host.handleUserInput("Continue", undefined, approval)]);
  assert.equal(host.queueIds.length, 1);
  assert.equal([...store.keys()].filter(key => key.startsWith("think_approved_start:")).length, 1);
  const next = await native.beginTask(host.queueIds[0], "same-conversation");
  const replay = await native.approveTaskContinuation(approval);
  assert.equal(replay.alreadyStarted, true);
  assert.equal(replay.operationId, next.taskId);
});

test("new task defaults OFF and stale preauthorization cannot resume an old task", async () => {
  const { native, approval, store } = nativeFixture();
  const preference = await native.setTaskAutoContinue(approval.taskId, true);
  store.set("think_task_lifecycle", { ...boundary, status: "COMPLETE" });
  const next = await native.beginTask("new-independent-task", "new-independent-conversation", "New direction");
  assert.equal((await native.getTaskLifecycle()).autoContinue.enabled, false);
  assert.notEqual(next.customerTaskId, approval.taskId);
  await assert.rejects(native.approveTaskContinuation({ ...approval, source: "auto", preauthorizationVersion: preference.version }));
});

test("turning Off during active work leaves the operation unchanged and the next boundary waits", async () => {
  const { native, approval, store } = nativeFixture();
  const host = hostFixture(native);
  const preference = await native.setTaskAutoContinue(approval.taskId, true);
  const accepted = await native.approveTaskContinuation({ ...approval, source: "auto", preauthorizationVersion: preference.version });
  await native.beginTask(accepted.operationId, "same-conversation");
  const before = await native.getTaskOperation();
  await native.setTaskAutoContinue(approval.taskId, false);
  assert.deepEqual(await native.getTaskOperation(), before, "no counter, tool, or workspace mutation from the toggle");
  store.set("think_task_lifecycle", { ...boundary, updatedAt: Date.now() });
  await host.continueAutomatically();
  assert.deepEqual(host.queueIds, []);
});

test("customer Stop revokes task preauthorization before the existing cancellation path", async () => {
  const { native, approval } = nativeFixture();
  const host = hostFixture(native);
  await native.setTaskAutoContinue(approval.taskId, true);
  await host.disableTaskAutoContinue();
  assert.equal((await native.getTaskLifecycle()).autoContinue.enabled, false);
  await host.continueAutomatically();
  assert.deepEqual(host.queueIds, []);
  const handler = readFileSync("production/vibesdk-launch/runtime-source/worker/agents/core/websocket.ts", "utf8");
  const stop = handler.slice(handler.indexOf("case WebSocketMessageRequests.STOP_GENERATION:"));
  assert.ok(stop.indexOf("disableTaskAutoContinue") < stop.indexOf("cancelCurrentInference"));
});

test("disabling during an in-flight automatic approval fails closed without a reservation", async () => {
  const { native, approval, store } = nativeFixture();
  const preference = await native.setTaskAutoContinue(approval.taskId, true);
  const pending = native.approveTaskContinuation({ ...approval, source: "auto", preauthorizationVersion: preference.version });
  await native.setTaskAutoContinue(approval.taskId, false);
  await assert.rejects(pending, /no longer enabled/);
  assert.equal([...store.keys()].filter(key => key.startsWith("think_customer_approval:")).length, 0);
});

test("manual approval adopts an automatic reservation that wins during the digest await", async () => {
  const { native, approval, store } = nativeFixture();
  const parent = await native.getTaskOperation();
  const id = "think-approved:" + createHash("sha256").update(JSON.stringify([approval.taskId, approval.operationId])).digest("hex");
  const key = `think_customer_approval:${approval.operationId}`;
  const get = native.ctx.storage.kv.get;
  let reads = 0;
  native.ctx.storage.kv.get = (name: string) => {
    if (name === key && ++reads === 2) {
      store.set(`think_approved_start:${id}`, parent);
      store.set(key, { operationId: id, source: "auto", taskId: approval.taskId, parentOperationId: approval.operationId });
    }
    return get(name);
  };
  const accepted = await native.approveTaskContinuation(approval);
  assert.equal(store.get(key).source, "manual");
  assert.equal(accepted.operationId, id);
  await native.setTaskAutoContinue(approval.taskId, false);
  assert.equal((await native.beginTask(id, "same-conversation")).taskId, id);
});

test("bridge only accepts explicit, owner-bound task preference values; customer cannot claim auto approval", () => {
  assert.deepEqual(allowedNativeClientFrame({ type: "set_auto_continue", taskId: "sandbox-task", enabled: true, userId: "forged-owner" }),
    { type: "set_auto_continue", taskId: "sandbox-task", enabled: true });
  assert.equal(allowedNativeClientFrame({ type: "set_auto_continue", taskId: "sandbox-task", enabled: "true" }), null);
  assert.equal(allowedNativeClientFrame({ type: "set_auto_continue", taskId: "", enabled: true }), null);
  const frame = allowedNativeClientFrame({ type: "user_suggestion", message: "Continue", continuationApproval: {
    taskId: "sandbox-task", operationId: "sandbox-operation", source: "auto", preauthorizationVersion: 999,
  } });
  assert.deepEqual(frame.continuationApproval, { taskId: "sandbox-task", operationId: "sandbox-operation" });
});