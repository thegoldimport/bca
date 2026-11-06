import { decryptAiCredential } from "./ai-credential-crypto";
import { isValidAiModelId } from "./ai-provider-catalog";

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

export function shouldUseStoredProviderKeys(hasCustomerKey: boolean, hasGatewayAuthorization: boolean): boolean {
  return !hasCustomerKey && !hasGatewayAuthorization;
}

export async function readAiCredentialForRuntime(
  db: AiCredentialDatabase,
  secret: string | undefined,
  userId: string,
): Promise<{ provider: string; modelId: string; apiKey: string } | null> {
  const row = await db.prepare(
    "SELECT mode,provider,model_id,encrypted_api_key FROM user_ai_credentials WHERE user_id=?",
  ).bind(userId).first<CredentialRow>();
  if (!row || row.mode === "managed") return null;
  const separator = row.model_id.indexOf("/");
  const modelProvider = separator > 0 ? row.model_id.slice(0, separator) : "";
  if (!isValidAiModelId(row.model_id) || modelProvider !== row.provider) {
    throw new Error("Saved AI provider settings are invalid.");
  }
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("AI credential encryption is unavailable.");
  }
  const apiKey = await decryptAiCredential(secret, row.encrypted_api_key);
  return { provider: row.provider, modelId: row.model_id, apiKey };
}
