import { createHash, createHmac } from "node:crypto";
import { VibeClient, type BuildSession } from "@cf-vibesdk/sdk";

export type RuntimeProjectRef = {
  id: number;
  name: string;
  type?: string;
  description?: string;
  agentId?: string;
};

export type RuntimeImageAttachment = {
  id: string;
  filename: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  base64Data: string;
  size?: number;
};

export type RuntimeAdapterErrorCode = "RUNTIME_UNCONFIGURED" | "RUNTIME_UPSTREAM_ERROR";

export class RuntimeAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: RuntimeAdapterErrorCode,
    public readonly status = code === "RUNTIME_UNCONFIGURED" ? 503 : 502,
  ) {
    super(message);
    this.name = "RuntimeAdapterError";
  }
}

const sessions = new Map<number, BuildSession>();
const operationQueues = new Map<number, Promise<void>>();

export function buildCompletionSynopsis(response: unknown, changedFiles: Array<string | { path: string }>) {
  const message = typeof response === "string" ? response.trim() : "";
  if (message && message !== "Agent completed the request.") return message;
  const filePaths = changedFiles.map((file) => typeof file === "string" ? file : file.path);
  const visibleFiles = filePaths.slice(0, 3);
  const changedSummary = visibleFiles.length
    ? ` Updated ${visibleFiles.join(", ")}${filePaths.length > visibleFiles.length ? ` and ${filePaths.length - visibleFiles.length} more file${filePaths.length - visibleFiles.length === 1 ? "" : "s"}` : ""}.`
    : "";
  return `Completed your request.${changedSummary}`;
}

async function withProjectLock<T>(projectId: number, operation: () => Promise<T>): Promise<T> {
  const previous = operationQueues.get(projectId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const queued = previous.then(() => current);
  operationQueues.set(projectId, queued);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (operationQueues.get(projectId) === queued) operationQueues.delete(projectId);
  }
}

function runtimeBaseUrl() {
  const value = process.env.VIBESDK_RUNTIME_URL?.trim();
  if (!value) throw new RuntimeAdapterError("The VibeSDK runtime is not configured.", "RUNTIME_UNCONFIGURED");
  return value.replace(/\/+$/, "");
}

function runtimeApiKey() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new RuntimeAdapterError("The server session secret is not configured.", "RUNTIME_UNCONFIGURED");
  return createHmac("sha256", secret).update("buildcustom-vibesdk-staging-api-key-v1").digest("base64url");
}

function client() {
  return new VibeClient({ baseUrl: runtimeBaseUrl(), apiKey: runtimeApiKey(), retry: { maxRetries: 2 } });
}

async function waitForHydration(session: BuildSession) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const state = session.state.get();
    if (state.query !== undefined || session.files.listPaths().length > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function connect(project: RuntimeProjectRef) {
  const cached = sessions.get(project.id);
  if (cached?.isConnected() && project.agentId === cached.agentId) return cached;
  if (cached) sessions.delete(project.id);
  if (!project.agentId) return null;
  const session = await client().connect(project.agentId);
  await session.connect();
  await waitForHydration(session);
  sessions.set(project.id, session);
  return session;
}

function assertGenerated(session: BuildSession) {
  if (session.files.listPaths().length === 0) {
    throw new RuntimeAdapterError(
      session.state.get().lastError || "Agent completed without generating workspace files.",
      "RUNTIME_UPSTREAM_ERROR",
    );
  }
}

function generationFingerprint(session: BuildSession) {
  const state = session.state.get();
  return JSON.stringify({
    files: session.files.listPaths().map((path) => [path, session.files.read(path)?.length ?? 0]),
    response: state.lastConversationResponse,
    error: state.lastError,
  });
}

type RuntimeActivity = {
  type: "tool" | "message";
  label: string;
  path?: string;
  status?: string;
  createdAt: string;
};

async function runGenerationCommand(
  session: BuildSession,
  command: () => void,
  onActivity?: (activity: RuntimeActivity) => void,
) {
  const baseline = generationFingerprint(session);
  let eventCompleted = false;
  session.wait.generationComplete({ timeoutMs: 300_000 })
    .then(() => { eventCompleted = true; })
    .catch(() => undefined);

  command();

  const startedAt = Date.now();
  const deadline = startedAt + 300_000;
  let lastFingerprint = baseline;
  let lastChangeAt = startedAt;
  let sawChange = false;

  while (Date.now() < deadline) {
    if (eventCompleted) return;

    const state = session.state.get();
    if (state.lastError) {
      throw new RuntimeAdapterError(state.lastError, "RUNTIME_UPSTREAM_ERROR");
    }
    if (state.generation.status === "stopped") {
      throw new RuntimeAdapterError("Build stopped.", "RUNTIME_UPSTREAM_ERROR", 409);
    }

    const fingerprint = generationFingerprint(session);
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      lastChangeAt = Date.now();
      sawChange = true;
      const response = state.lastConversationResponse as any;
      const tool = response?.tool;
      if (tool?.name) {
        const path = tool.args?.path;
        onActivity?.({
          type: "tool",
          label: path
            ? `${tool.status === "success" ? "Completed" : "Running"} ${tool.name} on ${path}`
            : `${tool.status === "success" ? "Completed" : "Running"} ${tool.name}`,
          path,
          status: tool.status,
          createdAt: new Date().toISOString(),
        });
      } else if (typeof response?.message === "string" && response.message.trim()) {
        onActivity?.({
          type: "message",
          label: response.message.trim(),
          createdAt: new Date().toISOString(),
        });
      }
    }

    const hasFiles = session.files.listPaths().length > 0;
    if (
      sawChange
      && hasFiles
      && state.shouldBeGenerating === false
      && Date.now() - lastChangeAt >= 5_000
    ) {
      return;
    }

    if (!sawChange && Date.now() - startedAt >= 45_000) {
      throw new RuntimeAdapterError(
        "The Agent did not start the request. Please try again.",
        "RUNTIME_UPSTREAM_ERROR",
        504,
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new RuntimeAdapterError(
    "The Agent took too long to finish. Please try again.",
    "RUNTIME_UPSTREAM_ERROR",
    504,
  );
}

async function runPlanCommand(session: BuildSession, command: () => void) {
  const baseline = JSON.stringify(session.state.get().lastConversationResponse ?? null);
  command();
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const state = session.state.get();
    if (state.lastError) {
      throw new RuntimeAdapterError(state.lastError, "RUNTIME_UPSTREAM_ERROR");
    }
    if (state.generation.status === "stopped") {
      throw new RuntimeAdapterError("Planning stopped.", "RUNTIME_UPSTREAM_ERROR", 409);
    }
    const response = state.lastConversationResponse as any;
    if (
      response
      && JSON.stringify(response) !== baseline
      && response.isStreaming === false
      && typeof response.message === "string"
      && response.message.trim()
    ) {
      return response.message.trim();
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new RuntimeAdapterError(
    "The Agent took too long to prepare the plan. Please try again.",
    "RUNTIME_UPSTREAM_ERROR",
    504,
  );
}

export function isRuntimeConfigured() {
  return Boolean(process.env.VIBESDK_RUNTIME_URL?.trim() && process.env.SESSION_SECRET);
}

export const runtimeAdapter = {
  async plan(
    project: RuntimeProjectRef,
    message: string,
    resolveAgentId: () => Promise<string | undefined>,
    onAgentCreated: (agentId: string) => Promise<string>,
    images: RuntimeImageAttachment[] = [],
  ) {
    return withProjectLock(project.id, async () => {
      try {
        project = { ...project, agentId: await resolveAgentId() };
        let session = await connect(project);
        if (!session) {
          session = await client().build(message, {
            behaviorType: "think" as any,
            projectType: "app",
            selectedTemplate: "c-code-react-runner",
            autoConnect: true,
            autoGenerate: false,
          });
          const claimedAgentId = await onAgentCreated(session.agentId);
          if (claimedAgentId !== session.agentId) {
            throw new RuntimeAdapterError(
              "This project was linked to another Agent concurrently. Retry the request.",
              "RUNTIME_UPSTREAM_ERROR",
              409,
            );
          }
          sessions.set(project.id, session);
        }
        const planPrompt = [
          "[[BUILDCUSTOM_PLAN_ONLY_V1]]",
          "Plan this request using the current project and conversation context.",
          "Return a concise implementation plan for human approval.",
          "Do not modify files, call tools, commit, deploy, or claim any work was completed.",
          "",
          message,
        ].join("\n");
        const plan = await runPlanCommand(session, () => session.followUp(planPrompt, { images }));
        return { message: plan, planOnly: true, agentId: session.agentId };
      } catch (error) {
        if (error instanceof RuntimeAdapterError) throw error;
        throw new RuntimeAdapterError(
          error instanceof Error ? error.message : "Agent planning failed.",
          "RUNTIME_UPSTREAM_ERROR",
        );
      }
    });
  },

  async generate(
    project: RuntimeProjectRef,
    message: string,
    resolveAgentId: () => Promise<string | undefined>,
    onAgentCreated: (agentId: string) => Promise<string>,
    images: RuntimeImageAttachment[] = [],
  ) {
    return withProjectLock(project.id, async () => {
      try {
      project = { ...project, agentId: await resolveAgentId() };
      let session = await connect(project);
      const snapshot = (activeSession: BuildSession | null) => new Map(
        (activeSession?.files.listPaths() || []).map((path) => {
          const content = activeSession?.files.read(path) || "";
          return [path, { hash: createHash("sha256").update(content).digest("hex"), size: content.length }] as const;
        }),
      );
      const diffSnapshots = (
        previous: ReturnType<typeof snapshot>,
        current: ReturnType<typeof snapshot>,
      ) => Array.from(new Set(Array.from(previous.keys()).concat(Array.from(current.keys()))))
        .filter((path) => previous.get(path)?.hash !== current.get(path)?.hash)
        .map((path) => ({
          path,
          change: !previous.has(path) ? "added" : !current.has(path) ? "deleted" : "modified",
          size: current.get(path)?.size || 0,
        }));
      const before = snapshot(session);
      const activity: RuntimeActivity[] = [];
      const captureActivity = (entry: RuntimeActivity) => {
        const previous = activity[activity.length - 1];
        if (previous?.label !== entry.label || previous?.status !== entry.status) activity.push(entry);
      };
      if (!session) {
        session = await client().build(message, {
          behaviorType: "think" as any,
          projectType: "app",
          selectedTemplate: "c-code-react-runner",
          images,
          autoConnect: true,
          autoGenerate: false,
        });
        const claimedAgentId = await onAgentCreated(session.agentId);
        if (claimedAgentId !== session.agentId) {
          throw new RuntimeAdapterError(
            "This project was linked to another Agent concurrently. Retry the request.",
            "RUNTIME_UPSTREAM_ERROR",
            409,
          );
        }
        sessions.set(project.id, session);
        const activeSession = session;
        await runGenerationCommand(activeSession, () => activeSession.startGeneration(), captureActivity);
      } else {
        const activeSession = session;
        await runGenerationCommand(activeSession, () => activeSession.followUp(message, { images }), captureActivity);
      }
      assertGenerated(session);
        let after = snapshot(session);
        let changedFiles = diffSnapshots(before, after);
        if (changedFiles.length === 0) {
          const activeSession = session;
          const correction = [
            "The previous response did not change any workspace files.",
            "This is a Build request, not a question or plan.",
            "Inspect the existing project and apply the requested change now using the available file tools.",
            "Do not report completion unless you actually edit the workspace and verify the result.",
            "",
            message,
          ].join("\n");
          await runGenerationCommand(activeSession, () => activeSession.followUp(correction, { images }), captureActivity);
          assertGenerated(activeSession);
          after = snapshot(activeSession);
          changedFiles = diffSnapshots(before, after);
        }
        if (changedFiles.length === 0) {
          throw new RuntimeAdapterError(
            "The Agent finished without changing any workspace files. The requested change was not applied.",
            "RUNTIME_UPSTREAM_ERROR",
            409,
          );
        }
        const completedState = session.state.get() as any;
        const finalResponse = completedState.lastConversationResponse;
        const responseMessage = buildCompletionSynopsis(finalResponse?.message, changedFiles);
        return {
        agentId: session.agentId,
        message: responseMessage,
        files: session.files.listPaths().length,
        previewUrl: session.state.get().previewUrl || null,
        changedFiles,
        commitHash: completedState.lastDeployedCommit || null,
        activity,
        };
      } catch (error) {
        if (error instanceof RuntimeAdapterError) throw error;
        throw new RuntimeAdapterError(error instanceof Error ? error.message : "Agent request failed.", "RUNTIME_UPSTREAM_ERROR");
      }
    });
  },

  async files(project: RuntimeProjectRef) {
    const session = await connect(project);
    if (!session) return { files: [] };
    return {
      files: session.files.listPaths().map((path) => ({
        path,
        name: path.split("/").pop(),
        type: "file",
        size: session.files.read(path)?.length ?? 0,
      })),
    };
  },

  async fileContent(project: RuntimeProjectRef, path: string) {
    const session = await connect(project);
    if (!session) throw new RuntimeAdapterError("This project has no Agent workspace.", "RUNTIME_UPSTREAM_ERROR", 404);
    const content = session.files.read(path);
    if (content === undefined) throw new RuntimeAdapterError("Runtime file not found.", "RUNTIME_UPSTREAM_ERROR", 404);
    return { path, content };
  },

  async preview(project: RuntimeProjectRef) {
    return withProjectLock(project.id, async () => {
      const session = await connect(project);
      if (!session) throw new RuntimeAdapterError("Generate the project before starting a preview.", "RUNTIME_UPSTREAM_ERROR", 409);
      const complete = session.wait.previewDeployed({ timeoutMs: 180_000 });
      session.deployPreview();
      const event = await complete;
      return { url: event.previewURL, previewUrl: event.previewURL, agentId: session.agentId };
    });
  },

  async stop(project: RuntimeProjectRef) {
    const session = await connect(project);
    if (!session) {
      throw new RuntimeAdapterError("There is no active Agent build to stop.", "RUNTIME_UPSTREAM_ERROR", 409);
    }
    session.stop();
    return { stopped: true, agentId: session.agentId };
  },

  async deploy(project: RuntimeProjectRef) {
    return withProjectLock(project.id, async () => {
      const session = await connect(project);
      if (!session) throw new RuntimeAdapterError("Generate the project before deploying it.", "RUNTIME_UPSTREAM_ERROR", 409);
      const complete = session.wait.cloudflareDeployed({ timeoutMs: 240_000 });
      session.deployCloudflare();
      const event = await complete;
      return {
        url: event.deploymentUrl,
        workersUrl: event.workersUrl,
        commitHash: (event as any).commitHash as string | undefined,
        agentId: session.agentId,
      };
    });
  },

  async restore(project: RuntimeProjectRef, commitHash: string) {
    return withProjectLock(project.id, async () => {
      const session = await connect(project);
      if (!session) throw new RuntimeAdapterError("This project has no Agent workspace.", "RUNTIME_UPSTREAM_ERROR", 404);
      const complete = session.wait.previewDeployed({ timeoutMs: 180_000 });
      const connection = (session as any).connection;
      if (!connection?.send) {
        throw new RuntimeAdapterError("This runtime does not support release restoration.", "RUNTIME_UPSTREAM_ERROR", 409);
      }
      connection.send({ type: "rollback_to_commit", commitHash });
      const event = await complete;
      return { previewUrl: event.previewURL, commitHash, agentId: session.agentId };
    });
  },

  async status(project: RuntimeProjectRef) {
    const session = await connect(project);
    const state = session?.state.get();
    const response = state?.lastConversationResponse as any;
    return {
      configured: true,
      provider: "vibesdk",
      agentId: project.agentId || null,
      connected: Boolean(session?.isConnected()),
      state: state ? {
        connection: state.connection,
        generation: state.generation,
        phase: state.phase,
        preview: state.preview,
        cloudflare: state.cloudflare,
        phases: state.phases,
        currentFile: state.currentFile,
        previewUrl: state.previewUrl,
        lastError: state.lastError,
        shouldBeGenerating: state.shouldBeGenerating,
        lastDeployedCommit: (state as any).lastDeployedCommit,
        lastConversationResponse: response ? {
          type: response.type,
          message: response.message,
          isStreaming: response.isStreaming,
          tool: response.tool ? {
            name: response.tool.name,
            status: response.tool.status,
            args: response.tool.args?.path ? { path: response.tool.args.path } : undefined,
          } : undefined,
        } : undefined,
      } : null,
      files: session?.files.listPaths().length || 0,
    };
  },
};