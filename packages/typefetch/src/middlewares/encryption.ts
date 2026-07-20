import type { Middleware, DeepEncryptionMap, EncryptionMethod } from "@/types";
import CryptoJS from "crypto-js";
import forge from "node-forge";
import { z } from "zod";

type SymmetricKeyMaterial = {
  type: "symmetric";
  key: string;
};

type RSAKeyMaterial = {
  type: "rsa";
  publicKey: string;
  privateKey: string;
};

type KeyMaterial = SymmetricKeyMaterial | RSAKeyMaterial;

type CustomHandlers = {
  encrypt: (value: string, key: KeyMaterial) => string | Promise<string>;
  decrypt: (value: string, key: KeyMaterial) => string | Promise<string>;
};

export interface EncryptionOptions {
  keyProvider: () => KeyMaterial | Promise<KeyMaterial>;
  customHandlers?: CustomHandlers;

  /**
   * true  = throw when encryption/decryption fails, which avoids leaking plaintext.
   * false = log and continue/fallback to the original response.
   * Default: true
   */
  failClosed?: boolean;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.prototype.toString.call(value) === "[object Object]"
  );
}

function hasKey(value: unknown, key: string): value is Record<string, unknown> {
  return (
    isPlainObject(value) && Object.prototype.hasOwnProperty.call(value, key)
  );
}

function toMiddlewareError(message: string, error: unknown): Error {
  const err = new Error(
    `${message}: ${error instanceof Error ? error.message : "Unknown error"}`,
  );
  (err as any).cause = error;
  return err;
}

function encryptWithAES(value: string, key: string): string {
  return CryptoJS.AES.encrypt(value, key).toString();
}

function decryptWithAES(value: string, key: string): string {
  const bytes = CryptoJS.AES.decrypt(value, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

function encryptWithDES(value: string, key: string): string {
  return CryptoJS.DES.encrypt(value, key).toString();
}

function decryptWithDES(value: string, key: string): string {
  const bytes = CryptoJS.DES.decrypt(value, key);
  return bytes.toString(CryptoJS.enc.Utf8);
}

function encodeWithBase64(value: string): string {
  return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(value));
}

function decodeWithBase64(value: string): string {
  return CryptoJS.enc.Base64.parse(value).toString(CryptoJS.enc.Utf8);
}

function encryptWithRSA(value: string, publicKey: string): string {
  const publicKeyObject = forge.pki.publicKeyFromPem(publicKey);
  const encrypted = publicKeyObject.encrypt(
    forge.util.encodeUtf8(value),
    "RSA-OAEP",
  );
  return forge.util.encode64(encrypted);
}

function decryptWithRSA(value: string, privateKey: string): string {
  const privateKeyObject = forge.pki.privateKeyFromPem(privateKey);
  const decrypted = privateKeyObject.decrypt(
    forge.util.decode64(value),
    "RSA-OAEP",
  );
  return forge.util.decodeUtf8(decrypted);
}

async function encryptValue(
  value: string,
  method: EncryptionMethod,
  keyMaterial: KeyMaterial,
  customHandlers?: CustomHandlers,
): Promise<string> {
  switch (method) {
    case "AES": {
      if (keyMaterial.type !== "symmetric") {
        throw new Error("AES encryption requires symmetric key material.");
      }
      return encryptWithAES(value, keyMaterial.key);
    }

    case "DES": {
      if (keyMaterial.type !== "symmetric") {
        throw new Error("DES encryption requires symmetric key material.");
      }
      return encryptWithDES(value, keyMaterial.key);
    }

    case "Base64": {
      return encodeWithBase64(value);
    }

    case "RSA": {
      if (keyMaterial.type !== "rsa") {
        throw new Error("RSA encryption requires RSA key material.");
      }
      return encryptWithRSA(value, keyMaterial.publicKey);
    }

    case "Custom": {
      if (!customHandlers) {
        throw new Error("Custom encryption requires custom handlers.");
      }
      return await customHandlers.encrypt(value, keyMaterial);
    }

    default: {
      const exhaustiveCheck: never = method;
      throw new Error(`Unsupported encryption method: ${exhaustiveCheck}`);
    }
  }
}

async function decryptValue(
  value: string,
  method: EncryptionMethod,
  keyMaterial: KeyMaterial,
  customHandlers?: CustomHandlers,
): Promise<string> {
  switch (method) {
    case "AES": {
      if (keyMaterial.type !== "symmetric") {
        throw new Error("AES decryption requires symmetric key material.");
      }
      return decryptWithAES(value, keyMaterial.key);
    }

    case "DES": {
      if (keyMaterial.type !== "symmetric") {
        throw new Error("DES decryption requires symmetric key material.");
      }
      return decryptWithDES(value, keyMaterial.key);
    }

    case "Base64": {
      return decodeWithBase64(value);
    }

    case "RSA": {
      if (keyMaterial.type !== "rsa") {
        throw new Error("RSA decryption requires RSA key material.");
      }
      return decryptWithRSA(value, keyMaterial.privateKey);
    }

    case "Custom": {
      if (!customHandlers) {
        throw new Error("Custom decryption requires custom handlers.");
      }
      return await customHandlers.decrypt(value, keyMaterial);
    }

    default: {
      const exhaustiveCheck: never = method;
      throw new Error(`Unsupported decryption method: ${exhaustiveCheck}`);
    }
  }
}

export async function processDeep<T = unknown>(
  data: unknown,
  map: DeepEncryptionMap | null | undefined,
  defaultMethod: EncryptionMethod,
  transform: (value: unknown, method: EncryptionMethod) => Promise<unknown>,
): Promise<T> {
  if (data == null || map == null) return data as T;

  if (typeof map === "string") return (await transform(data, map)) as T;

  if (typeof map === "boolean") {
    return (map ? await transform(data, defaultMethod) : data) as T;
  }

  if (Array.isArray(data)) {
    if (!Array.isArray(map)) {
      return Promise.all(
        data.map((item) => processDeep(item, map, defaultMethod, transform)),
      ) as Promise<T>;
    }

    return Promise.all(
      data.map((item, idx) =>
        processDeep(item, map[idx] ?? map[0], defaultMethod, transform),
      ),
    ) as Promise<T>;
  }

  if (isPlainObject(data) && isPlainObject(map)) {
    const result: Record<string, unknown> = { ...data };

    for (const key of Object.keys(map)) {
      const childMap = (map as Record<string, DeepEncryptionMap>)[key];
      if (childMap == null) continue;

      const currentVal = result[key];
      if (currentVal !== undefined) {
        result[key] = await processDeep(
          currentVal,
          childMap,
          defaultMethod,
          transform,
        );
      }
    }

    return result as T;
  }

  return data as T;
}

function getRequestBodyMap(map: DeepEncryptionMap): DeepEncryptionMap {
  // Supports both styles:
  // encryption.request: { password: true }
  // encryption.request: { body: { password: true } }
  if (hasKey(map, "body")) {
    return map.body as DeepEncryptionMap;
  }

  return map;
}

export const encryptionMiddleware: Middleware<
  z.ZodTypeAny,
  z.ZodTypeAny,
  EncryptionOptions
> = async (ctx, next, options) => {
  if (!options) {
    throw new Error("Encryption middleware options were not provided.");
  }

  const { keyProvider, customHandlers } = options;
  const failClosed = options.failClosed ?? true;
  const encryption = ctx.endpoint.encryption;

  if (!encryption || (!encryption.request && !encryption.response)) {
    return next();
  }

  const requestMethod: EncryptionMethod =
    typeof encryption.method === "string"
      ? encryption.method
      : (encryption.method?.request ?? "AES");

  const responseMethod: EncryptionMethod =
    typeof encryption.method === "string"
      ? encryption.method
      : (encryption.method?.response ?? "AES");

  const keyMaterial = await keyProvider();

  if (
    encryption.request &&
    typeof ctx.init.body === "string" &&
    ctx.init.body.length > 0
  ) {
    try {
      const parsedBody = JSON.parse(ctx.init.body);
      const bodyMap = getRequestBodyMap(encryption.request);

      const encryptedBody = await processDeep(
        parsedBody,
        bodyMap,
        requestMethod,
        async (value, method) => {
          const serialized =
            typeof value === "string" ? value : JSON.stringify(value);

          return encryptValue(serialized, method, keyMaterial, customHandlers);
        },
      );

      ctx.init.body = JSON.stringify(encryptedBody);

      if (ctx.request) {
        ctx.request.body = encryptedBody;
      }
    } catch (error) {
      if (failClosed) {
        throw toMiddlewareError(
          "Encryption middleware request encryption failed",
          error,
        );
      }

      console.error("Encryption middleware request encryption failed.", error);
    }
  }

  const response = await next();

  if (!encryption.response) {
    return response;
  }

  try {
    const text = await response.clone().text();
    if (!text) return response;

    const parsedResponse = JSON.parse(text);

    const decryptedPayload = await processDeep(
      parsedResponse,
      encryption.response,
      responseMethod,
      async (value, method) => {
        if (typeof value !== "string") return value;

        const decrypted = await decryptValue(
          value,
          method,
          keyMaterial,
          customHandlers,
        );

        return safeJsonParse(decrypted);
      },
    );

    return new Response(JSON.stringify(decryptedPayload), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (failClosed) {
      throw toMiddlewareError(
        "Encryption middleware response decryption failed",
        error,
      );
    }

    console.error("Encryption middleware response decryption failed.", error);
    return response;
  }
};
