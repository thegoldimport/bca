const encoder = new TextEncoder();
const AAD = encoder.encode("buildcustom:user-ai-credential:v1");
const ENVELOPE_PREFIX = "v1";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    const end = Math.min(offset + 0x8000, bytes.length);
    for (let index = offset; index < end; index += 1) {
      binary += String.fromCharCode(bytes[index]);
    }
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deriveKey(secret: string): Promise<CryptoKey> {
  if (typeof secret !== "string" || secret.length < 32) {
    throw new Error("AI credential encryption is unavailable.");
  }
  const material = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`buildcustom:ai-credential-encryption:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", material, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function encryptAiCredential(secret: string, plaintext: string): Promise<string> {
  if (typeof plaintext !== "string" || plaintext.length < 8 || plaintext.length > 4096) {
    throw new Error("Invalid AI credential.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: AAD },
    await deriveKey(secret),
    encoder.encode(plaintext),
  );
  return `${ENVELOPE_PREFIX}.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function protectAiCredentialForStorage(
  secret: string,
  plaintext: string,
): Promise<{ apiKey: string; encryptedApiKey: string }> {
  return {
    apiKey: "buildcustom-encrypted-key",
    encryptedApiKey: await encryptAiCredential(secret, plaintext),
  };
}

export async function decryptAiCredential(secret: string, envelope: string): Promise<string> {
  if (typeof envelope !== "string" || envelope.length > 8192) {
    throw new Error("AI credential could not be decrypted.");
  }
  const [version, encodedIv, encodedCiphertext, extra] = envelope.split(".");
  if (version !== ENVELOPE_PREFIX || !encodedIv || !encodedCiphertext || extra !== undefined) {
    throw new Error("AI credential could not be decrypted.");
  }
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(encodedIv), additionalData: AAD },
      await deriveKey(secret),
      fromBase64(encodedCiphertext),
    );
    return new TextDecoder("utf-8", { fatal: true }).decode(plaintext);
  } catch {
    throw new Error("AI credential could not be decrypted.");
  }
}
