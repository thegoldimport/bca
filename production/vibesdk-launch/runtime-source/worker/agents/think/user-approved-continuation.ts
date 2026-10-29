import {
createThinkTaskOperation,
type ThinkTaskLifecycle,
type ThinkTaskOperation,
} from './finish-task-tool';
import { THINK_INTERNAL_CONTINUATION_PREFIX } from './context-selector';

export interface ThinkContinuationApproval {
taskId: string;
operationId: string;
/** Set by the authenticated host, never accepted from customer approval frames. */
source?: 'manual' | 'auto';
preauthorizationVersion?: number;
}

export type CustomerTaskStatus =
| 'BUILD_COMPLETE'
| 'CONTINUE_AVAILABLE'
| 'NEEDS_INPUT'
| 'WORKING'
| 'STOPPED';

// Account-level available-credit restrictions are deliberately excluded.
const operationBoundaries = new Set([
'continuation_budget_exhausted', 'credit_limit', 'elapsed_time_limit',
'model_call_limit', 'tool_call_limit',
]);

export function customerTaskStatus(lifecycle: ThinkTaskLifecycle): CustomerTaskStatus {
if (lifecycle.status === 'COMPLETE') return 'BUILD_COMPLETE';
if (lifecycle.status === 'USER_INPUT_REQUIRED') return 'NEEDS_INPUT';
if (lifecycle.status === 'INCOMPLETE_RESOURCE_LIMIT'
&& operationBoundaries.has(lifecycle.reason ?? '')) return 'CONTINUE_AVAILABLE';
return lifecycle.status === 'RUNNING' ? 'WORKING' : 'STOPPED';
}

export function isConversationalContinuation(message: string): boolean {
return /^(yes|continue|keep going|go ahead|finish it|keep working)[.!?]*$/i
.test(message.trim());
}

export function continuationTaskId(operation: ThinkTaskOperation): string {
return operation.customerTaskId ?? operation.taskId;
}

export function assertContinuationApproval(
operation: ThinkTaskOperation,
lifecycle: ThinkTaskLifecycle,
approval: ThinkContinuationApproval,
): void {
if (approval.taskId !== continuationTaskId(operation)
|| approval.operationId !== operation.taskId
|| customerTaskStatus(lifecycle) !== 'CONTINUE_AVAILABLE') {
throw new Error('This task is not waiting for your permission to continue.');
}
}

/** Keeps task context, but never carries operation-scoped usage or stop reasons. */
export function createApprovedThinkOperation(
previous: ThinkTaskOperation,
operationId: string,
limits: Parameters<typeof createThinkTaskOperation>[2] = previous.limits,
): ThinkTaskOperation {
return {
...createThinkTaskOperation(operationId, previous.conversationId, limits),
customerTaskId: continuationTaskId(previous),
parentOperationId: previous.taskId,
...(previous.originalIntent ? { originalIntent: previous.originalIntent } : {}),
};
}

export const APPROVED_CONTINUATION_PROMPT =
THINK_INTERNAL_CONTINUATION_PREFIX + '\n'
+'The customer approved another bounded work session for this same unfinished task. '
+'Continue the existing customer task from the current workspace and conversation. '
+'Preserve completed work and focus on what remains. Verify the requested result before finishing.';