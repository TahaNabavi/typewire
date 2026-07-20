import { z } from "zod";
import { ApiClient, RichError } from "../client";
import { Contracts, RequestEvent } from "../types";

global.fetch = jest.fn();

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
      request: z.object({ body: z.object({ name: z.string() }) }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
  },
} satisfies Contracts;

describe("Endpoint metadata", () => {
  let client: ApiClient<typeof contracts>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiClient({ baseUrl: "https://api.test.com" }, contracts);
    client.init();
  });

  it("attaches a stable endpointId to each generated method", () => {
    expect(client.modules.user.getUser.endpointId).toBe("user.getUser");
    expect(client.modules.user.createUser.endpointId).toBe("user.createUser");
  });

  it("exposes the original contract on each method", () => {
    expect(client.modules.user.getUser.endpoint).toBe(contracts.user.getUser);
    expect(client.modules.user.getUser.endpoint.method).toBe("GET");
    expect(client.modules.user.getUser.endpoint.path).toBe("/users/:id");
  });
});

describe("Instrumentation events", () => {
  let client: ApiClient<typeof contracts>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiClient({ baseUrl: "https://api.test.com" }, contracts);
    client.init();
  });

  it("emits start then success with parsed input and data", async () => {
    const events: RequestEvent[] = [];
    client.instrument({ on: (e) => events.push(e) });

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    await client.modules.user.getUser({ path: { id: "1" } });

    expect(events).toHaveLength(2);

    const start = events[0];
    expect(start.type).toBe("start");
    if (start.type === "start") {
      expect(start.endpointId).toBe("user.getUser");
      expect(start.method).toBe("GET");
      expect(start.url).toBe("https://api.test.com/users/:id");
      expect(start.input).toEqual({ path: { id: "1" } });
      expect(typeof start.requestId).toBe("string");
    }

    const success = events[1];
    expect(success.type).toBe("success");
    if (success.type === "success") {
      expect(success.endpointId).toBe("user.getUser");
      expect(success.data).toEqual({ id: "1", name: "John" });
      expect(success.fromMock).toBe(false);
      expect(success.requestId).toBe(
        start.type === "start" ? start.requestId : "",
      );
      expect(typeof success.durationMs).toBe("number");
    }
  });

  it("emits an error event with the normalized error on failure", async () => {
    const events: RequestEvent[] = [];
    client.instrument({ on: (e) => events.push(e) });

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ message: "nope" }),
    });

    await expect(
      client.modules.user.getUser({ path: { id: "1" } }),
    ).rejects.toThrow(RichError);

    const error = events.find((e) => e.type === "error");
    expect(error).toBeDefined();
    if (error && error.type === "error") {
      expect(error.status).toBe(404);
      expect(error.error.message).toBe("nope");
    }
  });

  it("supports multiple hooks and unsubscribes cleanly", async () => {
    const a: RequestEvent[] = [];
    const b: RequestEvent[] = [];
    client.instrument({ on: (e) => a.push(e) });
    const stopB = client.instrument({ on: (e) => b.push(e) });

    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    await client.modules.user.getUser({ path: { id: "1" } });
    expect(a).toHaveLength(2);
    expect(b).toHaveLength(2);

    stopB();
    await client.modules.user.getUser({ path: { id: "1" } });
    expect(a).toHaveLength(4);
    expect(b).toHaveLength(2); // no longer receiving events
  });
});

describe("Runtime overrides", () => {
  let client: ApiClient<typeof contracts>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiClient({ baseUrl: "https://api.test.com" }, contracts);
    client.init();
  });

  it("forces mock data and bypasses the network (mock mode off)", async () => {
    client.instrument({
      resolveOverride: (id) =>
        id === "user.getUser"
          ? { mock: { id: "forced", name: "Forced User" } }
          : undefined,
    });

    const result = await client.modules.user.getUser({ path: { id: "1" } });

    expect(result).toEqual({ id: "forced", name: "Forced User" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("validates forced mock against the response schema", async () => {
    client.instrument({
      resolveOverride: () => ({ mock: { id: "forced" } }), // missing `name`
    });

    await expect(
      client.modules.user.getUser({ path: { id: "1" } }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("forces an error and fires the error handler", async () => {
    const handler = jest.fn();
    client.onError(handler);
    client.instrument({
      resolveOverride: () => ({
        error: { status: 503, message: "simulated outage", code: "DOWN" },
      }),
    });

    try {
      await client.modules.user.getUser({ path: { id: "1" } });
      fail("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(RichError);
      expect((e as RichError).status).toBe(503);
      expect((e as RichError).code).toBe("DOWN");
    }
    expect(handler).toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("swaps the response schema at runtime", async () => {
    client.instrument({
      resolveOverride: () => ({
        response: z.object({ id: z.string() }), // narrower shape
      }),
    });

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    const result = await client.modules.user.getUser({ path: { id: "1" } });
    // Overridden schema strips `name`.
    expect(result).toEqual({ id: "1" });
  });

  it("injects latency before resolving", async () => {
    client.instrument({ resolveOverride: () => ({ latencyMs: 50 }) });

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    const start = Date.now();
    await client.modules.user.getUser({ path: { id: "1" } });
    expect(Date.now() - start).toBeGreaterThanOrEqual(45);
  });

  it("does not affect requests when no override is returned", async () => {
    client.instrument({ resolveOverride: () => undefined });

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    const result = await client.modules.user.getUser({ path: { id: "1" } });
    expect(result).toEqual({ id: "1", name: "John" });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
