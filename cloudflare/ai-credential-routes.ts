import { decryptAiCredential, encryptAiCredential } from "../vibesdk-candidate/shared/ai-credential-crypto";
import { AI_PROVIDER_OPTIONS } from "../vibesdk-candidate/shared/ai-provider-catalog";
import {
  discoverAiModels,
  isAiProviderId,
  type AiProviderId,
  type DiscoveredAiModel,
} from "../vibesdk-candidate/shared/ai-model-discovery";
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
  provider: string | null;
  model_id: string | null;
  encrypted_api_key: string | null;
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

function providerResponse(
  provider: AiProviderId,
  models: DiscoveredAiModel[],
  unavailable: Array<{ providerModelId: string; label: string; reason: string }>,
) {
  return {
    provider,
    providerLabel: AI_PROVIDER_OPTIONS.find((option) => option.id === provider)?.label || provider,
    models,
    unavailable,
    validation: "model-list-access" as const,
  };
}

async function loadSavedCredential(
  env: AiCredentialEnv,
  userId: string,
): Promise<{ provider: AiProviderId; modelId: string; apiKey: string } | null> {
  const row = await env.DB.prepare(
    "SELECT mode,provider,model_id,encrypted_api_key,updated_at FROM user_ai_credentials WHERE user_id=?",
  ).bind(userId).first<CredentialRow>();
  if (!row || row.mode !== "byok") return null;
  if (!isAiProviderId(row.provider) || !row.model_id || !row.encrypted_api_key) {
    throw new Error("Saved AI provider settings are invalid.");
  }
  const secret = env.BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Bring-your-own-key settings are not configured yet.");
  }
  const apiKey = await decryptAiCredential(secret, row.encrypted_api_key);
  return { provider: row.provider, modelId: row.model_id, apiKey };
}

async function saveByokCredential(
  env: AiCredentialEnv,
  userId: string,
  provider: AiProviderId,
  model: DiscoveredAiModel,
  apiKey: string,
): Promise<void> {
  const secret = env.BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET;
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("Bring-your-own-key settings are not configured yet.");
  }
  const encrypted = await encryptAiCredential(secret, apiKey);
  await env.DB.prepare(
    "INSERT INTO user_ai_credentials(user_id,mode,provider,model_id,encrypted_api_key,updated_at) " +
    "VALUES(?,'byok',?,?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET " +
    "mode='byok',provider=excluded.provider,model_id=excluded.model_id,encrypted_api_key=excluded.encrypted_api_key,updated_at=datetime('now')",
  ).bind(userId, provider, model.id, encrypted).run();
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
  providerFetch: typeof fetch = fetch,
): Promise<Response | null> {
  const basePath = "/api/ai-credentials";
  if (pathname !== basePath && pathname !== `${basePath}/connect`
    && pathname !== `${basePath}/models` && pathname !== `${basePath}/model`) return null;

  if (pathname === basePath && request.method === "GET") {
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
      providers: AI_PROVIDER_OPTIONS,
    });
  }

  if (request.method === "POST" && pathname === `${basePath}/connect`) {
    if (!hasValidCsrfToken(request)) return noStore({ message: "A secure request is required." }, { status: 403 });
    const secret = env.BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET;
    if (typeof secret !== "string" || secret.length < 32) {
      return noStore({ message: "Bring-your-own-key settings are not configured yet." }, { status: 503 });
    }
    const provider = isAiProviderId(input.provider) ? input.provider : null;
    const apiKey = typeof input.apiKey === "string" ? input.apiKey.trim() : "";
    if (!provider || !validApiKey(apiKey)) {
      return noStore({ message: "Choose a supported provider and enter its API key." }, { status: 400 });
    }
    let discovered;
    try {
      discovered = await discoverAiModels(provider, apiKey, providerFetch);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The provider key could not be validated.";
      return noStore({ message }, { status: 422 });
    }
    const model = discovered.models[0];
    await saveByokCredential(env, user.id, provider, model, apiKey);
    const sync = await syncUserAgents(env, request, user.id);
    return noStore({
      mode: "byok",
      ...providerResponse(provider, discovered.models, discovered.unavailable),
      modelId: model.id,
      keySaved: true,
      appliedToExistingProjects: sync.refreshed === sync.total,
      projectsRefreshed: sync.refreshed,
      projectsPending: sync.total - sync.refreshed,
    });
  }

  if (request.method === "POST" && pathname === `${basePath}/models`) {
    if (!hasValidCsrfToken(request)) return noStore({ message: "A secure request is required." }, { status: 403 });
    const secret = env.BUILDCUSTOM_AI_CREDENTIALS_ENCRYPTION_SECRET;
    if (typeof secret !== "string" || secret.length < 32) {
      return noStore({ message: "Bring-your-own-key settings are not configured yet." }, { status: 503 });
    }
    try {
      const saved = await loadSavedCredential(env, user.id);
      if (!saved) return noStore({ message: "Connect a provider key before refreshing its models." }, { status: 409 });
      const discovered = await discoverAiModels(saved.provider, saved.apiKey, providerFetch);
      return noStore({
        ...providerResponse(saved.provider, discovered.models, discovered.unavailable),
        modelId: saved.modelId,
        keySaved: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Saved provider models could not be refreshed.";
      return noStore({ message }, { status: 422 });
    }
  }

  if (request.method === "PUT" && pathname === `${basePath}/model`) {
    if (!hasValidCsrfToken(request)) return noStore({ message: "A secure request is required." }, { status: 403 });
    const requestedModelId = typeof input.modelId === "string" ? input.modelId : "";
    try {
      const saved = await loadSavedCredential(env, user.id);
      if (!saved) return noStore({ message: "Connect a provider key before choosing a model." }, { status: 409 });
      const discovered = await discoverAiModels(saved.provider, saved.apiKey, providerFetch);
      const model = discovered.models.find((candidate) => candidate.id === requestedModelId);
      if (!model) {
        return noStore({
          message: "That model is not currently available as a compatible model for this provider key.",
          unavailable: discovered.unavailable,
        }, { status: 400 });
      }
      await env.DB.prepare(
        "UPDATE user_ai_credentials SET model_id=?,updated_at=datetime('now') WHERE user_id=? AND mode='byok'",
      ).bind(model.id, user.id).run();
      const sync = await syncUserAgents(env, request, user.id);
      return noStore({
        mode: "byok",
        provider: saved.provider,
        modelId: model.id,
        keySaved: true,
        appliedToExistingProjects: sync.refreshed === sync.total,
        projectsRefreshed: sync.refreshed,
        projectsPending: sync.total - sync.refreshed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "The selected model could not be saved.";
      return noStore({ message }, { status: 422 });
    }
  }

  if (request.method === "DELETE" && pathname === basePath) {
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

  return noStore({ message: "Method not allowed." }, { status: 405, headers: { Allow: "GET, POST, PUT, DELETE" } });
}

