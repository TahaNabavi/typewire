import type { EndpointDefZ } from "@tahanabavi/typefetch";
import CryptoJS from "crypto-js";
import forge from "node-forge";
import {
  decryptRequestBody,
  encryptResponseData,
} from "../encryption/encryption";
import { encryptValue, decryptValue } from "../encryption/crypto";
import type { KeyMaterial } from "../encryption/types";

const symKey: KeyMaterial = { type: "symmetric", key: "s3cr3t-passphrase" };

// --- Simulate the CLIENT exactly (same primitives it ships) -----------------
const clientAesEncrypt = (v: string) => CryptoJS.AES.encrypt(v, symKey.key as any).toString();
const clientAesDecrypt = (v: string) =>
  CryptoJS.AES.decrypt(v, symKey.key as any).toString(CryptoJS.enc.Utf8);
// client request-encrypt serialization
const clientSerialize = (v: unknown) =>
  typeof v === "string" ? v : JSON.stringify(v);

describe("crypto primitives — round trips", () => {
  it.each(["AES", "DES", "Base64"] as const)("%s round-trips", async (method) => {
    const cipher = await encryptValue("hello world", method, symKey);
    expect(cipher).not.toBe("hello world");
    expect(await decryptValue(cipher, method, symKey)).toBe("hello world");
  });

  it("RSA round-trips with a generated key pair", async () => {
    const pair = forge.pki.rsa.generateKeyPair({ bits: 1024 });
    const key: KeyMaterial = {
      type: "rsa",
      publicKey: forge.pki.publicKeyToPem(pair.publicKey),
      privateKey: forge.pki.privateKeyToPem(pair.privateKey),
    };
    const cipher = await encryptValue("secret", "RSA", key);
    expect(await decryptValue(cipher, "RSA", key)).toBe("secret");
  });

  it("Custom uses the provided handlers", async () => {
    const handlers = {
      encrypt: (v: string) => `enc(${v})`,
      decrypt: (v: string) => v.slice(4, -1),
    };
    const cipher = await encryptValue("x", "Custom", symKey, handlers);
    expect(cipher).toBe("enc(x)");
    expect(await decryptValue(cipher, "Custom", symKey, handlers)).toBe("x");
  });
});

describe("decryptRequestBody — decrypts what the client encrypted", () => {
  const endpoint: Pick<EndpointDefZ, "encryption"> = {
    encryption: {
      method: "AES",
      request: { password: true, profile: { pin: true } },
    },
  };

  it("recovers plaintext, restoring non-string types via safeJsonParse", async () => {
    // client encrypts each marked field with clientSerialize + AES
    const wire = {
      username: "taha", // not marked → untouched
      password: clientAesEncrypt(clientSerialize("hunter2")),
      profile: { pin: clientAesEncrypt(clientSerialize(1234)) },
    };

    const decrypted = (await decryptRequestBody(
      endpoint.encryption!,
      wire,
      symKey,
    )) as any;

    expect(decrypted.username).toBe("taha");
    expect(decrypted.password).toBe("hunter2");
    expect(decrypted.pin ?? decrypted.profile.pin).toBe(1234); // number restored
  });

  it("supports the { body: { ... } } map style", async () => {
    const enc = { method: "AES" as const, request: { body: { token: true } } };
    const wire = { token: clientAesEncrypt(clientSerialize("abc")) };
    const out = (await decryptRequestBody(enc, wire, symKey)) as any;
    expect(out.token).toBe("abc");
  });
});

describe("encryptResponseData — produces what the client can decrypt", () => {
  const encryption = { method: "AES" as const, response: { token: true, meta: { code: true } } };

  it("marked fields become ciphertext the client decrypts back to the original", async () => {
    const encrypted = (await encryptResponseData(
      encryption,
      { token: "jwt-value", meta: { code: 42 }, public: "ok" },
      symKey,
    )) as any;

    // untouched field
    expect(encrypted.public).toBe("ok");
    // marked fields are now strings the client decrypts
    expect(typeof encrypted.token).toBe("string");
    expect(encrypted.token).not.toBe("jwt-value");

    // CLIENT decrypts + safeJsonParse
    expect(clientAesDecrypt(encrypted.token)).toBe("jwt-value");
    expect(JSON.parse(clientAesDecrypt(encrypted.meta.code))).toBe(42);
  });

  it("full duplex: backend encrypt → client decrypt → backend decrypt of a round-trip field", async () => {
    const original = { token: "abc" };
    const enc = (await encryptResponseData(
      { method: "AES", response: { token: true } },
      original,
      symKey,
    )) as any;
    // decrypt back through the request path with the same map shape
    const back = (await decryptRequestBody(
      { method: "AES", request: { token: true } },
      enc,
      symKey,
    )) as any;
    expect(back.token).toBe("abc");
  });
});

describe("failure propagation", () => {
  it("rejects when a marked field cannot be decrypted", async () => {
    // RSA method with symmetric key material → decryptValue throws
    await expect(
      decryptRequestBody(
        { method: "RSA", request: { secret: true } },
        { secret: "some-string" },
        symKey,
      ),
    ).rejects.toThrow();
  });
});

describe("per-direction methods", () => {
  it("uses method.request / method.response independently", async () => {
    const enc = {
      method: { request: "AES" as const, response: "Base64" as const },
      request: { a: true },
      response: { b: true },
    };
    const decrypted = (await decryptRequestBody(
      enc,
      { a: clientAesEncrypt(clientSerialize("A")) },
      symKey,
    )) as any;
    expect(decrypted.a).toBe("A");

    const encrypted = (await encryptResponseData(enc, { b: "B" }, symKey)) as any;
    // Base64 response field
    expect(CryptoJS.enc.Base64.parse(encrypted.b).toString(CryptoJS.enc.Utf8)).toBe(
      "B",
    );
  });
});
