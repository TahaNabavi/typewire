import "reflect-metadata";
import {
  Controller,
  Get,
  INestApplication,
  NotFoundException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Contracts } from "@tahanabavi/typefetch";
import request from "supertest";
import { z } from "zod";
import {
  ContractInput,
  InferRequest,
  InferResponse,
  TypeFetchEndpoint,
  TypeFetchModule,
} from "../index";

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    createUser: {
      method: "POST",
      path: "/users",
      request: z.object({ body: z.object({ name: z.string().min(2) }) }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
  },
  broken: {
    badResponse: {
      method: "GET",
      path: "/broken",
      request: z.object({}),
      response: z.object({ mustExist: z.string() }),
    },
  },
} as const satisfies Contracts;

type GetUser = typeof contracts.user.getUser;
type CreateUser = typeof contracts.user.createUser;

@Controller()
class AppController {
  @TypeFetchEndpoint(contracts.user.getUser)
  getUser(@ContractInput() input: InferRequest<GetUser>): InferResponse<GetUser> {
    return { id: input.path.id, name: "Taha" };
  }

  @TypeFetchEndpoint(contracts.user.createUser)
  createUser(
    @ContractInput() input: InferRequest<CreateUser>,
  ): InferResponse<CreateUser> {
    return { id: "u-1", name: input.body.name };
  }

  @TypeFetchEndpoint(contracts.broken.badResponse)
  broken() {
    return { wrong: "shape" } as any;
  }

  // a plain, non-contract route: the envelope must wrap it too
  @Get("ping")
  ping() {
    return { pong: true };
  }

  @Get("missing")
  missing() {
    throw new NotFoundException("no such thing");
  }
}

// The exact wrapper a frontend would register via client.setResponseWrapper().
const clientWrapper = (successResponse: z.ZodTypeAny) =>
  z.union([
    z.object({ success: z.literal(true), data: successResponse }),
    z.object({ success: z.literal(false), message: z.string() }),
  ]);

describe("response envelope (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TypeFetchModule.forRoot({ envelope: true })],
      controllers: [AppController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  it("wraps a successful contract response in { success: true, data }", async () => {
    const res = await http().get("/users/42").expect(200);
    expect(res.body).toEqual({
      success: true,
      data: { id: "42", name: "Taha" },
    });
  });

  it("produces output the client's own wrapper schema can parse & unwrap", async () => {
    const res = await http().get("/users/42").expect(200);

    // This is the whole point: the frontend wrapper parses the backend body.
    const parsed = clientWrapper(contracts.user.getUser.response).parse(res.body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({ id: "42", name: "Taha" });
    }
  });

  it("wraps validation errors into the { success: false } branch (status preserved)", async () => {
    const res = await http().post("/users").send({ name: "x" }).expect(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Request validation failed");
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.errors["body.name"]).toBeDefined();

    // the client wrapper accepts the failure branch
    const parsed = clientWrapper(contracts.user.createUser.response).parse(res.body);
    expect(parsed.success).toBe(false);
  });

  it("wraps response-contract violations (500) as a failure envelope", async () => {
    const res = await http().get("/broken").expect(500);
    expect(res.body.success).toBe(false);
    expect(res.body.code).toBe("RESPONSE_CONTRACT_VIOLATION");
  });

  it("wraps ordinary Nest exceptions (404) into the envelope", async () => {
    const res = await http().get("/missing").expect(404);
    expect(res.body).toEqual({ success: false, message: "no such thing" });
  });

  it("wraps non-contract routes too (uniform API shape)", async () => {
    const res = await http().get("/ping").expect(200);
    expect(res.body).toEqual({ success: true, data: { pong: true } });
  });
});

describe("response envelope — custom shape + errorStatus 200", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TypeFetchModule.forRoot({
          envelope: {
            success: (data) => ({ ok: true, result: data }),
            error: (e) => ({ ok: false, reason: e.message }),
            errorStatus: 200,
          },
        }),
      ],
      controllers: [AppController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("uses the custom success shape", async () => {
    const res = await request(app.getHttpServer()).get("/users/7").expect(200);
    expect(res.body).toEqual({ ok: true, result: { id: "7", name: "Taha" } });
  });

  it("returns errors as 200 with the custom error shape", async () => {
    const res = await request(app.getHttpServer())
      .get("/missing")
      .expect(200);
    expect(res.body).toEqual({ ok: false, reason: "no such thing" });
  });
});
