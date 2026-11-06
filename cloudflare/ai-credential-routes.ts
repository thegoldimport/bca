import { encryptAiCredential } from "../vibesdk-candidate/shared/ai-credential-crypto";
import { AI_MODEL_OPTIONS, getSupportedAiModel } from "../vibesdk-candidate/shared/ai-provider-catalog";
import { hasValidCsrfToken } from "./staging/auth";
import { stockThinkRequest } from "./staging/think-runtime";

type AiCredentialEnv = {
  DB: D1Database;
  BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET?: string;
  AUTH_RUNTIME?: Fetcher;
  AUTH_RUNTIME_URL?: string;
  ENVIRONMENT?: string;
  CONTROL_PLANE_PROFILE?: string;
};

type CredentialUser = { id: string };

type CredentialRow = {
  mode: "managed" | "byok";
  provider: string;
  model_id: string;
  encrypted_api_key: string;
  updated_at: string;
};

function noStore(data: unknown, init: ResponseInit = {}): Response {
  return Response.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...init.headers },
  });
}

function validApiKey(value: unknown): value is string {
  return typeof value === "string"
    && value.trim().length >= 8
    && value.trim().length <= 4096
    && !/[\u0000-\u001f\u007f]/.test(value);
}

async function syncUserAgents(
  env: AiCredentialEnv,
  request: Request,
  userId: string,
): Promise<{ total: number; refreshed: number }> {
  const rows = await env.DB.prepare(
    "SELECT l.agent_id FROM runtime_project_links l JOIN projects p ON p.id=l.project_id " +
    "WHERE p.user_id=? AND l.agent_id IS NOT NULL AND l.runtime_provider='stock-think' " +
    "AND l.initialization_status='ready'",
  ).bind(userId).all<{ agent_id: string }>();
  const agentIds = (rows.results || [])
    .map((row) => row.agent_id)
    .filter((id) => /^[a-zA-Z0-9_-]{1,120}$/.test(id));
  let refreshed = 0;
  for (let offset = 0; offset < agentIds.length; offset += 4) {
    const batch = agentIds.slice(offset, offset + 4);
    const results = await Promise.all(batch.map(async (agentId) => {
      try {
        const response = await stockThinkRequest(
          env,
          request,
          `/api/agent/${agentId}/buildcustom-ai-config/refresh`,
          { method: "POST", body: {} },
        );
        return response.ok;
      } catch {
        return false;
      }
    }));
    refreshed += results.filter(Boolean).length;
  }
  return { total: agentIds.length, refreshed };
}

export async function handleAiCredentialRoute(
  env: AiCredentialEnv,
  request: Request,
  pathname: string,
  input: Record<string, unknown>,
  user: CredentialUser,
): Promise<Response | null> {
  if (pathname !== "/api/ai-credentials") return null;

  if (request.method === "GET") {
    const row = await env.DB.prepare(
      "SELECT mode,provider,model_id,updated_at FROM user_ai_credentials WHERE user_id=?",
    ).bind(user.id).first<Pick<CredentialRow, "mode" | "provider" | "model_id"> & { updated_at: string }>();
    const hasKey = row?.mode === "byok";
    return noStore({
      mode: hasKey ? "byok" : "managed",
      provider: hasKey ? row?.provider || null : null,
      modelId: hasKey ? row?.model_id || null : null,
      keySaved: hasKey,
      updatedAt: row?.updated_at || null,
      byokAvailable: typeof env.BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET === "string"
        && env.BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET.length >= 32,
      providers: AI_MODEL_OPTIONS,
    });
  }

  if (request.method === "PUT") {
    if (!hasValidCsrfToken(request)) return noStore({ message: "A secure request is required." }, { status: 403 });
    const secret = env.BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET;
    if (typeof secret !== "string" || secret.length < 32) {
      return noStore({ message: "Bring-your-own-key settings are not configured yet." }, { status: 503 });
    }
    const model = getSupportedAiModel(input.modelId);
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (!model || !validApiKey(apiKey)) {
      return noStore({ message: "Choose a supported model and enter a valid provider API key." }, { status: 400 });
    }
    const encrypted = await encryptAiCredential(secret, apiKey);
    await env.DB.prepare(
      "INSERT INTO user_ai_credentials(user_id,mode,provider,model_id,encrypted_api_key,updated_at) " +
      "VALUES(?,'byok',?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET " +
      "mode='byok',provider=excluded.provider,model_id=excluded.model_id,encrypted_api_key=excluded.encrypted_api_key,updated_at=datetime('now')",
    ).bind(user.id, model.provider, model.id, encrypted).run();
    const sync = await syncUserAgents(env, request, user.id);
    return noStore({
      mode: "byok",
      provider: model.provider,
      modelId: model.id,
      keySaved: true,
      appliedToExistingProjects: sync.refreshed === sync.total,
      projectsRefreshed: sync.refreshed,
      projectsPending: sync.total - sync.refreshed,
    });
  }

  if (request.method === "DELETE") {
    if (!hasValidCsrfToken(request)) return noStore({ message: "A secure request is required." }, { status: 403 });
    await env.DB.prepare(
      "INSERT INTO user_ai_credentials(user_id,mode,provider,model_id,encrypted_api_key,updated_at) " +
      "VALUES(?,'managed',NULL,NULL,NULL,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET " +
      "mode='managed',provider=NULL,model_id=NULL,encrypted_api_key=NULL,updated_at=datetime('now')",
    ).bind(user.id).run();
    const sync = await syncUserAgents(env, request, user.id);
    return noStore({
      mode: "managed",
      keySaved: false,
      appliedToExistingProjects: sync.refreshed === sync.total,
      projectsRefreshed: sync.refreshed,
      projectsPending: sync.total - sync.refreshed,
    });
  }

  return noStore({ message: "Method not allowed." }, { status: 405, headers: { Allow: "GET, PUT, DELETE" } });
}

