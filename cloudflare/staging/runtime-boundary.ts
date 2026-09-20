import { assertMutableAgent, assertSafeStagingTarget } from "./boundary";

export type RuntimeOperation = "plan" | "build" | "preview" | "restore" | "deploy" | "cancel";
export type RuntimeBoundary = {
  runtimeUrl: string;
  agentId?: string | null;
  imported?: boolean;
};

export function assertRuntimeOperationAllowed(boundary: RuntimeBoundary, operation: RuntimeOperation): void {
  assertSafeStagingTarget(boundary.runtimeUrl);
  if (boundary.imported) {
    throw new Error("IMPORTED_AGENT_READ_ONLY");
  } else {
    assertMutableAgent(boundary.agentId, boundary.runtimeUrl);
  }
}

export async function executeRuntimeOperation(
  boundary: RuntimeBoundary,
  operation: RuntimeOperation,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertRuntimeOperationAllowed(boundary, operation);
  if (operation === "cancel") {
    const response = await fetch(`${boundary.runtimeUrl}/api/sessions/stop`, { method: "POST", body: JSON.stringify(payload) });
    if (!response.ok) throw new Error("RUNTIME_CANCEL_FAILED");
    return await response.json() as Record<string, unknown>;
  }
  // The SDK remains behind this adapter. The isolated runtime owns credentials and workspace state.
  const response = await fetch(`${boundary.runtimeUrl}/api/staging/${operation}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`RUNTIME_${operation.toUpperCase()}_FAILED`);
  return await response.json() as Record<string, unknown>;
}