import "reflect-metadata";
import {
  Controller,
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ApiClient, RichError, type Contracts } from "@tahanabavi/typefetch";
import { grpcTransport } from "@tahanabavi/typefetch-grpc";
import type { AddressInfo } from "net";
import request from "supertest";
import { z } from "zod";
import {
  ContractInput,
  TypeFetchModule,
  type InferRequest,
} from "../index";
import { GrpcCode, GrpcDeadline, GrpcEndpoint, GrpcException } from "../grpc";
import type { GrpcDeadlineInfo } from "../grpc";

const User = z.object({ id: z.string(), name: z.string() });
const NotFound = z.object({ message: z.string() });

const contracts = {
  user: {
    getUser: {
      transport: "grpc",
      service: "user.v1.UserService",
      rpc: "GetUser",
      request: z.object({ id: z.string().min(1) }),
      response: User,
      // Keyed by gRPC code, not HTTP status — 5 is NOT_FOUND.
      errors: { 5: NotFound },
    },
    banUser: {
      transport: "grpc",
      service: "user.v1.UserService",
      rpc: "BanUser",
      request: z.object({ id: z.string() }),
      response: z.object({ banned: z.boolean() }),
    },
    slowUser: {
      transport: "grpc",
      service: "user.v1.UserService",
      rpc: "SlowUser",
      deadlineMs: 40,
      request: z.object({ id: z.string() }),
      response: User,
    },
    driftedUser: {
      transport: "grpc",
      service: "user.v1.UserService",
      rpc: "DriftedUser",
      request: z.object({ id: z.string() }),
      response: User,
    },
  },
} as const satisfies Contracts;

@Controller()
class UserRpcController {
  @GrpcEndpoint(contracts.user.getUser)
  getUser(
    @ContractInput() input: InferRequest<typeof contracts.user.getUser>,
  ) {
    if (input.id === "999") {
      throw new GrpcException(GrpcCode.NotFound, `No user ${input.id}`);
    }
    if (input.id === "401") throw new UnauthorizedException("Token expired");
    // A handler's 404 means "I looked and it is not there", which is
    // `not_found` — not `unimplemented`, which is what a *proxy's* 404 means.
    if (input.id === "404") throw new NotFoundException("Gone");
    return { id: input.id, name: "Taha" };
  }

  @GrpcEndpoint(contracts.user.banUser)
  banUser() {
    return { banned: true };
  }

  @GrpcEndpoint(contracts.user.slowUser)
  async slowUser(@GrpcDeadline() deadline?: GrpcDeadlineInfo) {
    expect(deadline?.timeoutMs).toBe(40);
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { id: "1", name: "Taha" };
  }

  @GrpcEndpoint(contracts.user.driftedUser)
  driftedUser() {
    return { id: "1" } as never; // missing `name` — the contract is violated
  }
}

describe("gRPC over Connect JSON", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // The envelope is on: an RPC must never be wrapped in `{ success, data }`,
      // because a Connect client reading that sees no `code` at all.
      imports: [TypeFetchModule.forRoot({ envelope: true })],
      controllers: [UserRpcController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  const post = (rpc: string, body: unknown) =>
    request(app.getHttpServer())
      .post(`/user.v1.UserService/${rpc}`)
      .set("Connect-Protocol-Version", "1")
      .send(body as object);

  it("routes POST /<service>/<rpc> and answers 200 with the bare message", async () => {
    const res = await post("GetUser", { id: "1" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "1", name: "Taha" });
  });

  // Nest answers a POST with 201 by default. Still 2xx, still decodable — and
  // still a lie a cache or a proxy may act on for a read.
  it("answers 200 rather than Nest's default 201 for a POST", async () => {
    const res = await post("BanUser", { id: "1" });
    expect(res.status).toBe(200);
  });

  it("keeps the global response envelope off the wire", async () => {
    const res = await post("GetUser", { id: "1" });
    expect(res.body).not.toHaveProperty("success");
    expect(res.body).not.toHaveProperty("data");
  });

  it("answers a contract violation with invalid_argument and the field errors", async () => {
    const res = await post("GetUser", { id: "" });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("invalid_argument");
    // `id`, not `body.id`: a unary RPC carries one message, so there is no body
    // to name it against — that prefix is an HTTP convention.
    expect(Object.keys(res.body.errors)).toEqual(["id"]);
  });

  it("carries a thrown GrpcException's code under the status it maps to", async () => {
    const res = await post("GetUser", { id: "999" });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      code: "not_found",
      message: "No user 999",
    });
  });

  it("maps a handler's NotFoundException to not_found, not unimplemented", async () => {
    // The client-side table maps 404 → unimplemented, because there a 404 came
    // from something that never reached the RPC. Here it came from a handler
    // that looked, so the same status means the opposite thing.
    const res = await post("GetUser", { id: "404" });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("not_found");
  });

  it("maps a 401 to unauthenticated", async () => {
    const res = await post("GetUser", { id: "401" });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe("unauthenticated");
  });

  it("reports a response contract violation as internal, without leaking why", async () => {
    const res = await post("DriftedUser", { id: "1" });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe("internal");
    expect(JSON.stringify(res.body)).not.toMatch(/name/);
  });

  it("enforces the caller's deadline instead of letting it hang", async () => {
    const res = await request(app.getHttpServer())
      .post("/user.v1.UserService/SlowUser")
      .set("Connect-Timeout-Ms", "40")
      .send({ id: "1" });

    expect(res.status).toBe(504);
    expect(res.body.code).toBe("deadline_exceeded");
  });

  it("reads the grpc-web spelling of the deadline too", async () => {
    const res = await request(app.getHttpServer())
      .post("/user.v1.UserService/SlowUser")
      .set("grpc-timeout", "40m")
      .send({ id: "1" });

    expect(res.status).toBe(504);
    expect(res.body.code).toBe("deadline_exceeded");
  });
});

/**
 * The same server, driven by the real `grpcTransport()`.
 *
 * Asserting the wire shape by hand proves the server sends what *this test*
 * believes Connect looks like. Only the actual client proves the two halves
 * agree — including the parts nobody would think to assert, like which key the
 * contract's `errors` map is looked up under.
 */
describe("gRPC against the real typefetch client", () => {
  let app: INestApplication;
  let client: ReturnType<typeof makeClient>;

  const makeClient = (baseUrl: string) => {
    const api = new ApiClient(
      { baseUrl, transports: [grpcTransport()] },
      contracts,
    );
    api.init();
    return api;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [UserRpcController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0);

    const { port } = app.getHttpServer().address() as AddressInfo;
    client = makeClient(`http://127.0.0.1:${port}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it("round-trips a call the client validates on both ends", async () => {
    await expect(client.modules.user.getUser({ id: "1" })).resolves.toEqual({
      id: "1",
      name: "Taha",
    });
  });

  it("normalizes the server's code into the shared ErrorKind", async () => {
    const error = await client.modules.user
      .getUser({ id: "999" })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RichError);
    expect((error as RichError).kind).toBe("not_found");
  });

  it("types the failure body against the contract's errors[5]", async () => {
    const error = (await client.modules.user
      .getUser({ id: "999" })
      .catch((e: unknown) => e)) as RichError;

    // `errors` is keyed by gRPC code, and the server's body parsed against the
    // schema declared for 5 — which is what `dataParsed` reports.
    expect(error.dataParsed).toBe(true);
    expect((error.data as { message: string }).message).toBe("No user 999");
  });

  it("sends the contract's deadline and receives deadline_exceeded", async () => {
    const error = (await client.modules.user
      .slowUser({ id: "1" })
      .catch((e: unknown) => e)) as RichError;

    expect(error.kind).toBe("deadline_exceeded");
  });
});
