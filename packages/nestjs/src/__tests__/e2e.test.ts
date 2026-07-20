import "reflect-metadata";
import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import type { Contracts } from "@tahanabavi/typefetch";
import request from "supertest";
import { z } from "zod";
import {
  ContractBody,
  ContractInput,
  ContractPath,
  ContractQuery,
  getContractEndpoint,
  InferRequest,
  InferResponse,
  TypeFetchEndpoint,
  TypeFetchModule,
  UseContract,
} from "../index";

// ---------------------------------------------------------------------------
// The contract — in a real app this exact object is imported by the frontend
// ApiClient and by the NestJS controllers below.
// ---------------------------------------------------------------------------
const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({
        path: z.object({ id: z.string() }),
        query: z.object({ verbose: z.boolean().optional() }).optional(),
      }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    searchUsers: {
      method: "GET",
      path: "/users",
      request: z.object({
        query: z.object({
          page: z.number().int(),
          active: z.boolean().optional(),
          tags: z.array(z.string()).optional(),
          from: z.date().optional(),
        }),
      }),
      response: z.object({
        page: z.number(),
        active: z.boolean().optional(),
        tagCount: z.number(),
        fromYear: z.number().optional(),
      }),
    },
    createUser: {
      method: "POST",
      path: "/users",
      request: z.object({
        body: z.object({ name: z.string().min(2), age: z.number().int() }),
      }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    me: {
      method: "GET",
      path: "/me",
      auth: true,
      request: z.object({}),
      response: z.object({ id: z.string() }),
    },
  },
  notes: {
    // flat request schema — the client sends this whole object as the body
    create: {
      method: "POST",
      path: "/notes",
      request: z.object({ title: z.string(), at: z.date().optional() }),
      response: z.object({ ok: z.literal(true), title: z.string() }),
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
type SearchUsers = typeof contracts.user.searchUsers;
type CreateUser = typeof contracts.user.createUser;

// ---------------------------------------------------------------------------
// Guard honoring the contract's `auth` flag via getContractEndpoint()
// ---------------------------------------------------------------------------
@Injectable()
class ContractAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const endpoint = getContractEndpoint(context);
    if (!endpoint?.auth) return true;
    const req = context.switchToHttp().getRequest();
    if (!req.headers.authorization) throw new UnauthorizedException();
    return true;
  }
}

// ---------------------------------------------------------------------------
// Controllers
// ---------------------------------------------------------------------------
@Controller()
class UserController {
  @TypeFetchEndpoint(contracts.user.getUser)
  getUser(
    @ContractInput() input: InferRequest<GetUser>,
  ): InferResponse<GetUser> & { leaked?: string } {
    return {
      id: input.path.id,
      name: input.query?.verbose ? "Taha (verbose)" : "Taha",
      // not part of the contract — must be stripped from the response
      leaked: "secret",
    };
  }

  @TypeFetchEndpoint(contracts.user.searchUsers)
  searchUsers(
    @ContractQuery() query: InferRequest<SearchUsers>["query"],
  ): InferResponse<SearchUsers> {
    return {
      page: query.page,
      active: query.active,
      tagCount: query.tags?.length ?? 0,
      fromYear:
        query.from instanceof Date ? query.from.getUTCFullYear() : undefined,
    };
  }

  @TypeFetchEndpoint(contracts.user.createUser, { httpCode: 200 })
  createUser(
    @ContractBody() body: InferRequest<CreateUser>["body"],
  ): InferResponse<CreateUser> {
    return { id: "u-new", name: body.name };
  }

  @TypeFetchEndpoint(contracts.user.me)
  me(): InferResponse<typeof contracts.user.me> {
    return { id: "me-1" };
  }

  // validation-only decorator on a manually declared route
  @Get("manual/:id")
  @UseContract(contracts.user.getUser)
  manual(@ContractPath() path: InferRequest<GetUser>["path"]) {
    return { id: path.id, name: "Manual" };
  }
}

@Controller()
class NotesController {
  @TypeFetchEndpoint(contracts.notes.create)
  create(
    @ContractInput() input: InferRequest<typeof contracts.notes.create>,
  ): InferResponse<typeof contracts.notes.create> {
    expect(input.at === undefined || input.at instanceof Date).toBe(true);
    return { ok: true, title: input.title };
  }
}

@Controller()
class BrokenController {
  @TypeFetchEndpoint(contracts.broken.badResponse)
  bad() {
    return { wrong: "shape" } as any;
  }
}

// ---------------------------------------------------------------------------

describe("typefetch-nestjs (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TypeFetchModule.forRoot({ exposeResponseErrors: true })],
      controllers: [UserController, NotesController, BrokenController],
      providers: [{ provide: APP_GUARD, useClass: ContractAuthGuard }],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const http = () => request(app.getHttpServer());

  describe("route binding from contract", () => {
    it("serves GET /users/:id derived from the contract", async () => {
      const res = await http().get("/users/123").expect(200);
      expect(res.body).toEqual({ id: "123", name: "Taha" });
    });

    it("applies the httpCode option (POST returns 200 instead of 201)", async () => {
      await http().post("/users").send({ name: "Nabavi", age: 30 }).expect(200);
    });
  });

  describe("request validation + coercion", () => {
    it("coerces query strings toward contract types", async () => {
      const res = await http()
        .get("/users?page=2&active=true&tags=a&tags=b&from=2026-03-01T00:00:00.000Z")
        .expect(200);
      expect(res.body).toEqual({
        page: 2,
        active: true,
        tagCount: 2,
        fromYear: 2026,
      });
    });

    it("wraps a single repeated-key occurrence into an array", async () => {
      const res = await http().get("/users?page=1&tags=solo").expect(200);
      expect(res.body.tagCount).toBe(1);
    });

    it("rejects an invalid body with a RichError-compatible payload", async () => {
      const res = await http()
        .post("/users")
        .send({ name: "x", age: 1.2 })
        .expect(400);

      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.message).toBe("Request validation failed");
      expect(Object.keys(res.body.errors).sort()).toEqual([
        "body.age",
        "body.name",
      ]);
    });

    it("rejects invalid query values", async () => {
      const res = await http().get("/users?page=abc").expect(400);
      expect(res.body.errors["query.page"]).toBeDefined();
    });

    it("validates flat contracts against the whole body", async () => {
      const res = await http()
        .post("/notes")
        .send({ title: "hello", at: "2026-05-01T00:00:00.000Z" })
        .expect(201);
      expect(res.body).toEqual({ ok: true, title: "hello" });

      const bad = await http().post("/notes").send({}).expect(400);
      expect(bad.body.errors["body.title"]).toBeDefined();
    });
  });

  describe("response validation", () => {
    it("strips fields the contract does not declare", async () => {
      const res = await http().get("/users/9").expect(200);
      expect(res.body).not.toHaveProperty("leaked");
    });

    it("returns 500 with RESPONSE_CONTRACT_VIOLATION when the handler drifts", async () => {
      const res = await http().get("/broken").expect(500);
      expect(res.body.code).toBe("RESPONSE_CONTRACT_VIOLATION");
      // exposeResponseErrors: true in this app
      expect(res.body.errors.mustExist).toBeDefined();
    });
  });

  describe("@UseContract on manual routes", () => {
    it("validates without owning the route", async () => {
      const res = await http().get("/manual/7?verbose=true").expect(200);
      expect(res.body).toEqual({ id: "7", name: "Manual" });

      // query declared as boolean — a non-boolean string must 400
      await http().get("/manual/7?verbose=nope").expect(400);
    });
  });

  describe("auth flag via getContractEndpoint()", () => {
    it("guards endpoints with auth: true", async () => {
      await http().get("/me").expect(401);
      const res = await http()
        .get("/me")
        .set("Authorization", "Bearer token")
        .expect(200);
      expect(res.body).toEqual({ id: "me-1" });
    });

    it("leaves contract endpoints without auth public", async () => {
      await http().get("/users/1").expect(200);
    });
  });
});
