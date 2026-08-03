import { z } from "zod";
import { ApiClient, RichError } from "../client";
import type { Contracts } from "../types";

global.fetch = jest.fn();

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/user",
      request: z.object({}),
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

function failure(status = 500, body: unknown = { message: "nope" }) {
  return new Response(JSON.stringify(body), {
    status,
    statusText: "Server Error",
    headers: { "content-type": "application/json" },
  });
}

/**
 * `onError` is a global handler — the thing that fires a toast or redirects on a
 * 401. Every one of these pins it to exactly one call per failed request.
 *
 * It used to fire once per layer that saw the error on its way out: twice for a
 * plain HTTP failure, and once per attempt plus one when retries were
 * configured.
 */
describe("onError firing", () => {
  it("fires once for a failed request", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockResolvedValueOnce(failure());

    await expect(client.modules.user.getUser({})).rejects.toThrow();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ status: 500 });
  });

  it("fires once for a request that exhausts its retries", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);
    client.setRetryConfig({ maxRetries: 2, backoff: "fixed" });

    (fetch as jest.Mock).mockResolvedValue(failure());

    await expect(client.modules.user.getUser({})).rejects.toThrow();

    // Three attempts, one report. A toast per retry is not what a global error
    // handler is for.
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("does not fire when a retry eventually succeeds", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);
    client.setRetryConfig({ maxRetries: 2, backoff: "fixed" });

    (fetch as jest.Mock)
      .mockResolvedValueOnce(failure())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "1" }), {
          headers: { "content-type": "application/json" },
        }),
      );

    await expect(client.modules.user.getUser({})).resolves.toEqual({ id: "1" });

    expect(handler).not.toHaveBeenCalled();
  });

  it("fires once for a missing token", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);

    await expect(client.modules.user.secure({})).rejects.toThrow(/Missing token/);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      status: 401,
      code: "NO_TOKEN",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fires once for a network failure", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    await expect(client.modules.user.getUser({})).rejects.toThrow();

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("fires once for a response that fails its schema", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ wrong: true }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).rejects.toThrow();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("fires once for an envelope reporting success: false", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);
    client.setResponseWrapper((success) =>
      z.union([
        z.object({ success: z.literal(true), data: success }),
        z.object({ success: z.literal(false), message: z.string() }),
      ]),
    );

    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ success: false, message: "Denied" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).rejects.toThrow();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toMatchObject({ message: "Denied" });
  });

  it("hands the same error instance to onError and to the caller", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockResolvedValueOnce(failure(409));

    const thrown = await client.modules.user.getUser({}).catch((e) => e);

    expect(thrown).toBeInstanceOf(RichError);
    expect(handler.mock.calls[0][0]).toBe(thrown);
  });

  it("reports each failed request separately", async () => {
    const client = makeClient();
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockResolvedValue(failure());

    await expect(client.modules.user.getUser({})).rejects.toThrow();
    await expect(client.modules.user.getUser({})).rejects.toThrow();

    // The idempotence guard is per error instance, not a global latch.
    expect(handler).toHaveBeenCalledTimes(2);
  });
});
