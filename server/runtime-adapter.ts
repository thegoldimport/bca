import { Readable } from "node:stream";

export type RuntimeProjectRef = {
  id: string;
  name: string;
  type?: string;
  description?: string;
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

type RuntimeRequestOptions = RequestInit & { query?: Record<string, string | undefined> };

function runtimeBaseUrl() {
  const value = process.env.VIBESDK_RUNTIME_URL?.trim();
  if (!value) {
    throw new RuntimeAdapterError(
      "The VibeSDK runtime is not configured. Set VIBESDK_RUNTIME_URL before using runtime-backed projects.",
      "RUNTIME_UNCONFIGURED",
    );
  }
  return value.replace(/\/+$/, "");
}

function runtimeHeaders(headers?: HeadersInit) {
  const result = new Headers(headers);
  result.set("Accept", result.get("Accept") || "application/json");
  const token = process.env.VIBESDK_RUNTIME_TOKEN;
  if (token) result.set("Authorization", `Bearer ${token}`);
  return result;
}

async function runtimeFetch(path: string, options: RuntimeRequestOptions = {}) {
  const url = new URL(`${runtimeBaseUrl()}/${path.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(options.query || {})) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  const headers = runtimeHeaders(options.headers);
  const response = await fetch(url, { ...options, headers });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new RuntimeAdapterError(
      `VibeSDK runtime request failed (${response.status})${body ? `: ${body.slice(0, 300)}` : ""}`,
      "RUNTIME_UPSTREAM_ERROR",
      502,
    );
  }
  return response;
}

export function runtimeProjectId(projectId: number) {
  return `buildcustom-project-${projectId}`;
}

export function isRuntimeConfigured() {
  return Boolean(process.env.VIBESDK_RUNTIME_URL?.trim());
}

export const runtimeAdapter = {
  async createProject(project: RuntimeProjectRef) {
    const response = await runtimeFetch("/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        name: project.name,
        type: project.type,
        description: project.description,
      }),
    });
    return response.json();
  },

  async files(projectId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/files`);
    return response.json();
  },

  async fileContent(projectId: string, path: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/files/content`, {
      query: { path },
    });
    return response.json();
  },

  async startAgentSession(projectId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/agent/sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    return response.json();
  },

  async agentMessage(projectId: string, body: unknown) {
    return runtimeFetch(`/projects/${encodeURIComponent(projectId)}/agent/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify(body),
    });
  },

  async revisions(projectId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/revisions`);
    return response.json();
  },

  async restoreRevision(projectId: string, revisionId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/revisions/${encodeURIComponent(revisionId)}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId }),
    });
    return response.json();
  },

  async createPreview(projectId: string, revisionId?: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/previews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId }),
    });
    return response.json();
  },

  async preview(projectId: string, previewId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/previews/${encodeURIComponent(previewId)}`);
    return response.json();
  },

  async console(projectId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/console`);
    return response.json();
  },

  async deploy(projectId: string, revisionId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/deployments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revisionId, environment: "staging" }),
    });
    return response.json();
  },

  async deployment(projectId: string, deploymentId: string) {
    const response = await runtimeFetch(`/projects/${encodeURIComponent(projectId)}/deployments/${encodeURIComponent(deploymentId)}`);
    return response.json();
  },
};

export async function streamRuntimeResponse(response: Response, res: any) {
  res.status(response.status);
  res.setHeader("Content-Type", response.headers.get("content-type") || "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  if (response.body) {
    Readable.fromWeb(response.body as any).pipe(res);
  } else {
    res.end();
  }
}