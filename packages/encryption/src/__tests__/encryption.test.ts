import z from "zod";
import forge from "node-forge";
import CryptoJS from "crypto-js";
import type { EndpointDefZ, MiddlewareContext } from "@tahanabavi/typefetch";
import { encryptionMiddleware } from "../encryption";
import type { EncryptionOptions } from "../encryption";

// Carried over verbatim from typefetch's middleware suite, which is where these
// tests lived before encryption became its own package.
const defaultEndpoint: EndpointDefZ = {
  method: "GET",
  path: "/test",
  request: z.object({}),
  response: z.object({}),
  auth: false,
};

const createCtx = (
  url: string = "/test",
  method: string = "GET",
): MiddlewareContext => ({
  url,
  init: {
    method,
    headers: {},
  },
  endpoint: defaultEndpoint,
});

const createNext = (payload: unknown = { ok: true, status: 200 }) =>
  jest.fn<Promise<Response>, []>(() =>
    Promise.resolve(
      new Response(JSON.stringify(payload), {
        status: (payload as any)?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );

describe("encryptionMiddleware", () => {
  const SYMMETRIC_KEY = "super-secret-key-123";
  let rsaPublicKey: string;
  let rsaPrivateKey: string;

  beforeAll(() => {
    const pair = forge.pki.rsa.generateKeyPair(512);
    rsaPublicKey = forge.pki.publicKeyToPem(pair.publicKey);
    rsaPrivateKey = forge.pki.privateKeyToPem(pair.privateKey);
  });

  const encryptionOptions: EncryptionOptions = {
    keyProvider: () => ({
      type: "symmetric",
      key: SYMMETRIC_KEY,
    }),
  };

  it("should skip if no encryption config is present on endpoint", async () => {
    const body = { plain: "data" };
    const ctx = createCtx();
    ctx.init.body = JSON.stringify(body);
    const next = createNext(body);

    await encryptionMiddleware(ctx, next, encryptionOptions);

    expect(ctx.init.body).toBe(JSON.stringify(body));
    expect(next).toHaveBeenCalled();
  });

  it("should encrypt request and decrypt response using AES (Default)", async () => {
    const requestData = { secret: "hello", public: "hi" };
    const responseData = { data: { token: "secret-token" }, status: "ok" };

    const ctx = createCtx("/secure", "POST");
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: {
        method: "AES",
        request: { secret: true },
        response: { data: { token: true } },
      },
    };
    ctx.init.body = JSON.stringify(requestData);

    const next = jest.fn(async () => {
      const body = JSON.parse(ctx.init.body as string);
      expect(body.secret).not.toBe("hello");
      expect(body.public).toBe("hi");

      const encryptedToken = CryptoJS.AES.encrypt(
        "secret-token",
        SYMMETRIC_KEY,
      ).toString();
      return new Response(
        JSON.stringify({ data: { token: encryptedToken }, status: "ok" }),
      );
    });

    const res = await encryptionMiddleware(ctx, next, encryptionOptions);
    const finalJson = await res.json();

    expect(finalJson.data.token).toBe("secret-token");
    expect(finalJson.status).toBe("ok");
  });

  it("should handle RSA encryption for request and Base64 for response", async () => {
    const optionsWithRSA: EncryptionOptions = {
      keyProvider: () => ({
        type: "rsa",
        publicKey: rsaPublicKey,
        privateKey: rsaPrivateKey,
      }),
    };

    const ctx = createCtx("/rsa-test", "POST");
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: {
        method: { request: "RSA", response: "Base64" },
        request: { pin: true },
        response: { msg: true },
      },
    };
    ctx.init.body = JSON.stringify({ pin: "1234" });

    const next = jest.fn(async () => {
      const body = JSON.parse(ctx.init.body as string);
      expect(body.pin).not.toBe("1234");

      const encodedMsg = Buffer.from("welcome").toString("base64");
      return new Response(JSON.stringify({ msg: encodedMsg }));
    });

    const res = await encryptionMiddleware(ctx, next, optionsWithRSA);
    const json = await res.json();

    expect(json.msg).toBe("welcome");
  });

  it("should handle deep nested objects and arrays", async () => {
    const ctx = createCtx();
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: {
        method: "Base64",
        request: {
          users: [{ password: true }],
          config: { deep: { key: true } },
        },
      },
    };

    const complexBody = {
      users: [
        { id: 1, password: "p1" },
        { id: 2, password: "p2" },
      ],
      config: { deep: { key: "secret-value", other: "plain" } },
    };
    ctx.init.body = JSON.stringify(complexBody);

    const next = createNext();
    await encryptionMiddleware(ctx, next, encryptionOptions);

    const parsed = JSON.parse(ctx.init.body as string);

    // Base64 check
    expect(parsed.users[0].password).toBe(
      Buffer.from("p1").toString("base64"),
    );
    expect(parsed.config.deep.key).toBe(
      Buffer.from("secret-value").toString("base64"),
    );
    expect(parsed.config.deep.other).toBe("plain");
  });

  it("should use Custom Handlers if method is 'Custom'", async () => {
    const customOptions: EncryptionOptions = {
      keyProvider: encryptionOptions.keyProvider,
      customHandlers: {
        encrypt: (v) => `custom_${v}`,
        decrypt: (v) => v.replace("custom_", ""),
      },
    };

    const ctx = createCtx();
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: {
        method: "Custom",
        request: { val: true },
        response: { res: true },
      },
    };
    ctx.init.body = JSON.stringify({ val: "test" });

    const next = jest.fn(async () => {
      return new Response(JSON.stringify({ res: "custom_done" }));
    });

    const res = await encryptionMiddleware(ctx, next, customOptions);
    const json = await res.json();

    expect(JSON.parse(ctx.init.body as string).val).toBe("custom_test");
    expect(json.res).toBe("done");
  });

  it("should throw on invalid JSON response by default", async () => {
    const ctx = createCtx();
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: { method: "AES", response: { data: true } },
    };

    const next = jest.fn(async () => {
      return new Response("Invalid Non-JSON Content", { status: 200 });
    });

    await expect(
      encryptionMiddleware(ctx, next, encryptionOptions),
    ).rejects.toThrow("Encryption middleware response decryption failed");
  });

  it("should fallback and log on invalid JSON response when failClosed is false", async () => {
    const ctx = createCtx();
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: { method: "AES", response: { data: true } },
    };

    const next = jest.fn(async () => {
      return new Response("Invalid Non-JSON Content", { status: 200 });
    });

    const consoleSpy = jest.spyOn(console, "error").mockImplementation();

    const res = await encryptionMiddleware(ctx, next, {
      ...encryptionOptions,
      failClosed: false,
    });
    const text = await res.text();

    expect(text).toBe("Invalid Non-JSON Content");
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "Encryption middleware response decryption failed.",
      ),
      expect.anything(),
    );

    consoleSpy.mockRestore();
  });

  it("should not send plaintext when request encryption fails", async () => {
    const ctx = createCtx("/secure", "POST");
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: {
        method: "AES",
        request: { secret: true },
      },
    };
    ctx.init.body = JSON.stringify({ secret: "do-not-leak" });

    const next = createNext();

    await expect(
      encryptionMiddleware(ctx, next, {
        keyProvider: () => ({
          type: "rsa",
          publicKey: rsaPublicKey,
          privateKey: rsaPrivateKey,
        }),
      }),
    ).rejects.toThrow("Encryption middleware request encryption failed");

    expect(next).not.toHaveBeenCalled();
  });

  it("should decrypt encrypted non-OK response payloads", async () => {
    const ctx = createCtx("/secure", "POST");
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: {
        method: "Base64",
        response: { message: true },
      },
    };

    const next = jest.fn(async () => {
      return new Response(
        JSON.stringify({
          message: Buffer.from("Bad Request").toString("base64"),
        }),
        { status: 400 },
      );
    });

    const res = await encryptionMiddleware(ctx, next, encryptionOptions);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.message).toBe("Bad Request");
  });

  it("should support mixed methods per field using string values in map", async () => {
    const ctx = createCtx();
    ctx.endpoint = {
      ...defaultEndpoint,
      encryption: {
        method: "AES", // Default
        request: {
          f1: true, // uses AES
          f2: "Base64", // overrides with Base64
        },
      },
    };
    ctx.init.body = JSON.stringify({ f1: "v1", f2: "v2" });

    await encryptionMiddleware(ctx, createNext(), encryptionOptions);
    const parsed = JSON.parse(ctx.init.body as string);

    expect(parsed.f2).toBe(Buffer.from("v2").toString("base64"));
    expect(parsed.f1).not.toBe("v1");
    expect(parsed.f1).not.toBe(Buffer.from("v1").toString("base64")); // It's AES
  });
});
