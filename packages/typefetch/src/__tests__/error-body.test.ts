import { z } from "zod";
import { ApiClient, RichError } from "../client";
import type { Contracts } from "../types";

global.fetch = jest.fn();

function respond(
  body: BodyInit | null,
  init: { status?: number; statusText?: string; headers?: Record<string, string> },
) {
  return new Response(body, {
    status: init.status ?? 500,
    statusText: init.statusText ?? "",
    headers: init.headers,
  });
}

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/user",
      request: z.object({}),
      response: z.object({ id: z.string() }),
      errors: {
        409: z.object({ code: z.string(), conflictField: z.string() }),
      },
    },
  },
} satisfies Contracts;

function makeClient() {
  const client = new ApiClient({ baseUrl: "https://api.test" }, contracts);
  client.init();
  return client;
}

/**
 * These cover the reordering of the `res.ok` check ahead of body decoding.
 * Previously the body was read with `res.json()` first, so any failure whose
 * body was not JSON threw a `SyntaxError` and the HTTP status — the single most
 * useful fact about the failure — never reached the caller.
 */
describe("non-JSON error bodies", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  it("reports the status for an HTML error page instead of a parse error", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond("<html><body>502 Bad Gateway</body></html>", {
        status: 502,
        statusText: "Bad Gateway",
        headers: { "content-type": "text/html" },
      }),
    );

    const error = await client.modules.user
      .getUser({})
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(RichError);
    expect(error).toMatchObject({
      status: 502,
      message: "Bad Gateway",
      detail: "<html><body>502 Bad Gateway</body></html>",
      dataParsed: false,
    });
    expect((error as Error).name).not.toBe("SyntaxError");
  });

  it("reports the status for an empty error body", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(null, { status: 401, statusText: "Unauthorized" }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 401,
      message: "Unauthorized",
    });
  });

  it("falls back to the status code when there is no status text", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond("", { status: 503, statusText: "" }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 503,
      message: "HTTP 503",
    });
  });

  it("puts a plain-text error body in detail", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond("upstream timed out", { status: 504, statusText: "Gateway Timeout" }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 504,
      detail: "upstream timed out",
    });
  });

  it("normalizes a JSON scalar error body into detail", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond('"rate limited"', {
        status: 429,
        statusText: "Too Many Requests",
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 429,
      detail: "rate limited",
      dataParsed: false,
    });
  });

  it("still types a declared JSON error body", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ code: "DUP", conflictField: "email" }), {
        status: 409,
        statusText: "Conflict",
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 409,
      code: "DUP",
      dataParsed: true,
      data: { code: "DUP", conflictField: "email" },
    });
  });

  it("fails open when the declared schema does not match the body", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ unexpected: true }), {
        status: 409,
        statusText: "Conflict",
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 409,
      dataParsed: false,
      data: { unexpected: true },
    });
  });

  it("routes a non-JSON failure through onError", async () => {
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockResolvedValueOnce(
      respond("<html>nope</html>", { status: 500, statusText: "Server Error" }),
    );

    await expect(client.modules.user.getUser({})).rejects.toThrow();

    expect(handler).toHaveBeenCalled();
    expect(handler.mock.calls[0][0]).toMatchObject({ status: 500 });
  });
});

describe("response wrapper on a failed response", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
    client.setResponseWrapper((success) =>
      z.union([
        z.object({ success: z.literal(true), data: success }),
        z.object({
          success: z.literal(false),
          message: z.string(),
          code: z.number().optional(),
        }),
      ]),
    );
  });

  it("keeps surfacing the envelope's message alongside a 4xx", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ success: false, message: "Email taken" }), {
        status: 400,
        statusText: "Bad Request",
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      message: "Email taken",
      status: 400,
      code: "API_ERROR",
    });
  });

  it("falls through to the status error when the body is not an envelope", async () => {
    // The old code called `parse` here, so a failure body that didn't fit the
    // envelope surfaced as a ZodError with no status at all.
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ message: "Nope", code: "PLAIN" }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 403,
      message: "Nope",
      code: "PLAIN",
    });
  });

  it("falls through to the status error when the failure body is HTML", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond("<html>502</html>", { status: 502, statusText: "Bad Gateway" }),
    );

    await expect(client.modules.user.getUser({})).rejects.toMatchObject({
      status: 502,
      message: "Bad Gateway",
    });
  });
});
