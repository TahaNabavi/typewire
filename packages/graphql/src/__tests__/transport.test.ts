import { z } from "zod";
import {
  ApiClient,
  RichError,
  isContractError,
  type Contracts,
} from "@tahanabavi/typefetch";
import { graphqlTransport } from "../transport";
import type { GraphqlError, GraphqlTransportConfig } from "../types";

global.fetch = jest.fn();

/**
 * The GraphQL transport, end to end through a real `ApiClient`.
 *
 * This package was built entirely outside typefetch on purpose — it is the test
 * of the transport seam. Everything here goes through the public client: if any
 * of it needed a change to the core, the seam would be wrong.
 */

const contracts = {
  user: {
    get: {
      transport: "graphql",
      operation: "query",
      root: "user",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
      variableTypes: { id: "ID!" },
      errors: {
        UNAUTHENTICATED: z.object({ code: z.literal("UNAUTHENTICATED"), realm: z.string() }),
      },
    },
    create: {
      transport: "graphql",
      operation: "mutation",
      root: "createUser",
      request: z.object({ name: z.string() }),
      response: z.object({ id: z.string() }),
    },
    // Same client, same contract object, a plain REST route.
    ping: {
      method: "GET",
      path: "/ping",
      request: z.object({}),
      response: z.object({ ok: z.boolean() }),
    },
  },
} satisfies Contracts;

function makeClient(
  config: GraphqlTransportConfig = {},
  clientConfig: Record<string, unknown> = {},
) {
  const client = new ApiClient(
    {
      baseUrl: "https://api.test",
      transports: [graphqlTransport({ url: "https://api.test/graphql", ...config })],
      ...clientConfig,
    },
    contracts,
  );
  client.init();
  return client;
}

function gqlOk(data: unknown, errors?: GraphqlError[]) {
  return new Response(JSON.stringify({ data, errors }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function gqlFail(errors: GraphqlError[], status = 400) {
  return new Response(JSON.stringify({ data: null, errors }), {
    status,
    headers: { "content-type": "application/graphql-response+json" },
  });
}

const sentBody = () => JSON.parse((fetch as jest.Mock).mock.calls[0][1].body);

describe("sending operations", () => {
  beforeEach(() => (fetch as jest.Mock).mockReset());

  it("POSTs a generated query and unwraps the root field", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      gqlOk({ user: { id: "u1", name: "Ada" } }),
    );

    await expect(client.modules.user.get({ id: "u1" })).resolves.toEqual({
      id: "u1",
      name: "Ada",
    });

    const [url, init] = (fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("https://api.test/graphql");
    expect(init.method).toBe("POST");
    expect(sentBody()).toEqual({
      query: "query UserGet($id: ID!) { user(id: $id) { id name } }",
      variables: { id: "u1" },
      operationName: "UserGet",
    });
  });

  it("asks for both response media types", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(gqlOk({ user: { id: "u1", name: "A" } }));

    await client.modules.user.get({ id: "u1" });

    expect((fetch as jest.Mock).mock.calls[0][1].headers.Accept).toBe(
      "application/graphql-response+json, application/json",
    );
  });

  it("sends a mutation", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(gqlOk({ createUser: { id: "u2" } }));

    await expect(client.modules.user.create({ name: "Ada" })).resolves.toEqual({
      id: "u2",
    });
    expect(sentBody().query).toBe(
      "mutation UserCreate($name: String!) { createUser(name: $name) { id } }",
    );
  });

  it("leaves http endpoints in the same contract on http", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.ping({})).resolves.toEqual({ ok: true });
    expect((fetch as jest.Mock).mock.calls[0][0]).toBe("https://api.test/ping");
  });

  it("applies the client's auth token", async () => {
    const client = makeClient({}, { token: "t0k3n" });
    (client.modules.user.get as any).endpoint.auth = true;
    (fetch as jest.Mock).mockResolvedValueOnce(gqlOk({ user: { id: "u1", name: "A" } }));

    await client.modules.user.get({ id: "u1" });

    expect((fetch as jest.Mock).mock.calls[0][1].headers.Authorization).toBe(
      "Bearer t0k3n",
    );
    (client.modules.user.get as any).endpoint.auth = false;
  });

  it("runs the client's middleware chain", async () => {
    const client = makeClient();
    const seen: string[] = [];
    client.use(async (ctx, next) => {
      seen.push(`${ctx.route?.transport}/${ctx.route?.operation}/${ctx.route?.target}`);
      return next();
    });
    (fetch as jest.Mock).mockResolvedValueOnce(gqlOk({ user: { id: "u1", name: "A" } }));

    await client.modules.user.get({ id: "u1" });

    expect(seen).toEqual(["graphql/query/user"]);
  });
});

/**
 * A query over GET is CDN-cacheable, which is the whole reason to offer it. A
 * mutation over GET is a lost write waiting to happen, so it stays a POST.
 */
describe("GET mode", () => {
  beforeEach(() => (fetch as jest.Mock).mockReset());

  it("sends queries as GET when configured", async () => {
    const client = makeClient({ method: "GET" });
    (fetch as jest.Mock).mockResolvedValueOnce(gqlOk({ user: { id: "u1", name: "A" } }));

    await client.modules.user.get({ id: "u1" });

    const [url, init] = (fetch as jest.Mock).mock.calls[0];
    expect(init.method).toBe("GET");
    const params = new URL(url).searchParams;
    expect(params.get("operationName")).toBe("UserGet");
    expect(JSON.parse(params.get("variables")!)).toEqual({ id: "u1" });
  });

  it("still POSTs mutations in GET mode", async () => {
    const client = makeClient({ method: "GET" });
    (fetch as jest.Mock).mockResolvedValueOnce(gqlOk({ createUser: { id: "u2" } }));

    await client.modules.user.create({ name: "Ada" });

    expect((fetch as jest.Mock).mock.calls[0][1].method).toBe("POST");
  });
});

describe("errors", () => {
  beforeEach(() => (fetch as jest.Mock).mockReset());

  /**
   * The legacy `application/json` media type reports failures *inside* a 200,
   * so the only place they can be caught is the decode path. They must still
   * come out as a normal client failure.
   */
  it("fails on errors delivered inside a 200", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);
    (fetch as jest.Mock).mockResolvedValueOnce(
      gqlOk(null, [
        { message: "no such user", extensions: { code: "NOT_FOUND" } },
      ]),
    );

    const error: RichError = await client.modules.user
      .get({ id: "u1" })
      .catch((e) => e);

    expect(error).toBeInstanceOf(RichError);
    expect(error.kind).toBe("not_found");
    expect(error.message).toBe("no such user");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fails on a real status from the newer media type", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      gqlFail([{ message: "nope", extensions: { code: "FORBIDDEN" } }], 403),
    );

    const error: RichError = await client.modules.user
      .get({ id: "u1" })
      .catch((e) => e);

    expect(error.kind).toBe("permission_denied");
    expect(error.status).toBe(403);
  });

  /**
   * The point of the transport living inside typefetch: one `kind` taxonomy, so
   * a global handler written for HTTP 401 fires for a GraphQL
   * `UNAUTHENTICATED` too.
   */
  it("maps extensions.code onto the shared kind taxonomy", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      gqlOk(null, [{ message: "login", extensions: { code: "UNAUTHENTICATED" } }]),
    );

    const error: RichError = await client.modules.user
      .get({ id: "u1" })
      .catch((e) => e);

    expect(error.kind).toBe("unauthenticated");
  });

  it("types the error body from the contract, keyed by extensions.code", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      gqlOk(null, [
        {
          message: "login",
          extensions: { code: "UNAUTHENTICATED", realm: "api" },
        },
      ]),
    );

    const error = await client.modules.user.get({ id: "u1" }).catch((e) => e);

    if (isContractError(contracts.user.get, error, "UNAUTHENTICATED")) {
      expect(error.data.realm).toBe("api");
    } else {
      throw new Error("expected the string error key to narrow");
    }
  });

  it("reports the intended status from extensions.http", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      gqlOk(null, [
        { message: "gone", extensions: { code: "NOT_FOUND", http: { status: 404 } } },
      ]),
    );

    const error: RichError = await client.modules.user
      .get({ id: "u1" })
      .catch((e) => e);

    expect(error.status).toBe(404);
  });

  it("reports a gateway failure that never reached a resolver", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response("<html>502</html>", { status: 502 }),
    );

    const error: RichError = await client.modules.user
      .get({ id: "u1" })
      .catch((e) => e);

    expect(error.status).toBe(502);
    expect(error.kind).toBe("internal");
  });
});

/**
 * Partial data is the case every GraphQL client gets wrong in one direction or
 * the other. Throwing loses a usable result; resolving silently loses the
 * reason half of it is missing.
 */
describe("partial data", () => {
  beforeEach(() => (fetch as jest.Mock).mockReset());

  const partial = () =>
    gqlOk({ user: { id: "u1", name: "Ada" } }, [
      { message: "avatar service down", path: ["user", "avatar"] },
    ]);

  it("throws by default", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(partial());

    await expect(client.modules.user.get({ id: "u1" })).rejects.toBeInstanceOf(
      RichError,
    );
  });

  it("resolves the data under errorPolicy: all", async () => {
    const client = makeClient({ errorPolicy: "all" });
    (fetch as jest.Mock).mockResolvedValueOnce(partial());

    await expect(client.modules.user.get({ id: "u1" })).resolves.toEqual({
      id: "u1",
      name: "Ada",
    });
  });

  it("hands the errors to onPartialErrors rather than dropping them", async () => {
    const onPartialErrors = jest.fn();
    const client = makeClient({ errorPolicy: "all", onPartialErrors });
    (fetch as jest.Mock).mockResolvedValueOnce(partial());

    await client.modules.user.get({ id: "u1" });

    expect(onPartialErrors).toHaveBeenCalledTimes(1);
    const [errors, info] = onPartialErrors.mock.calls[0];
    expect(errors[0].message).toBe("avatar service down");
    expect(info.endpointId).toBe("user.get");
    expect(info.route.protocol).toBe("GraphQL");
  });
});

describe("contract checking at init()", () => {
  it("rejects a schema whose selection set cannot be generated", () => {
    const broken = {
      user: {
        get: {
          transport: "graphql",
          operation: "query",
          root: "user",
          request: z.object({}),
          response: z.object({
            outcome: z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
          }),
        },
      },
    } as unknown as Contracts;

    const client = new ApiClient(
      { baseUrl: "https://api.test", transports: [graphqlTransport()] },
      broken,
    );

    expect(() => client.init()).toThrow(/Could not generate a document for "user\.get"/);
  });

  it("rejects a missing operation", () => {
    const broken = {
      user: {
        get: {
          transport: "graphql",
          root: "user",
          request: z.object({}),
          response: z.object({ id: z.string() }),
        },
      },
    } as unknown as Contracts;

    const client = new ApiClient(
      { baseUrl: "https://api.test", transports: [graphqlTransport()] },
      broken,
    );

    expect(() => client.init()).toThrow(/must declare operation/);
  });

  it("uses a hand-written document verbatim, including its operation name", async () => {
    const custom = {
      user: {
        search: {
          transport: "graphql",
          operation: "query",
          document: "query FindUsers($q: String!) { search(q: $q) { ... on User { id } } }",
          root: "search",
          request: z.object({ q: z.string() }),
          response: z.array(z.object({ id: z.string() })),
        },
      },
    } satisfies Contracts;

    const client = new ApiClient(
      {
        baseUrl: "https://api.test",
        transports: [graphqlTransport({ url: "https://api.test/graphql" })],
      },
      custom,
    );
    client.init();

    (fetch as jest.Mock).mockReset();
    (fetch as jest.Mock).mockResolvedValueOnce(gqlOk({ search: [{ id: "u1" }] }));

    await client.modules.user.search({ q: "ada" });

    expect(sentBody()).toEqual({
      query: "query FindUsers($q: String!) { search(q: $q) { ... on User { id } } }",
      variables: { q: "ada" },
      operationName: "FindUsers",
    });
  });
});
