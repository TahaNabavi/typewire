import {
  DEFAULT_ACK_TIMEOUT_MS,
  DEFAULT_MAX_QUEUE_SIZE,
  resolveSocketConfig,
  socketConfigFromEnv,
  toIoOptions,
} from "../config";

describe("socketConfigFromEnv", () => {
  it("reads a prefixed environment", () => {
    const config = socketConfigFromEnv("NEXT_PUBLIC_SOCKET_", {
      NEXT_PUBLIC_SOCKET_URL: "https://api.example.com",
      NEXT_PUBLIC_SOCKET_RECONNECTION_ATTEMPTS: "3",
      NEXT_PUBLIC_SOCKET_ACK_TIMEOUT: "2500",
      NEXT_PUBLIC_SOCKET_AUTH_TOKEN: "t0ken",
    });

    expect(config).toEqual({
      url: "https://api.example.com",
      reconnectionAttempts: 3,
      ackTimeoutMs: 2500,
      auth: { token: "t0ken" },
    });
  });

  // v1 hardcoded the NEXT_PUBLIC_ prefix inside a framework-agnostic package.
  it("supports any prefix", () => {
    expect(socketConfigFromEnv("VITE_SOCKET_", { VITE_SOCKET_URL: "/ws" })).toEqual(
      { url: "/ws" },
    );
  });

  it("omits keys that are absent, so it layers over explicit config", () => {
    expect(socketConfigFromEnv("SOCKET_", {})).toEqual({});
  });

  it("treats only the literal string 'false' as disabling a flag", () => {
    expect(socketConfigFromEnv("S_", { S_AUTO_CONNECT: "false" }).autoConnect).toBe(
      false,
    );
    expect(socketConfigFromEnv("S_", { S_AUTO_CONNECT: "true" }).autoConnect).toBe(
      true,
    );
  });

  it("ignores a non-numeric numeric var rather than yielding NaN", () => {
    expect(
      socketConfigFromEnv("S_", { S_RECONNECTION_DELAY: "soon" }),
    ).toEqual({});
  });

  it("warns and continues when QUERY_PARAMS is not valid JSON", () => {
    const spy = jest.spyOn(console, "warn").mockImplementation(() => {});
    expect(socketConfigFromEnv("S_", { S_QUERY_PARAMS: "{oops" })).toEqual({});
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("parses transports and discards unknown values", () => {
    expect(
      socketConfigFromEnv("S_", { S_TRANSPORTS: "websocket, bogus ,polling" })
        .transports,
    ).toEqual(["websocket", "polling"]);
  });
});

describe("resolveSocketConfig", () => {
  it("applies defaults without clobbering explicit values", () => {
    const resolved = resolveSocketConfig({ url: "/ws", ackTimeoutMs: 42 });
    expect(resolved.ackTimeoutMs).toBe(42);
    expect(resolved.maxQueueSize).toBe(DEFAULT_MAX_QUEUE_SIZE);
    expect(resolved.reconnection).toBe(true);
    expect(resolved.debug).toBe(false);
  });

  it("falls back to the default ack timeout", () => {
    expect(resolveSocketConfig({ url: "/ws" }).ackTimeoutMs).toBe(
      DEFAULT_ACK_TIMEOUT_MS,
    );
  });

  it("keeps an explicit false for autoConnect", () => {
    expect(resolveSocketConfig({ url: "/ws", autoConnect: false }).autoConnect).toBe(
      false,
    );
  });
});

describe("toIoOptions", () => {
  it("passes a static auth object through", () => {
    expect(toIoOptions({ url: "/", auth: { token: "a" } }).auth).toEqual({
      token: "a",
    });
  });

  // A function is mapped to socket.io's callback form so it is re-invoked on
  // every reconnect — a refreshed token needs no new client.
  it("maps a function auth to the callback form", () => {
    let calls = 0;
    const options = toIoOptions({
      url: "/",
      auth: () => ({ token: `t${++calls}` }),
    });

    const authFn = options.auth as (cb: (d: unknown) => void) => void;
    const seen: unknown[] = [];
    authFn((d) => seen.push(d));
    authFn((d) => seen.push(d));

    expect(seen).toEqual([{ token: "t1" }, { token: "t2" }]);
  });

  it("lets ioOptions override anything it models", () => {
    expect(
      toIoOptions({ url: "/", path: "/a", ioOptions: { path: "/b" } }).path,
    ).toBe("/b");
  });
});
