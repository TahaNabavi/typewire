import "reflect-metadata";
import { Controller, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Contracts } from "@tahanabavi/typefetch";
import CryptoJS from "crypto-js";
import request from "supertest";
import { z } from "zod";
import {
  ContractInput,
  InferRequest,
  InferResponse,
  TypeFetchEndpoint,
  TypeFetchModule,
} from "../index";

const KEY = "e2e-symmetric-key";

// The client side, reproduced with the exact primitives typefetch ships.
const clientEncrypt = (value: unknown) =>
  CryptoJS.AES.encrypt(
    typeof value === "string" ? value : JSON.stringify(value),
    KEY,
  ).toString();
const clientDecrypt = (cipher: string) =>
  CryptoJS.AES.decrypt(cipher, KEY).toString(CryptoJS.enc.Utf8);

const contracts = {
  auth: {
    login: {
      method: "POST",
      path: "/login",
      encryption: {
        method: "AES",
        request: { password: true },
        response: { token: true },
      },
      request: z.object({
        body: z.object({
          username: z.string(),
          password: z.string().min(6),
        }),
      }),
      response: z.object({ token: z.string(), user: z.string() }),
    },
    profile: {
      method: "GET",
      path: "/profile/:id",
      encryption: { method: "AES", response: { ssn: true } },
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string(), ssn: z.string() }),
    },
  },
} as const satisfies Contracts;

type Login = typeof contracts.auth.login;
type Profile = typeof contracts.auth.profile;

@Controller()
class AuthController {
  @TypeFetchEndpoint(contracts.auth.login)
  login(@ContractInput() input: InferRequest<Login>): InferResponse<Login> {
    // proves the handler received the DECRYPTED, validated password
    return {
      token: `granted:${input.body.password}`,
      user: input.body.username,
    };
  }

  @TypeFetchEndpoint(contracts.auth.profile)
  profile(@ContractInput() input: InferRequest<Profile>): InferResponse<Profile> {
    return { id: input.path.id, ssn: "123-45-6789" };
  }
}

describe("contract encryption (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeFetchModule.forRoot({
          encryption: {
            keyProvider: async () => ({ type: "symmetric", key: KEY }),
          },
        }),
      ],
      controllers: [AuthController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it("decrypts the request field before validation, and the handler sees plaintext", async () => {
    const res = await http()
      .post("/login")
      .send({ username: "taha", password: clientEncrypt("hunter2") })
      .expect(201);

    expect(res.body.user).toBe("taha");
    // response token is ciphertext; the client decrypts it back
    expect(res.body.token).not.toContain("granted:");
    expect(clientDecrypt(res.body.token)).toBe("granted:hunter2");
  });

  it("validates the DECRYPTED value (min length runs on plaintext, not ciphertext)", async () => {
    // decrypts to "abc" (3 chars) → fails password.min(6)
    const res = await http()
      .post("/login")
      .send({ username: "taha", password: clientEncrypt("abc") })
      .expect(400);

    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.errors["body.password"]).toBeDefined();
  });

  it("encrypts only the marked response field", async () => {
    const res = await http().get("/profile/u1").expect(200);

    expect(res.body.id).toBe("u1"); // untouched
    expect(res.body.ssn).not.toBe("123-45-6789"); // encrypted
    expect(clientDecrypt(res.body.ssn)).toBe("123-45-6789");
  });
});

describe("contract encryption — missing keyProvider fails closed", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // module imported WITHOUT an encryption config, but an endpoint needs it
    const moduleRef = await Test.createTestingModule({
      imports: [TypeFetchModule.forRoot({})],
      controllers: [AuthController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 500 ENCRYPTION_NOT_CONFIGURED instead of leaking plaintext", async () => {
    const res = await request(app.getHttpServer())
      .get("/profile/u1")
      .expect(500);
    expect(res.body.code).toBe("ENCRYPTION_NOT_CONFIGURED");
  });
});
