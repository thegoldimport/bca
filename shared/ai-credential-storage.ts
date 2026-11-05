import { decryptAiCredential } from "./ai-credential-crypto";
import { getSupportedAiModel } from "./ai-provider-catalog";

type CredentialRow = {
  mode: "managed" | "byok";
  provider: string;
  model_id: string;
  encrypted_api_key: string;
};

type AiCredentialDatabase = {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = unknown>(): Promise<T | null>;
    };
  };
};

export async function readAiCredentialForRuntime(
  db: AiCredentialDatabase,
  secret: string | undefined,
  userId: string,
): Promise<{ provider: string; modelId: string; apiKey: string } | null> {
  const row = await db.prepare(
    "SELECT mode,provider,model_id,encrypted_api_key FROM user_ai_credentials WHERE user_id=?",
  ).bind(userId).first<CredentialRow>();
  if (!row || row.mode === "managed") return null;
  const model = getSupportedAiModel(row.model_id);
  if (!model || model.provider !== row.provider) {
    throw new Error("Saved AI provider settings are invalid.");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("AI credential encryption is unavailable.");
  }
  const apiKey = await decryptAiCredential(secret, row.encrypted_api_key);
  return { provider: model.provider, modelId: model.id, apiKey };
}
