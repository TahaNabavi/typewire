import "reflect-metadata";
import { Controller, INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Contracts } from "@tahanabavi/typefetch";
import request from "supertest";
import { z } from "zod";
import {
  ContractInput,
  InferRequest,
  InferResponse,
  setupContractSwagger,
  TypeFetchEndpoint,
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
      auth: true,
      request: z.object({
        body: z.object({ name: z.string().min(2) }),
      }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
  },
} as const satisfies Contracts;

type GetUser = typeof contracts.user.getUser;
type CreateUser = typeof contracts.user.createUser;

@Controller()
class UserController {
  @TypeFetchEndpoint(contracts.user.getUser)
  getUser(
    @ContractInput() input: InferRequest<GetUser>,
  ): InferResponse<GetUser> {
    return { id: input.path.id, name: "Taha" };
  }

  @TypeFetchEndpoint(contracts.user.createUser)
  createUser(
    @ContractInput() input: InferRequest<CreateUser>,
  ): InferResponse<CreateUser> {
    return { id: "u-1", name: input.body.name };
  }
}

describe("setupContractSwagger (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserController],
    }).compile();

    app = moduleRef.createNestApplication({ logger: false });
    setupContractSwagger(app, contracts, {
      path: "docs",
      info: { title: "Users API", version: "3.1.0" },
    });
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("serves the contract-derived document at <path>-json", async () => {
    const res = await request(app.getHttpServer()).get("/docs-json").expect(200);

    expect(res.body.openapi).toBe("3.0.3");
    expect(res.body.info).toEqual({ title: "Users API", version: "3.1.0" });

    // routes derived from the contracts, with param templating
    expect(res.body.paths["/users/{id}"].get.operationId).toBe("user_getUser");
    expect(res.body.paths["/users"].post.operationId).toBe("user_createUser");

    // auth endpoint carries bearer security; the scheme is declared
    expect(res.body.paths["/users"].post.security).toEqual([
      { bearerAuth: [] },
    ]);
    expect(res.body.components.securitySchemes.bearerAuth.scheme).toBe(
      "bearer",
    );
  });

  it("still serves the actual validated endpoints alongside the docs", async () => {
    const res = await request(app.getHttpServer())
      .get("/users/42")
      .expect(200);
    expect(res.body).toEqual({ id: "42", name: "Taha" });
  });
});
