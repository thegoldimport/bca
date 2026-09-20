import { VibeClient, type BuildOptions, type BuildSession, type VibeClientOptions } from "@cf-vibesdk/sdk";

export type VibeSdkEnv = {
  VIBESDK_RUNTIME_URL?: string;
  VIBESDK_API_KEY?: string;
};

export type VibeSdkProject = {
  agentId?: string | null;
  name?: string;
  type?: string;
  description?: string;
};

export type VibeSdkImage = {
  id: string;
  filename: string;
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  base64Data: string;
  size?: number;
};

export type VibeSdkAdapterErrorCode = "RUNTIME_UNCONFIGURED" | "RUNTIME_INVALID_CONFIG" | "RUNTIME_UPSTREAM_ERROR";

export class VibeSdkAdapterError extends Error {
  constructor(
    message: string,
    public readonly code: VibeSdkAdapterErrorCode,
    public readonly status = code === "RUNTIME_UNCONFIGURED" ? 503 : code === "RUNTIME_INVALID_CONFIG" ? 400 : 502,
  ) {
    super(message);
    this.name = "VibeSdkAdapterError";
  }
}

export function validateRuntimeConfig(env: VibeSdkEnv): { runtimeUrl: string; apiKey: string } {
  const runtimeUrl = env.VIBESDK_RUNTIME_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.VIBESDK_API_KEY?.trim();
  if (!runtimeUrl || !apiKey) throw new VibeSdkAdapterError("The VibeSDK runtime is not configured.", "RUNTIME_UNCONFIGURED");
  let parsed: URL;
  try {
    parsed = new URL(runtimeUrl);
  } catch {
    throw new VibeSdkAdapterError("The VibeSDK runtime URL is invalid.", "RUNTIME_INVALID_CONFIG");
  }
  if (parsed.protocol !== "https:") throw new VibeSdkAdapterError("The VibeSDK runtime must use HTTPS.", "RUNTIME_INVALID_CONFIG");
  return { runtimeUrl, apiKey };
}

/** Deliberately omits credentials; safe for structured logs and API responses. */
export function publicRuntimeConfig(env: VibeSdkEnv): { runtimeUrl: string; configured: boolean } {
  const runtimeUrl = env.VIBESDK_RUNTIME_URL?.trim().replace(/\/+$/, "") || "";
  return { runtimeUrl, configured: Boolean(runtimeUrl && env.VIBESDK_API_KEY?.trim()) };
}

type RuntimeActivity = {
  type: "tool" | "message";
  label: string;
  path?: string;
  status?: string;
};

type SessionState = Record<string, any>;

function errorFrom(error: unknown, fallback: string): VibeSdkAdapterError {
  if (error instanceof VibeSdkAdapterError) return error;
  return new VibeSdkAdapterError(error instanceof Error ? error.message : fallback, "RUNTIME_UPSTREAM_ERROR");
}

function fileSummary(session: BuildSession) {
  return session.files.listPaths().map((path) => ({
    path,
    name: path.split("/").pop() || path,
    type: "file" as const,
    size: session.files.read(path)?.length ?? 0,
  }));
}

function safeState(session: BuildSession) {
  const state = session.state.get() as SessionState;
  const response = state.lastConversationResponse;
  return {
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
    lastDeployedCommit: state.lastDeployedCommit,
    lastConversationResponse: response
      ? {
          type: response.type,
          message: response.message,
          isStreaming: response.isStreaming,
          tool: response.tool
            ? {
                name: response.tool.name,
                status: response.tool.status,
                args: response.tool.args?.path ? { path: response.tool.args.path } : undefined,
              }
            : undefined,
        }
      : undefined,
  };
}

function fingerprint(session: BuildSession) {
  const state = session.state.get() as SessionState;
  return JSON.stringify({
    response: state.lastConversationResponse,
    generation: state.generation,
    files: session.files.listPaths().map((path) => [path, session.files.read(path)?.length ?? 0]),
  });
}

async function waitFor(session: BuildSession, predicate: () => boolean, timeoutMs: number, message: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new VibeSdkAdapterError(message, "RUNTIME_UPSTREAM_ERROR", 504);
}

async function connectSession(client: VibeClient, agentId: string): Promise<BuildSession> {
  if (!agentId.trim()) throw new VibeSdkAdapterError("A VibeSDK agent ID is required.", "RUNTIME_INVALID_CONFIG", 400);
  const session = await client.connect(agentId);
  await session.connect();
  return session;
}

async function runGeneration(session: BuildSession, command: () => void, activity: RuntimeActivity[]) {
  const baseline = fingerprint(session);
  let last = baseline;
  const complete = session.wait.generationComplete({ timeoutMs: 300_000 });
  command();
  try {
    await complete;
  } catch (error) {
    throw errorFrom(error, "VibeSDK generation failed.");
  }
  const state = session.state.get() as SessionState;
  if (state.lastError) throw new VibeSdkAdapterError(state.lastError, "RUNTIME_UPSTREAM_ERROR");
  if (state.generation?.status === "stopped") throw new VibeSdkAdapterError("Build stopped.", "RUNTIME_UPSTREAM_ERROR", 409);
  const current = fingerprint(session);
  if (current !== last) {
    last = current;
    const response = state.lastConversationResponse;
    if (response?.tool?.name) {
      activity.push({
        type: "tool",
        label: response.tool.args?.path ? `${response.tool.name} on ${response.tool.args.path}` : response.tool.name,
        path: response.tool.args?.path,
        status: response.tool.status,
      });
    } else if (typeof response?.message === "string" && response.message.trim()) {
      activity.push({ type: "message", label: response.message.trim() });
    }
  }
}

async function runPlan(session: BuildSession, prompt: string, images: VibeSdkImage[]) {
  const before = fingerprint(session);
  session.followUp(prompt, { images: images as any });
  await waitFor(
    session,
    () => {
      const response = (session.state.get() as SessionState).lastConversationResponse;
      return fingerprint(session) !== before && response?.isStreaming === false && typeof response?.message === "string";
    },
    180_000,
    "The VibeSDK agent took too long to prepare the plan.",
  );
  const response = (session.state.get() as SessionState).lastConversationResponse;
  return String(response.message).trim();
}

export function createVibeSdkAdapter(env: VibeSdkEnv) {
  const config = validateRuntimeConfig(env);
  const clientOptions: VibeClientOptions = {
    baseUrl: config.runtimeUrl,
    apiKey: config.apiKey,
    fetchFn: fetch,
    retry: { maxRetries: 2 },
  };

  const client = () => new VibeClient(clientOptions);
  const sessionFor = (project: VibeSdkProject) => {
    if (!project.agentId) return Promise.resolve(null);
    return connectSession(client(), project.agentId);
  };

  return {
    async create(project: VibeSdkProject, prompt: string, images: VibeSdkImage[] = []) {
      try {
        const options: BuildOptions = {
          behaviorType: "think" as any,
          projectType: (project.type || "app") as any,
          selectedTemplate: "c-code-react-runner",
          images: images as any,
          autoConnect: false,
          autoGenerate: false,
        };
        const session = await client().build(prompt, options);
        await session.connect();
        return { agentId: session.agentId, status: "connected" };
      } catch (error) {
        throw errorFrom(error, "VibeSDK agent creation failed.");
      }
    },

    async plan(project: VibeSdkProject, message: string, images: VibeSdkImage[] = []) {
      try {
        const session = await sessionFor(project);
        if (!session) throw new VibeSdkAdapterError("This project has no VibeSDK agent.", "RUNTIME_UPSTREAM_ERROR", 409);
        const prompt = [
          "[[BUILDCUSTOM_PLAN_ONLY_V1]]",
          "Plan this request using the current project and conversation context.",
          "Return a concise implementation plan for human approval.",
          "Do not modify files, call tools, commit, deploy, or claim any work was completed.",
          "",
          message,
        ].join("\n");
        return { agentId: session.agentId, message: await runPlan(session, prompt, images), planOnly: true };
      } catch (error) {
        throw errorFrom(error, "VibeSDK planning failed.");
      }
    },

    async build(project: VibeSdkProject, message: string, images: VibeSdkImage[] = []) {
      try {
        const session = await sessionFor(project);
        if (!session) throw new VibeSdkAdapterError("This project has no VibeSDK agent.", "RUNTIME_UPSTREAM_ERROR", 409);
        const before = new Map(session.files.listPaths().map((path) => [path, session.files.read(path)]));
        const activity: RuntimeActivity[] = [];
        await runGeneration(session, () => session.followUp(message, { images: images as any }), activity);
        const changedFiles = session.files.listPaths()
          .filter((path) => before.get(path) !== session.files.read(path))
          .map((path) => ({ path, change: before.has(path) ? "modified" : "added", size: session.files.read(path)?.length ?? 0 }));
        return {
          agentId: session.agentId,
          message: (session.state.get() as SessionState).lastConversationResponse?.message || "Completed your request.",
          files: session.files.listPaths().length,
          previewUrl: (session.state.get() as SessionState).previewUrl || null,
          changedFiles,
          commitHash: (session.state.get() as SessionState).lastDeployedCommit || null,
          activity,
        };
      } catch (error) {
        throw errorFrom(error, "VibeSDK build failed.");
      }
    },

    async files(project: VibeSdkProject) {
      const session = await sessionFor(project);
      return { files: session ? fileSummary(session) : [] };
    },

    async fileContent(project: VibeSdkProject, path: string) {
      const session = await sessionFor(project);
      if (!session) throw new VibeSdkAdapterError("This project has no VibeSDK agent.", "RUNTIME_UPSTREAM_ERROR", 404);
      const content = session.files.read(path);
      if (content === undefined) throw new VibeSdkAdapterError("Runtime file not found.", "RUNTIME_UPSTREAM_ERROR", 404);
      return { path, content };
    },

    async status(project: VibeSdkProject) {
      const session = await sessionFor(project);
      return {
        configured: true,
        provider: "vibesdk",
        agentId: project.agentId || null,
        connected: Boolean(session?.isConnected()),
        state: session ? safeState(session) : null,
        files: session ? session.files.listPaths().length : 0,
      };
    },

    async preview(project: VibeSdkProject) {
      const session = await sessionFor(project);
      if (!session) throw new VibeSdkAdapterError("Generate the project before starting a preview.", "RUNTIME_UPSTREAM_ERROR", 409);
      const complete = session.wait.previewDeployed({ timeoutMs: 180_000 });
      session.deployPreview();
      const event = await complete;
      return { url: event.previewURL, previewUrl: event.previewURL, agentId: session.agentId };
    },

    async stop(project: VibeSdkProject) {
      const session = await sessionFor(project);
      if (!session) throw new VibeSdkAdapterError("There is no active VibeSDK build to stop.", "RUNTIME_UPSTREAM_ERROR", 409);
      session.stop();
      return { stopped: true, agentId: session.agentId };
    },

    async restore(project: VibeSdkProject, commitHash: string) {
      const session = await sessionFor(project);
      if (!session) throw new VibeSdkAdapterError("This project has no VibeSDK agent.", "RUNTIME_UPSTREAM_ERROR", 404);
      const connection = (session as any).connection as { send?: (message: unknown) => void } | undefined;
      if (!connection?.send) throw new VibeSdkAdapterError("This runtime does not support release restoration.", "RUNTIME_UPSTREAM_ERROR", 409);
      const complete = session.wait.previewDeployed({ timeoutMs: 180_000 });
      connection.send({ type: "rollback_to_commit", commitHash });
      const event = await complete;
      return { previewUrl: event.previewURL, commitHash, agentId: session.agentId };
    },

    async deploy(project: VibeSdkProject) {
      const session = await sessionFor(project);
      if (!session) throw new VibeSdkAdapterError("Generate the project before deploying it.", "RUNTIME_UPSTREAM_ERROR", 409);
      const complete = session.wait.cloudflareDeployed({ timeoutMs: 240_000 });
      session.deployCloudflare();
      const event = await complete;
      return {
        url: event.deploymentUrl,
        workersUrl: event.workersUrl,
        commitHash: (event as any).commitHash as string | undefined,
        agentId: session.agentId,
      };
    },
  };
}