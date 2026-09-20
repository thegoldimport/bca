export type VibeSdkEnv = {
  VIBESDK_RUNTIME_URL?: string;
  VIBESDK_API_KEY?: string;
  VIBESDK_RUNTIME?: Fetcher;
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

/** Remap a runtime WebSocket URL to the service binding's HTTP transport. */
export function serviceBindingUrl(websocketUrl: string): string {
  const url = new URL(websocketUrl);
  url.protocol = url.protocol === "wss:" ? "https:" : "http:";
  return url.toString();
}

/** Deliberately omits credentials; safe for structured logs and API responses. */
export function publicRuntimeConfig(env: VibeSdkEnv): { runtimeUrl: string; configured: boolean } {
  const runtimeUrl = env.VIBESDK_RUNTIME_URL?.trim().replace(/\/+$/, "") || "";
  return { runtimeUrl, configured: Boolean(runtimeUrl && env.VIBESDK_API_KEY?.trim()) };
}

export function parseNdjson(text: string): unknown[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
}

export function hydratedGenerationRunning(message: any): boolean | null {
  const value = message?.state?.shouldBeGenerating ?? message?.shouldBeGenerating;
  return typeof value === "boolean" ? value : null;
}

type RuntimeActivity = { type: "tool" | "message"; label: string; path?: string; status?: string };
type RuntimeFile = { filePath: string; fileContents: string };
type RuntimeState = Record<string, any>;
type RuntimeConfig = { runtimeUrl: string; apiKey: string; accessToken?: string };

function errorFrom(error: unknown, fallback: string): VibeSdkAdapterError {
  if (error instanceof VibeSdkAdapterError) return error;
  return new VibeSdkAdapterError(error instanceof Error ? error.message : fallback, "RUNTIME_UPSTREAM_ERROR");
}

function extractFiles(state: RuntimeState): Map<string, string> {
  const files = new Map<string, string>();
  for (const value of Object.values(state.generatedFilesMap || {})) {
    const file = value as Partial<RuntimeFile>;
    if (typeof file.filePath === "string" && typeof file.fileContents === "string") files.set(file.filePath, file.fileContents);
  }
  return files;
}

function fileFromMessage(value: unknown): [string, string] | null {
  const file = value as Partial<RuntimeFile> | null;
  return file && typeof file.filePath === "string" && typeof file.fileContents === "string"
    ? [file.filePath, file.fileContents]
    : null;
}

function normalizeMessage(value: unknown): any | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as any;
  if (typeof raw.type === "string" && raw.type.trim().startsWith("{")) {
    try { return normalizeMessage(JSON.parse(raw.type)); } catch { return null; }
  }
  if (typeof raw.type === "string") return raw;
  if (raw.state && typeof raw.state === "object") return { type: "cf_agent_state", state: raw.state };
  if (typeof raw.behaviorType === "string" && typeof raw.projectType === "string") return { type: "cf_agent_state", state: raw };
  return null;
}

class ServiceSession {
  readonly files = new Map<string, string>();
  state: RuntimeState = {
    connection: "connecting",
    generation: { status: "idle" },
    phase: { status: "idle" },
    phases: [],
    preview: { status: "idle" },
    cloudflare: { status: "idle" },
  };
  private socket: WebSocket | null = null;
  private listeners = new Map<string, Set<(message: any) => void>>();
  private pendingRejects = new Set<(error: VibeSdkAdapterError) => void>();
  constructor(
    private readonly env: VibeSdkEnv,
    private readonly config: RuntimeConfig,
    readonly agentId: string,
    readonly websocketUrl: string,
  ) {}

  private emit(message: any) {
    for (const callback of this.listeners.get(message.type) || []) callback(message);
  }

  private apply(message: any) {
    if (message.state && typeof message.state === "object") {
      this.state = { ...this.state, ...message.state };
      const hydrated = extractFiles(message.state);
      if (hydrated.size) this.files.clear();
      for (const [path, content] of hydrated) this.files.set(path, content);
    }
    if (message.type === "agent_connected" || message.type === "cf_agent_state") this.state.connection = "connected";
    const shouldBeGenerating = hydratedGenerationRunning(message);
    if ((message.type === "agent_connected" || message.type === "cf_agent_state") && shouldBeGenerating !== null) {
      this.state.generation = {
        ...this.state.generation,
        status: shouldBeGenerating ? "running" : this.state.generation?.status || "idle",
      };
    }
    if (message.type === "conversation_response") this.state.lastConversationResponse = message;
    if (message.type === "conversation_state") this.state.conversationState = message.state;
    if (message.type === "file_generated" || message.type === "file_regenerated") {
      const file = fileFromMessage(message.file);
      if (file) this.files.set(file[0], file[1]);
    }
    if (message.type === "generation_started") this.state.generation = { status: "running", filesGenerated: 0, totalFiles: message.totalFiles };
    if (message.type === "generation_complete") this.state.generation = { status: "complete", filesGenerated: message.filesGenerated || this.files.size, previewURL: message.previewURL };
    if (message.type === "generation_stopped") this.state.generation = { status: "stopped", filesGenerated: message.filesGenerated || this.files.size };
    if (message.type === "deployment_started") this.state.preview = { status: "running" };
    if (message.type === "deployment_completed") this.state.preview = { status: "complete", previewURL: message.previewURL };
    if (message.type === "deployment_failed") this.state.preview = { status: "failed", error: message.error };
    if (message.type === "cloudflare_deployment_started") this.state.cloudflare = { status: "running" };
    if (message.type === "cloudflare_deployment_completed") this.state.cloudflare = { status: "complete", deploymentUrl: message.deploymentUrl, workersUrl: message.workersUrl };
    if (message.type === "cloudflare_deployment_error") this.state.cloudflare = { status: "failed", error: message.error };
    if (message.type === "error") this.state.lastError = message.error || message.message || "VibeSDK operation failed.";
    this.emit(message);
  }

  async connect() {
    const ticket = await runtimeRequest(this.env, this.config, "/api/ws-ticket", {
      method: "POST",
      body: JSON.stringify({ resourceType: "agent", resourceId: this.agentId }),
    });
    const response = await this.env.VIBESDK_RUNTIME!.fetch(new Request(serviceBindingUrl(this.websocketUrl) + `${this.websocketUrl.includes("?") ? "&" : "?"}ticket=${encodeURIComponent(ticket.data.ticket)}`, {
      headers: { Upgrade: "websocket" },
    }));
    const socket = (response as Response & { webSocket?: WebSocket }).webSocket;
    if (!socket) throw new VibeSdkAdapterError("VibeSDK WebSocket upgrade failed.", "RUNTIME_UPSTREAM_ERROR");
    this.socket = socket;
    socket.accept();
    socket.addEventListener("message", (event) => {
      try {
        const message = normalizeMessage(JSON.parse(typeof event.data === "string" ? event.data : String(event.data)));
        if (message) this.apply(message);
      } catch {
        // Ignore malformed runtime frames; the next terminal/error frame determines the operation result.
      }
    });
    socket.addEventListener("close", () => {
      this.state.connection = "disconnected";
      const error = new VibeSdkAdapterError("VibeSDK WebSocket closed before the operation completed.", "RUNTIME_UPSTREAM_ERROR");
      for (const reject of this.pendingRejects) reject(error);
      this.pendingRejects.clear();
      this.listeners.clear();
    });
    const connected = this.waitFor("agent_connected", 15_000);
    socket.send(JSON.stringify({ type: "session_init", credentials: {} }));
    socket.send(JSON.stringify({ type: "get_conversation_state" }));
    await connected;
    return this;
  }

  send(message: Record<string, unknown>) {
    if (!this.socket) throw new VibeSdkAdapterError("VibeSDK session is not connected.", "RUNTIME_UPSTREAM_ERROR", 409);
    this.socket.send(JSON.stringify(message));
  }

  waitFor(type: string | string[], timeoutMs: number): Promise<any> {
    return this.waitForWhere(type, () => true, timeoutMs);
  }

  waitForWhere(type: string | string[], predicate: (message: any) => boolean, timeoutMs: number): Promise<any> {
    const types = Array.isArray(type) ? type : [type];
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const rejectPending = (error: VibeSdkAdapterError) => {
        if (timer) clearTimeout(timer);
        for (const name of types) this.listeners.get(name)?.delete(complete);
        this.pendingRejects.delete(rejectPending);
        reject(error);
      };
      const complete = (message: any) => {
        if (!predicate(message)) return;
        if (timer) clearTimeout(timer);
        for (const name of types) this.listeners.get(name)?.delete(complete);
        this.pendingRejects.delete(rejectPending);
        resolve(message);
      };
      for (const name of types) {
        const callbacks = this.listeners.get(name) || new Set();
        callbacks.add(complete);
        this.listeners.set(name, callbacks);
      }
      this.pendingRejects.add(rejectPending);
      timer = setTimeout(() => {
        for (const name of types) this.listeners.get(name)?.delete(complete);
        this.pendingRejects.delete(rejectPending);
        reject(new VibeSdkAdapterError(`Timed out waiting for VibeSDK ${types.join(" or ")}.`, "RUNTIME_UPSTREAM_ERROR", 504));
      }, timeoutMs);
    });
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }
}

async function accessToken(env: VibeSdkEnv, config: RuntimeConfig): Promise<string> {
  if (config.accessToken) return config.accessToken;
  const response = env.VIBESDK_RUNTIME
    ? await env.VIBESDK_RUNTIME.fetch(new Request(`${config.runtimeUrl}/api/auth/exchange-api-key`, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}` } }))
    : await fetch(`${config.runtimeUrl}/api/auth/exchange-api-key`, { method: "POST", headers: { Authorization: `Bearer ${config.apiKey}` } });
  if (!response.ok) throw new VibeSdkAdapterError(`VibeSDK authentication returned HTTP ${response.status}.`, "RUNTIME_UPSTREAM_ERROR", response.status >= 500 ? 502 : response.status);
  const body = await response.json() as any;
  if (!body.success || typeof body.data?.accessToken !== "string") throw new VibeSdkAdapterError("VibeSDK authentication did not return an access token.", "RUNTIME_UPSTREAM_ERROR", 502);
  config.accessToken = body.data.accessToken;
  return config.accessToken;
}

async function runtimeRequest(env: VibeSdkEnv, config: RuntimeConfig, path: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await accessToken(env, config)}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const request = new Request(`${config.runtimeUrl}${path}`, { ...init, headers });
  const response = env.VIBESDK_RUNTIME
    ? await env.VIBESDK_RUNTIME.fetch(request)
    : await fetch(request);
  if (!response.ok) throw new VibeSdkAdapterError(`VibeSDK returned HTTP ${response.status}.`, "RUNTIME_UPSTREAM_ERROR", response.status >= 500 ? 502 : response.status);
  return await response.json();
}

async function createSession(env: VibeSdkEnv, config: RuntimeConfig, project: VibeSdkProject, prompt: string, images: VibeSdkImage[]) {
  const token = await accessToken(env, config);
  const response = env.VIBESDK_RUNTIME
    ? await env.VIBESDK_RUNTIME.fetch(new Request(`${config.runtimeUrl}/api/agent`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: prompt, behaviorType: "think", projectType: project.type || "app", selectedTemplate: "c-code-react-runner", images }),
    }))
    : await fetch(`${config.runtimeUrl}/api/agent`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ query: prompt, behaviorType: "think", projectType: project.type || "app", selectedTemplate: "c-code-react-runner", images }) });
  if (!response.ok) throw new VibeSdkAdapterError(`VibeSDK returned HTTP ${response.status}.`, "RUNTIME_UPSTREAM_ERROR", response.status >= 500 ? 502 : response.status);
  const events = parseNdjson(await response.text());
  const start = events.find((event: any) => event && typeof event.agentId === "string") as any;
  if (!start) throw new VibeSdkAdapterError("VibeSDK did not return an agent.", "RUNTIME_UPSTREAM_ERROR");
  return new ServiceSession(env, config, start.agentId, start.websocketUrl);
}

async function sessionFor(env: VibeSdkEnv, config: RuntimeConfig, project: VibeSdkProject) {
  if (!project.agentId) return null;
  const connected = await runtimeRequest(env, config, `/api/agent/${encodeURIComponent(project.agentId)}/connect`);
  const session = new ServiceSession(env, config, connected.data.agentId, connected.data.websocketUrl);
  try {
    await session.connect();
    return session;
  } catch (error) {
    session.close();
    throw error;
  }
}

function fileSummary(session: ServiceSession) {
  return [...session.files.entries()].map(([path, content]) => ({ path, name: path.split("/").pop() || path, type: "file" as const, size: content.length }));
}

function safeState(session: ServiceSession) {
  const response = session.state.lastConversationResponse;
  return {
    connection: session.state.connection,
    generation: {
      status: session.state.generation?.status || "idle",
      totalFiles: session.state.generation?.totalFiles,
      filesGenerated: session.state.generation?.filesGenerated,
      previewURL: session.state.generation?.previewURL,
    },
    phase: session.state.phase ? {
      status: session.state.phase.status,
      phase: session.state.phase.phase,
      totalPhases: session.state.phase.totalPhases,
    } : undefined,
    preview: session.state.preview ? {
      status: session.state.preview.status,
      previewURL: session.state.preview.previewURL,
      error: session.state.preview.error,
    } : undefined,
    cloudflare: session.state.cloudflare ? {
      status: session.state.cloudflare.status,
      deploymentUrl: session.state.cloudflare.deploymentUrl,
      workersUrl: session.state.cloudflare.workersUrl,
      error: session.state.cloudflare.error,
    } : undefined,
    lastConversationResponse: response ? { type: response.type, message: response.message, isStreaming: response.isStreaming, tool: response.tool ? { name: response.tool.name, status: response.tool.status, args: response.tool.args?.path ? { path: response.tool.args.path } : undefined } : undefined } : undefined,
  };
}

async function withSession<T>(env: VibeSdkEnv, config: RuntimeConfig, project: VibeSdkProject, callback: (session: ServiceSession) => Promise<T>) {
  const session = await sessionFor(env, config, project);
  if (!session) throw new VibeSdkAdapterError("This project has no VibeSDK agent.", "RUNTIME_UPSTREAM_ERROR", 409);
  try { return await callback(session); } catch (error) { throw errorFrom(error, "VibeSDK operation failed."); } finally { session.close(); }
}

export function createVibeSdkAdapter(env: VibeSdkEnv) {
  const config = validateRuntimeConfig(env);
  return {
    async create(project: VibeSdkProject, prompt: string, images: VibeSdkImage[] = []) {
      const session = await createSession(env, config, project, prompt, images);
      try { await session.connect(); return { agentId: session.agentId, status: "connected" }; } finally { session.close(); }
    },
    async plan(project: VibeSdkProject, message: string, images: VibeSdkImage[] = []) {
      const sourceContext = await withSession(env, config, project, async (session) =>
        [...session.files.entries()]
          .slice(0, 40)
          .map(([path, content]) => `--- ${path}\n${content.slice(0, 4_000)}`)
          .join("\n")
          .slice(0, 40_000),
      );
      const planner = await createSession(
        env,
        config,
        { name: `${project.name || "Project"} plan`, type: project.type },
        "Wait for the planning request. Do not generate or modify files.",
        [],
      );
      try {
        await planner.connect();
        const completed = planner.waitForWhere(
          ["conversation_response", "error"],
          (response) => response.type === "error" || (
            response.isStreaming === false
            && typeof response.message === "string"
            && response.message.trim().length > 0
          ),
          180_000,
        );
        planner.send({ type: "user_suggestion", message: `[[BUILDCUSTOM_PLAN_ONLY_V1]]\nPlan this request using the supplied snapshot of the current project.\nReturn a concise implementation plan for human approval.\nDo not modify files, call tools, commit, deploy, or claim any work was completed.\n\nREQUEST:\n${message}\n\nCURRENT PROJECT SNAPSHOT:\n${sourceContext || "(empty workspace)"}`, images });
        const response = await completed;
        if (response.type === "error") throw new VibeSdkAdapterError(response.error || response.message || "Planning failed.", "RUNTIME_UPSTREAM_ERROR");
        return { agentId: project.agentId, message: String(response.message || "").trim(), planOnly: true };
      } finally {
        planner.close();
      }
    },
    async build(project: VibeSdkProject, message: string, images: VibeSdkImage[] = [], initialGeneration = false) {
      return withSession(env, config, project, async (session) => {
        const before = new Map(session.files);
        const completed = session.waitFor(["generation_complete", "generation_stopped", "error"], 300_000);
        session.send(initialGeneration ? { type: "generate_all" } : { type: "user_suggestion", message, images });
        await completed;
        const state = session.state.generation;
        if (state.status === "stopped" || session.state.lastError) throw new VibeSdkAdapterError(session.state.lastError || "Build stopped.", "RUNTIME_UPSTREAM_ERROR", 409);
        const changedFiles = [...session.files.entries()].filter(([path, content]) => before.get(path) !== content).map(([path, content]) => ({ path, change: before.has(path) ? "modified" : "added", size: content.length }));
        return { agentId: session.agentId, message: session.state.lastConversationResponse?.message || "Completed your request.", files: session.files.size, previewUrl: session.state.preview?.previewURL || null, changedFiles, commitHash: session.state.lastDeployedCommit || null, activity: [] as RuntimeActivity[] };
      });
    },
    async files(project: VibeSdkProject) {
      return withSession(env, config, project, async (session) => ({ files: fileSummary(session) }));
    },
    async fileContent(project: VibeSdkProject, path: string) {
      return withSession(env, config, project, async (session) => {
        const content = session.files.get(path);
        if (content === undefined) throw new VibeSdkAdapterError("Runtime file not found.", "RUNTIME_UPSTREAM_ERROR", 404);
        return { path, content };
      });
    },
    async status(project: VibeSdkProject) {
      if (!project.agentId) return { configured: true, provider: "vibesdk", agentId: null, connected: false, state: null, files: 0 };
      return withSession(env, config, project, async (session) => ({ configured: true, provider: "vibesdk", agentId: session.agentId, connected: true, state: safeState(session), files: session.files.size }));
    },
    async preview(project: VibeSdkProject) {
      return withSession(env, config, project, async (session) => {
        const completed = session.waitFor(["deployment_completed", "deployment_failed"], 180_000);
        session.send({ type: "preview" });
        const event = await completed;
        if (event.type === "deployment_failed") throw new VibeSdkAdapterError(event.error || "Preview failed.", "RUNTIME_UPSTREAM_ERROR");
        return { url: event.previewURL, previewUrl: event.previewURL, agentId: session.agentId };
      });
    },
    async stop(project: VibeSdkProject) {
      return withSession(env, config, project, async (session) => {
        if (session.state.generation?.status !== "running") {
          session.send({ type: "stop_generation" });
          return { stopped: false, accepted: true, acknowledged: false, agentId: session.agentId };
        }
        const stopped = session.waitFor(["generation_stopped", "generation_complete", "error"], 30_000);
        session.send({ type: "stop_generation" });
        const event = await stopped;
        return { stopped: event.type === "generation_stopped", acknowledged: true, terminalState: event.type, agentId: session.agentId };
      });
    },
    async restore(project: VibeSdkProject, commitHash: string) {
      return withSession(env, config, project, async (session) => {
        const completed = session.waitFor(["deployment_completed", "deployment_failed"], 180_000);
        session.send({ type: "rollback_to_commit", commitHash });
        const event = await completed;
        if (event.type === "deployment_failed") throw new VibeSdkAdapterError(event.error || "Restore failed.", "RUNTIME_UPSTREAM_ERROR");
        return { previewUrl: event.previewURL, commitHash, agentId: session.agentId };
      });
    },
    async deploy(project: VibeSdkProject) {
      return withSession(env, config, project, async (session) => {
        const completed = session.waitFor(["cloudflare_deployment_completed", "cloudflare_deployment_error"], 240_000);
        session.send({ type: "deploy" });
        const event = await completed;
        if (event.type === "cloudflare_deployment_error") throw new VibeSdkAdapterError(event.error || "Publish failed.", "RUNTIME_UPSTREAM_ERROR");
        return { url: event.deploymentUrl, workersUrl: event.workersUrl, commitHash: event.commitHash, agentId: session.agentId };
      });
    },
  };
}