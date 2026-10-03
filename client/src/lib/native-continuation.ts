export type NativeCustomerStatus =
  | "WORKING"
  | "CONTINUE_AVAILABLE"
  | "NEEDS_INPUT"
  | "BUILD_COMPLETE"
  | "STOPPED";

export type NativeCustomerLifecycle = {
  status?: string;
  customerStatus?: NativeCustomerStatus;
  taskId?: string;
  operationId?: string;
  updatedAt?: number;
  reason?: string;
};

export type ContinuableNativeLifecycle = NativeCustomerLifecycle & {
  customerStatus: "CONTINUE_AVAILABLE";
  taskId: string;
  operationId: string;
  updatedAt: number;
};

export function customerLifecycleStatus(value: unknown): NativeCustomerStatus | null {
  const status = (value as NativeCustomerLifecycle | null)?.customerStatus;
  return status === "WORKING" || status === "CONTINUE_AVAILABLE" || status === "NEEDS_INPUT"
    || status === "BUILD_COMPLETE" || status === "STOPPED" ? status : null;
}

export function canContinueNativeTask(
  lifecycleValue: unknown,
  runtimeIsWorking: boolean,
): lifecycleValue is ContinuableNativeLifecycle {
  const lifecycle = lifecycleValue as NativeCustomerLifecycle | null;
  return !runtimeIsWorking
    && customerLifecycleStatus(lifecycle) === "CONTINUE_AVAILABLE"
    && typeof lifecycle?.taskId === "string" && lifecycle.taskId.length > 0
    && typeof lifecycle.operationId === "string" && lifecycle.operationId.length > 0
    && typeof lifecycle.updatedAt === "number" && Number.isFinite(lifecycle.updatedAt);
}

export function isContextualContinuationApproval(
  text: string,
  lifecycleValue: unknown,
  runtimeIsWorking: boolean,
  hasNewerCustomerRequest = false,
): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!?]+$/g, "").trim();
  const approval = /^(yes|continue|keep going|go ahead|finish it|keep working)$/.test(normalized);
  return approval && !hasNewerCustomerRequest && canContinueNativeTask(lifecycleValue, runtimeIsWorking);
}

export function hasFreshApprovedOperation(
  lifecycleValue: unknown,
  baseline: { taskId: string; operationId: string; updatedAt: number },
): boolean {
  const lifecycle = lifecycleValue as NativeCustomerLifecycle | null;
  return Boolean(
    lifecycle
    && lifecycle.taskId === baseline.taskId
    && typeof lifecycle.operationId === "string"
    && lifecycle.operationId.length > 0
    && lifecycle.operationId !== baseline.operationId
    && typeof lifecycle.updatedAt === "number"
    && Number.isFinite(lifecycle.updatedAt)
    && lifecycle.updatedAt > baseline.updatedAt,
  );
}