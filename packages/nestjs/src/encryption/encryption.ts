import type { EncryptionConfig, EncryptionMethod } from "@tahanabavi/typefetch";
import { decryptValue, encryptValue } from "./crypto";
import { getRequestBodyMap, processDeep, safeJsonParse } from "./process-deep";
import type { CustomEncryptionHandlers, KeyMaterial } from "./types";

type AnyEncryption = EncryptionConfig<unknown, unknown>;

/** Resolve the per-direction method exactly as the client does. */
export function resolveRequestMethod(encryption: AnyEncryption): EncryptionMethod {
  return typeof encryption.method === "string"
    ? encryption.method
    : (encryption.method?.request ?? "AES");
}

export function resolveResponseMethod(encryption: AnyEncryption): EncryptionMethod {
  return typeof encryption.method === "string"
    ? encryption.method
    : (encryption.method?.response ?? "AES");
}

/**
 * Decrypt the incoming request body — the inverse of what the client's
 * `encryptionMiddleware` did before sending. Only string fields are treated
 * as ciphertext; each is decrypted, then `safeJsonParse`d back to its
 * original value (mirroring the client's response-decrypt transform). Runs
 * **before** contract validation so schemas see plaintext.
 */
export async function decryptRequestBody(
  encryption: AnyEncryption,
  body: unknown,
  keyMaterial: KeyMaterial,
  customHandlers?: CustomEncryptionHandlers,
): Promise<unknown> {
  if (!encryption.request || body == null) return body;

  const method = resolveRequestMethod(encryption);
  const bodyMap = getRequestBodyMap(encryption.request);

  return processDeep(body, bodyMap, method, async (value, m) => {
    if (typeof value !== "string") return value;
    const decrypted = await decryptValue(value, m, keyMaterial, customHandlers);
    return safeJsonParse(decrypted);
  });
}

/**
 * Encrypt the outgoing response fields — mirroring what the client's
 * `encryptionMiddleware` will decrypt on arrival. Non-string values are
 * `JSON.stringify`d before encryption (the client's request-encrypt
 * transform), so `safeJsonParse` restores them client-side. Runs **after**
 * contract-response validation.
 */
export async function encryptResponseData(
  encryption: AnyEncryption,
  data: unknown,
  keyMaterial: KeyMaterial,
  customHandlers?: CustomEncryptionHandlers,
): Promise<unknown> {
  if (!encryption.response || data == null) return data;

  const method = resolveResponseMethod(encryption);

  return processDeep(data, encryption.response, method, async (value, m) => {
    const serialized =
      typeof value === "string" ? value : JSON.stringify(value);
    return encryptValue(serialized, m, keyMaterial, customHandlers);
  });
}
