import { executeRuntimeOperation, type RuntimeBoundary, type RuntimeOperation } from "./runtime-boundary";
import { WorkflowEntrypoint } from "cloudflare:workers";

export type WorkflowEnv = {
  DB: D1Database;
  PROJECT_OP: DurableObjectNamespace;
  RUNTIME_OPERATIONS_ENABLED: string;
};

export class RuntimeOperationWorkflow extends WorkflowEntrypoint<WorkflowEnv> {
  async run(event: { payload: { operationId: string; projectId: number; operation: RuntimeOperation; boundary: RuntimeBoundary; payload: Record<string, unknown> } }, step: WorkflowStep): Promise<void> {
    const env = this.env;
    const { operationId, projectId, operation, boundary, payload } = event.payload;
    if (env.RUNTIME_OPERATIONS_ENABLED !== "true") {
      await env.DB.prepare(
        "UPDATE operations SET status='failed',error='Runtime compatibility gate is disabled',finished_at=datetime('now') WHERE id=? AND status IN ('queued','running')",
      ).bind(operationId).run();
      const id = env.PROJECT_OP.idFromName(String(projectId));
      await env.PROJECT_OP.get(id).fetch("https://do/release", {
        method: "POST",
        body: JSON.stringify({ operationId }),
      });
      return;
    }
    await step.do("mark-running", async () => {
      await env.DB.prepare("UPDATE operations SET status='running',started_at=datetime('now') WHERE id=? AND status='queued'").bind(operationId).run();
    });
    try {
      const result = await step.do("execute-runtime", () => executeRuntimeOperation(boundary, operation, payload));
      await step.do("mark-complete", async () => {
        await env.DB.prepare("UPDATE operations SET status='succeeded',result_json=?,finished_at=datetime('now') WHERE id=? AND status='running'")
          .bind(JSON.stringify(result), operationId).run();
      });
    } catch (error) {
      await step.do("mark-failed", async () => {
        await env.DB.prepare("UPDATE operations SET status='failed',error=?,finished_at=datetime('now') WHERE id=? AND status='running'")
          .bind(error instanceof Error ? error.message : "Operation failed", operationId).run();
      });
      throw error;
    } finally {
      const id = env.PROJECT_OP.idFromName(String(projectId));
      await env.PROJECT_OP.get(id).fetch("https://do/release", { method: "POST", body: JSON.stringify({ operationId }) });
    }
  }
}

type WorkflowStep = { do<T>(name: string, callback: () => Promise<T>): Promise<T> };