import "reflect-metadata";
import {
  Body,
  Injectable,
  INestApplication,
  NotFoundException,
  UseGuards,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ApiClient, RichError, type Contracts } from "@tahanabavi/typefetch";
import { graphqlTransport } from "@tahanabavi/typefetch-graphql";
import type { AddressInfo } from "net";
import request from "supertest";
import { z } from "zod";
import {
  ContractInput,
  createPermissionGuard,
  TypeFetchModule,
  type InferRequest,
} from "../index";
import {
  ContractGraphQLModule,
  GraphQLEndpoint,
  GraphqlException,
} from "../graphql";

const User = z.object({ id: z.string(), name: z.string() });

const contracts = {
  user: {
    profile: {
      transport: "graphql",
      operation: "query",
      root: "user",
      request: z.object({ id: z.string().min(1) }),
      response: User,
    },
    // No `root`: `data` *is* the response.
    whoami: {
      transport: "graphql",
      operation: "query",
      request: z.object({}),
      response: User,
    },
    rename: {
      transport: "graphql",
      operation: "mutation",
      root: "renameUser",
      request: z.object({ id: z.string(), name: z.string() }),
      response: User,
    },
    secret: {
      transport: "graphql",
      operation: "query",
      root: "secret",
      permission: { require: ["user.admin"], reason: "Admins only" },
      request: z.object({}),
      response: User,
    },
    drifted: {
      transport: "graphql",
      operation: "query",
      root: "drifted",
      request: z.object({}),
      response: User,
    },
    orphan: {
      transport: "graphql",
      operation: "query",
      root: "orphan",
      request: z.object({}),
      response: User,
    },
  },
} as const satisfies Contracts;

const PermissionGuard = createPermissionGuard({
  getPermissions: () => 0n,
  authorize: () => ({ granted: false, missing: ["user.admin"] }),
});

@Injectable()
class UserResolver {
  @GraphQLEndpoint(contracts.user.profile)
  profile(@ContractInput() input: InferRequest<typeof contracts.user.profile>) {
    if (input.id === "999") throw new NotFoundException("No such user");
    if (input.id === "boom") throw new Error("connection reset by peer");
    if (input.id === "gone") {
      throw new GraphqlException("PERSISTED_QUERY_NOT_FOUND", "Unknown hash");
    }
    return { id: input.id, name: "Taha" };
  }

  @GraphQLEndpoint(contracts.user.whoami)
  whoami() {
    return { id: "me", name: "Taha" };
  }

  @GraphQLEndpoint(contracts.user.rename)
  rename(@ContractInput() input: InferRequest<typeof contracts.user.rename>) {
    return { id: input.id, name: input.name };
  }

  @GraphQLEndpoint(contracts.user.secret)
  @UseGuards(PermissionGuard)
  secret() {
    return { id: "root", name: "root" };
  }

  @GraphQLEndpoint(contracts.user.drifted)
  drifted() {
    return { id: "1" } as never; // no `name` — the contract is violated
  }
}

async function buildApp() {
  const moduleRef = await Test.createTestingModule({
    imports: [
      // The envelope is on, to prove a GraphQL body is never wrapped in it.
      TypeFetchModule.forRoot({ envelope: true }),
      ContractGraphQLModule.forRoot({ contracts }),
    ],
    providers: [UserResolver],
  }).compile();

  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  return app;
}

describe("GraphQL over HTTP", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  /** What typefetch's transport sends: modern media type, named operation. */
  const send = (body: Record<string, unknown>) =>
    request(app.getHttpServer())
      .post("/graphql")
      .set("Accept", "application/graphql-response+json, application/json")
      .send(body);

  it("routes on the operation name the client derives from the endpoint id", async () => {
    // `user.profile` → `UserProfile`, the same rule the client's transport uses.
    const res = await send({
      operationName: "UserProfile",
      variables: { id: "1" },
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ data: { user: { id: "1", name: "Taha" } } });
  });

  it("puts the result under `root`, and directly under `data` without one", async () => {
    const res = await send({ operationName: "UserWhoami", variables: {} });

    expect(res.body).toEqual({ data: { id: "me", name: "Taha" } });
  });

  it("answers the GraphQL media type so a failure can carry a real status", async () => {
    const res = await send({
      operationName: "UserProfile",
      variables: { id: "1" },
    });

    expect(res.headers["content-type"]).toMatch(
      /application\/graphql-response\+json/,
    );
  });

  it("never wraps a GraphQL body in the global response envelope", async () => {
    const res = await send({
      operationName: "UserProfile",
      variables: { id: "1" },
    });

    expect(res.body).not.toHaveProperty("success");
    expect(res.body.data).toBeDefined();
  });

  it("reports a variable that fails the contract as BAD_USER_INPUT", async () => {
    const res = await send({ operationName: "UserProfile", variables: { id: "" } });

    expect(res.status).toBe(400);
    expect(res.body.errors[0].extensions.code).toBe("BAD_USER_INPUT");
    // The field errors ride along, keyed the way an HTTP 400 keys them.
    expect(Object.keys(res.body.errors[0].extensions.errors)).toEqual(["id"]);
  });

  it("maps a NestJS exception to the code that means it", async () => {
    const res = await send({
      operationName: "UserProfile",
      variables: { id: "999" },
    });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].extensions.code).toBe("NOT_FOUND");
    expect(res.body.errors[0].message).toBe("No such user");
  });

  it("carries a thrown GraphqlException's own code", async () => {
    const res = await send({
      operationName: "UserProfile",
      variables: { id: "gone" },
    });

    expect(res.body.errors[0].extensions.code).toBe("PERSISTED_QUERY_NOT_FOUND");
  });

  it("reports an unexpected throw as INTERNAL_SERVER_ERROR without the cause", async () => {
    const res = await send({
      operationName: "UserProfile",
      variables: { id: "boom" },
    });

    expect(res.status).toBe(500);
    expect(res.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
    expect(JSON.stringify(res.body)).not.toMatch(/connection reset/);
  });

  it("validates what a resolver returns against the contract", async () => {
    const res = await send({ operationName: "UserDrifted", variables: {} });

    expect(res.status).toBe(500);
    expect(res.body.errors[0].extensions.code).toBe("INTERNAL_SERVER_ERROR");
  });

  it("names an operation no resolver claims", async () => {
    const res = await send({ operationName: "UserOrphan", variables: {} });

    expect(res.status).toBe(404);
    expect(res.body.errors[0].extensions.code).toBe("OPERATION_RESOLUTION_FAILURE");
  });

  // The whole point of running resolvers through NestJS's pipeline rather than
  // calling them: the contract's `permission` key is enforced by the same guard
  // that protects an HTTP route.
  it("runs guards, so a contract permission is enforced in a resolver", async () => {
    const res = await send({ operationName: "UserSecret", variables: {} });

    expect(res.status).toBe(403);
    expect(res.body.errors[0].extensions.code).toBe("FORBIDDEN");
    expect(res.body.errors[0].message).toBe("Admins only");
  });

  it("falls back to the document's own name when none was sent", async () => {
    const res = await send({
      query: "query UserWhoami { user { id name } }",
      variables: {},
    });

    expect(res.body.data).toEqual({ id: "me", name: "Taha" });
  });

  it("falls back to the root field when the document names nothing", async () => {
    const res = await send({ query: "{ user(id: $id) { id name } }", variables: { id: "7" } });

    expect(res.body.data).toEqual({ user: { id: "7", name: "Taha" } });
  });

  it("serves a query over GET, with variables JSON-encoded", async () => {
    const res = await request(app.getHttpServer())
      .get("/graphql")
      .set("Accept", "application/graphql-response+json")
      .query({
        operationName: "UserProfile",
        variables: JSON.stringify({ id: "3" }),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe("3");
  });

  // A mutation over GET is cacheable by everything in between, which is a way
  // to lose or replay a write.
  it("refuses a mutation over GET", async () => {
    const res = await request(app.getHttpServer())
      .get("/graphql")
      .set("Accept", "application/graphql-response+json")
      .query({ operationName: "UserRename", variables: JSON.stringify({ id: "1", name: "N" }) });

    expect(res.status).toBe(405);
  });
});

describe("GraphQL media type negotiation", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  // The legacy media type has no way to carry a status — errors live inside a
  // 200 — so the intended one goes in `extensions.http.status`, which is what
  // typefetch reads.
  it("answers a failure inside a 200 for an application/json client", async () => {
    const res = await request(app.getHttpServer())
      .post("/graphql")
      .set("Accept", "application/json")
      .send({ operationName: "UserProfile", variables: { id: "999" } });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.errors[0].extensions.code).toBe("NOT_FOUND");
    expect(res.body.errors[0].extensions.http.status).toBe(404);
  });
});

/**
 * The same server, driven by the real `graphqlTransport()` — including the
 * document it generates from the response schema, which nobody wrote.
 */
describe("GraphQL against the real typefetch client", () => {
  let app: INestApplication;
  let client: ApiClient<typeof contracts>;

  beforeAll(async () => {
    app = await buildApp();
    await app.listen(0);

    const { port } = app.getHttpServer().address() as AddressInfo;
    client = new ApiClient(
      { baseUrl: `http://127.0.0.1:${port}`, transports: [graphqlTransport()] },
      contracts,
    );
    client.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("round-trips a query the client validates on both ends", async () => {
    await expect(client.modules.user.profile({ id: "1" })).resolves.toEqual({
      id: "1",
      name: "Taha",
    });
  });

  it("round-trips a mutation over POST", async () => {
    await expect(
      client.modules.user.rename({ id: "1", name: "Renamed" }),
    ).resolves.toEqual({ id: "1", name: "Renamed" });
  });

  it("normalizes the server's extensions.code into the shared ErrorKind", async () => {
    const error = (await client.modules.user
      .profile({ id: "999" })
      .catch((e: unknown) => e)) as RichError;

    expect(error).toBeInstanceOf(RichError);
    expect(error.kind).toBe("not_found");
  });

  it("normalizes a permission denial the same way an HTTP 403 is", async () => {
    const error = (await client.modules.user
      .secret({})
      .catch((e: unknown) => e)) as RichError;

    expect(error.kind).toBe("permission_denied");
  });
});

describe("bootstrap guard rails", () => {
  it("refuses two resolvers claiming one operation", async () => {
    @Injectable()
    class First {
      @GraphQLEndpoint(contracts.user.whoami)
      a() {
        return { id: "1", name: "a" };
      }
    }

    @Injectable()
    class Second {
      @GraphQLEndpoint(contracts.user.whoami)
      b() {
        return { id: "1", name: "b" };
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [ContractGraphQLModule.forRoot({ contracts })],
      providers: [First, Second],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.useLogger(false);
    await expect(app.init()).rejects.toThrow(
      /Two resolvers claim the GraphQL operation "UserWhoami"/,
    );
    await app.close().catch(() => undefined);
  });

  // `@Body()` in a resolver reads the GraphQL envelope, not the variables — a
  // bug that surfaces as a validation failure three layers away.
  it("refuses a route parameter decorator that means nothing here", async () => {
    @Injectable()
    class Bad {
      @GraphQLEndpoint(contracts.user.whoami)
      a(@Body() _body: unknown) {
        return { id: "1", name: "a" };
      }
    }

    const moduleRef = await Test.createTestingModule({
      imports: [ContractGraphQLModule.forRoot({ contracts })],
      providers: [Bad],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.useLogger(false);
    await expect(app.init()).rejects.toThrow(/Use @ContractInput\(\)/);
    await app.close().catch(() => undefined);
  });

  it("can fail bootstrap when an operation has no resolver", async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ContractGraphQLModule.forRoot({ contracts, requireAllResolvers: true }),
      ],
      providers: [UserResolver],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.useLogger(false);
    await expect(app.init()).rejects.toThrow(
      /have no resolver: user\.orphan/,
    );
    await app.close().catch(() => undefined);
  });
});
