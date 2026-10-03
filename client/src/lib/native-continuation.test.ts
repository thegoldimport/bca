import assert from "node:assert/strict";
import test from "node:test";
import {
  canContinueNativeTask,
  customerLifecycleStatus,
  hasFreshApprovedOperation,
  isContextualContinuationApproval,
} from "./native-continuation";

const waiting = {
  status: "INCOMPLETE_RESOURCE_LIMIT",
  customerStatus: "CONTINUE_AVAILABLE",
  taskId: "task-fixture-1",
  operationId: "operation-fixture-1",
  updatedAt: 100,
  reason: "fixture-only internal reason",
};

test("continuation is offered only for a current, eligible customer lifecycle", () => {
  assert.equal(customerLifecycleStatus(waiting), "CONTINUE_AVAILABLE");
  assert.equal(canContinueNativeTask(waiting, false), true);
  assert.equal(canContinueNativeTask(waiting, true), false);
  assert.equal(canContinueNativeTask({ ...waiting, customerStatus: "BLOCKED" }, false), false);
  assert.equal(canContinueNativeTask({ ...waiting, operationId: "" }, false), false);
});

test("short approvals are contextual and do not promote an unrelated yes", () => {
  for (const text of ["yes", "continue", "keep going", "go ahead", "finish it", "keep working"]) {
    assert.equal(isContextualContinuationApproval(text, waiting, false), true, text);
  }
  assert.equal(isContextualContinuationApproval("yes", waiting, false, true), false);
  assert.equal(isContextualContinuationApproval("yes", { ...waiting, customerStatus: "WORKING" }, false), false);
  assert.equal(isContextualContinuationApproval("Actually add settings", waiting, false), false);
});

test("approved operation correlation requires the same task, a new operation and fresh lifecycle", () => {
  const baseline = { taskId: waiting.taskId, operationId: waiting.operationId, updatedAt: waiting.updatedAt };
  assert.equal(hasFreshApprovedOperation({
    ...waiting,
    status: "RUNNING",
    customerStatus: "WORKING",
    operationId: "operation-fixture-2",
    updatedAt: 101,
  }, baseline), true);
  assert.equal(hasFreshApprovedOperation({ ...waiting, operationId: "operation-fixture-2", updatedAt: 101, taskId: "other" }, baseline), false);
  assert.equal(hasFreshApprovedOperation({ ...waiting, operationId: waiting.operationId, updatedAt: 101 }, baseline), false);
  assert.equal(hasFreshApprovedOperation({ ...waiting, operationId: "operation-fixture-2", updatedAt: 100 }, baseline), false);
});

test("completion and input statuses remain distinct from continuation", () => {
  assert.equal(customerLifecycleStatus({ customerStatus: "BUILD_COMPLETE" }), "BUILD_COMPLETE");
  assert.equal(customerLifecycleStatus({ customerStatus: "NEEDS_INPUT" }), "NEEDS_INPUT");
  assert.equal(canContinueNativeTask({ customerStatus: "BUILD_COMPLETE", taskId: "t", operationId: "o", updatedAt: 1 }, false), false);
  assert.equal(canContinueNativeTask({ customerStatus: "NEEDS_INPUT", taskId: "t", operationId: "o", updatedAt: 1 }, false), false);
});