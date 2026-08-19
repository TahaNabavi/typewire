import { z } from "zod";
import { ApiClient, RichError } from "../client";
import { kindFromHttpStatus, kindFromThrown } from "../utils/error-kind";
import type { Contracts } from "../types";

global.fetch = jest.fn();

/**
 * `RichError.kind` is the transport-independent classification every failure
 * carries. It exists so a global handler ("redirect on `unauthenticated`") is
 * written once and keeps working when an endpoint moves to a wire whose failure
 * vocabulary is not HTTP status codes.
 *
 * These pin both halves: the mapping itself, and the guarantee that *every*
 * failure path through the client populates it.
 */

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/user",
      request: z.object({}),
      response: z.object({ id: z.string() }),
    },
    // Path template deliberately not constrained by the request schema, so the
    // missing param is caught where params are applied rather than by Zod.
    byId: {
      method: "GET",
      path: "/user/:id",
      request: z.object({}),
      response: z.object({ id: z.string() }),
    },
    strictById: {
      method: "GET",
      path: "/user/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string() }),
    },
    secure: {
      method: "GET",
      path: "/secure",
      auth: true,
      request: z.object({}),
      response: z.object({ id: z.string() }),
    },
  },
} satisfies Contracts;

function makeClient(config: { token?: string } = {}) {
  const client = new ApiClient(
    { baseUrl: "https://api.test", ...config },
    contracts,
  );
  client.init();
  return client;
}

function failure(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function kindOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    throw new Error("Expected the request to fail");
  } catch (error) {
    return (error as RichError).kind;
  }
}

describe("kindFromHttpStatus", () => {
  it.each([
    [400, "invalid_argument"],
    [401, "unauthenticated"],
    [403, "permission_denied"],
    [404, "not_found"],
    [408, "deadline_exceeded"],
    [409, "already_exists"],
    [412, "failed_precondition"],
    [416, "out_of_range"],
    [429, "resource_exhausted"],
    [499, "cancelled"],
    [501, "unimplemented"],
    [503, "unavailable"],
    [504, "deadline_exceeded"],
  ])("maps %i to %s", (status, expected) => {
    expect(kindFromHttpStatus(status)).toBe(expected);
  });

  it("falls back by range for unlisted statuses", () => {
    expect(kindFromHttpStatus(418)).toBe("invalid_argument");
    expect(kindFromHttpStatus(502)).toBe("internal");
    expect(kindFromHttpStatus(500)).toBe("internal");
  });

  it("returns unknown when there is no status at all", () => {
    expect(kindFromHttpStatus(undefined)).toBe("unknown");
  });

  /**
   * The official gRPC HTTP-to-code table maps 404 to `unimplemented`, which is
   * right for a proxy that could not route and wrong for a REST client, where a
   * 404 is the answer to the question the endpoint asked.
   */
  it("maps 404 by REST intent, not by the gRPC proxy table", () => {
    expect(kindFromHttpStatus(404)).toBe("not_found");
    expect(kindFromHttpStatus(404)).not.toBe("unimplemented");
  });
});

describe("kindFromThrown", () => {
  it("classifies a schema failure as validation", () => {
    const result = z.object({ id: z.string() }).safeParse({});
    expect(kindFromThrown(result.success ? null : result.error)).toBe(
      "validation",
    );
  });

  it("classifies an abort as cancelled", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(kindFromThrown(err)).toBe("cancelled");
  });

  it("classifies a fetch network failure as network", () => {
    expect(kindFromThrown(new TypeError("Network request failed"))).toBe(
      "network",
    );
  });

  it("returns unknown for anything else", () => {
    expect(kindFromThrown(new Error("boom"))).toBe("unknown");
    expect(kindFromThrown("nope")).toBe("unknown");
    expect(kindFromThrown(null)).toBe("unknown");
  });
});

describe("every client failure path carries a kind", () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockReset();
  });

  it("classifies an HTTP failure from its status", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(failure(404));

    expect(await kindOf(client.modules.user.getUser({}))).toBe("not_found");
  });

  it("classifies a response that fails its own schema as validation", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 42 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    expect(await kindOf(client.modules.user.getUser({}))).toBe("validation");
  });

  it("classifies a fetch rejection as network", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockRejectedValueOnce(
      new TypeError("Network request failed"),
    );

    expect(await kindOf(client.modules.user.getUser({}))).toBe("network");
  });

  it("classifies a missing auth token as unauthenticated", async () => {
    const client = makeClient();

    expect(await kindOf(client.modules.user.secure({}))).toBe("unauthenticated");
  });

  it("classifies a missing path param as invalid_argument", async () => {
    const client = makeClient();

    expect(await kindOf(client.modules.user.byId({}))).toBe("invalid_argument");
  });
});

/**
 * Regression: request-input validation used to escape unclassified.
 *
 * `request.parse` ran before the try block in `ApiClient.request`, so a bad
 * *input* escaped as a raw `ZodError` — it never became a `RichError`, never
 * carried a `kind`, never reached `onError`, and never appeared in an
 * inspector. A bad *output*, one line further down the same request, did all
 * four. A global error handler therefore missed an entire class of failure
 * without any signal that it had.
 *
 * Both ends of the contract now fail identically.
 */
describe("request-input validation fails like every other failure", () => {
  const badInput = { path: { id: undefined } } as any;

  it("throws a classified RichError, not a raw ZodError", async () => {
    const client = makeClient();

    const error = await client.modules.user
      .strictById(badInput)
      .catch((e) => e);

    expect(error).toBeInstanceOf(RichError);
    expect(error).not.toBeInstanceOf(z.ZodError);
    expect(error.kind).toBe("validation");
    expect(error.code).toBe("VALIDATION_ERROR");
  });

  it("reports it to onError exactly once", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);

    await expect(client.modules.user.strictById(badInput)).rejects.toThrow();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].kind).toBe("validation");
  });

  it("keeps Zod's per-field detail rather than discarding it", async () => {
    const client = makeClient();

    const error: RichError = await client.modules.user
      .strictById(badInput)
      .catch((e) => e);

    // `errors` is already Record<string, string[]>, which is the shape Zod's
    // flattened field errors have — nothing the ZodError knew is lost.
    expect(error.errors).toBeDefined();
    expect(Object.keys(error.errors!)).toContain("path");
  });

  it("still emits a start/error pair so an inspector shows the failure", async () => {
    const client = makeClient();
    const events: string[] = [];
    client.instrument({ on: (event) => events.push(event.type) });

    await expect(client.modules.user.strictById(badInput)).rejects.toThrow();

    expect(events).toEqual(["start", "error"]);
  });

  it("leaves a valid input completely unaffected", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      client.modules.user.strictById({ path: { id: "1" } }),
    ).resolves.toEqual({ id: "1" });
  });
});

/**
 * `timeout` is implemented by aborting, so the rejection is byte-for-byte the
 * one a caller-initiated cancel produces. Reporting both as `cancelled` would
 * lose the distinction a retry policy depends on: a timeout is worth retrying,
 * a user navigating away is not.
 */
describe("timeout is distinguished from cancellation", () => {
  beforeEach(() => {
    (fetch as jest.Mock).mockReset();
    (fetch as jest.Mock).mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        }),
    );
  });

  it("reports a timeout as deadline_exceeded", async () => {
    const client = makeClient();

    expect(
      await kindOf(client.modules.user.getUser({}, { timeout: 5 })),
    ).toBe("deadline_exceeded");
  });

  it("reports a caller abort as cancelled", async () => {
    const client = makeClient();
    const controller = new AbortController();
    const pending = client.modules.user.getUser(
      {},
      { signal: controller.signal },
    );

    controller.abort();

    expect(await kindOf(pending)).toBe("cancelled");
  });
});
