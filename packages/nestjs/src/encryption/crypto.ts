import type { EncryptionMethod } from "@tahanabavi/typefetch";
import type { CustomEncryptionHandlers, KeyMaterial } from "./types";

/**
 * Crypto primitives ported **verbatim** from the typefetch client's
 * `encryptionMiddleware` so ciphertext is byte-compatible in both
 * directions. The same libraries (`crypto-js`, `node-forge`) are used; they
 * are optional peers, required lazily only when encryption is actually used.
 */

let cryptoJs: any;
let forgeLib: any;

function getCryptoJs(): any {
  if (!cryptoJs) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      cryptoJs = require("crypto-js");
    } catch {
      throw new Error(
        "[typefetch-nestjs] contract encryption with AES/DES/Base64 requires " +
          "the optional peer dependency 'crypto-js'. Install it with " +
          "`npm i crypto-js`.",
      );
    }
  }
  return cryptoJs;
}

function getForge(): any {
  if (!forgeLib) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      forgeLib = require("node-forge");
    } catch {
      throw new Error(
        "[typefetch-nestjs] contract encryption with RSA requires the optional " +
          "peer dependency 'node-forge'. Install it with `npm i node-forge`.",
      );
    }
  }
  return forgeLib;
}

function encryptWithAES(value: string, key: string): string {
  return getCryptoJs().AES.encrypt(value, key).toString();
}

function decryptWithAES(value: string, key: string): string {
  const CryptoJS = getCryptoJs();
  return CryptoJS.AES.decrypt(value, key).toString(CryptoJS.enc.Utf8);
}

function encryptWithDES(value: string, key: string): string {
  return getCryptoJs().DES.encrypt(value, key).toString();
}

function decryptWithDES(value: string, key: string): string {
  const CryptoJS = getCryptoJs();
  return CryptoJS.DES.decrypt(value, key).toString(CryptoJS.enc.Utf8);
}

function encodeWithBase64(value: string): string {
  const CryptoJS = getCryptoJs();
  return CryptoJS.enc.Base64.stringify(CryptoJS.enc.Utf8.parse(value));
}

function decodeWithBase64(value: string): string {
  const CryptoJS = getCryptoJs();
  return CryptoJS.enc.Base64.parse(value).toString(CryptoJS.enc.Utf8);
}

function encryptWithRSA(value: string, publicKey: string): string {
  const forge = getForge();
  const publicKeyObject = forge.pki.publicKeyFromPem(publicKey);
  const encrypted = publicKeyObject.encrypt(
    forge.util.encodeUtf8(value),
    "RSA-OAEP",
  );
  return forge.util.encode64(encrypted);
}

function decryptWithRSA(value: string, privateKey: string): string {
  const forge = getForge();
  const privateKeyObject = forge.pki.privateKeyFromPem(privateKey);
  const decrypted = privateKeyObject.decrypt(
    forge.util.decode64(value),
    "RSA-OAEP",
  );
  return forge.util.decodeUtf8(decrypted);
}

export async function encryptValue(
  value: string,
  method: EncryptionMethod,
  keyMaterial: KeyMaterial,
  customHandlers?: CustomEncryptionHandlers,
): Promise<string> {
  switch (method) {
    case "AES":
      if (keyMaterial.type !== "symmetric") {
        throw new Error("AES encryption requires symmetric key material.");
      }
      return encryptWithAES(value, keyMaterial.key);

    case "DES":
      if (keyMaterial.type !== "symmetric") {
        throw new Error("DES encryption requires symmetric key material.");
      }
      return encryptWithDES(value, keyMaterial.key);

    case "Base64":
      return encodeWithBase64(value);

    case "RSA":
      if (keyMaterial.type !== "rsa") {
        throw new Error("RSA encryption requires RSA key material.");
      }
      return encryptWithRSA(value, keyMaterial.publicKey);

    case "Custom":
      if (!customHandlers) {
        throw new Error("Custom encryption requires custom handlers.");
      }
      return await customHandlers.encrypt(value, keyMaterial);

    default: {
      const exhaustive: never = method;
      throw new Error(`Unsupported encryption method: ${exhaustive}`);
    }
  }
}

export async function decryptValue(
  value: string,
  method: EncryptionMethod,
  keyMaterial: KeyMaterial,
  customHandlers?: CustomEncryptionHandlers,
): Promise<string> {
  switch (method) {
    case "AES":
      if (keyMaterial.type !== "symmetric") {
        throw new Error("AES decryption requires symmetric key material.");
      }
      return decryptWithAES(value, keyMaterial.key);

    case "DES":
      if (keyMaterial.type !== "symmetric") {
        throw new Error("DES decryption requires symmetric key material.");
      }
      return decryptWithDES(value, keyMaterial.key);

    case "Base64":
      return decodeWithBase64(value);

    case "RSA":
      if (keyMaterial.type !== "rsa") {
        throw new Error("RSA decryption requires RSA key material.");
      }
      return decryptWithRSA(value, keyMaterial.privateKey);

    case "Custom":
      if (!customHandlers) {
        throw new Error("Custom decryption requires custom handlers.");
      }
      return await customHandlers.decrypt(value, keyMaterial);

    default: {
      const exhaustive: never = method;
      throw new Error(`Unsupported decryption method: ${exhaustive}`);
    }
  }
}
