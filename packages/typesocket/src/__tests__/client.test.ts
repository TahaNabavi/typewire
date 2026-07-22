import { io as mockIo } from "socket.io-client";
import { z } from "zod";

import { SocketClient, createSocketClient } from "../client";
import { defineSocketContracts } from "../contract";
import {
  SocketAckTimeoutError,
  SocketError,
  SocketNotConnectedError,
  SocketValidationError,
  SocketWaitTimeoutError,
} from "../errors";

jest.mock("socket.io-client");

/**
 * A socket.io double that models the two behaviours the real client depends on
 * and that v1's flat `jest.fn()` mock hid:
 *   - listeners accumulate in an array (no dedup), so double-registration is
 *     observable rather than silently collapsed;
 *   - `connect` can be replayed, so reconnect behaviour is testable.
 */
function createMockSocket() {
  const listeners = new Map<string, Array<(...args: any[]) => void>>();
  const sent: Array<{ event: string; payload: unknown; hasAck: boolean }> = [];

  const socket = {
    connected: true,
    id: "mock-socket-id",
    listeners,
    sent,

    on(event: string, handler: (...args: any[]) => void) {
      const list = listeners.get(event) ?? [];
      list.push(handler);
      listeners.set(event, list);
      return socket;
    },
    off(event: string, handler: (...args: any[]) => void) {
      const list = listeners.get(event) ?? [];
      listeners.set(
        event,
        list.filter((h) => h !== handler),
      );
      return socket;
    },
    removeAllListeners() {
      listeners.clear();
      return socket;
    },
    emit(event: string, payload: unknown, ack?: (raw: unknown) => void) {
      sent.push({ event, payload, hasAck: typeof ack === "function" });
      if (ack) socket.pendingAck = ack;
      return socket;
    },
    connect() {
      socket.connected = true;
      return socket;
    },
    disconnect() {
      socket.connected = false;
      return socket;
    },

    get volatile() {
      return socket;
    },

    /** The most recent ack callback handed to `emit`. */
    pendingAck: undefined as undefined | ((raw: unknown) => void),

    /** Drives an inbound frame through whatever is bound to `event`. */
    receive(event: string, payload: unknown) {
      for (const handler of [...(listeners.get(event) ?? [])]) handler(payload);
    },
    /** Counts what is bound to `event` — the double-registration probe. */
    countListeners(event: string) {
      return listeners.get(event)?.length ?? 0;
    },
  };

  return socket;
}

const contracts = defineSocketContracts({
  chat: {
    sendMessage: {
      direction: "client->server",
      request: z.object({ text: z.string() }),
      ack: z.object({ id: z.string() }),
    },
    typing: {
      direction: "client->server",
      request: z.object({ isTyping: z.boolean() }),
    },
    message: {
      direction: "server->client",
      payload: z.object({ text: z.string(), user: z.string() }),
    },
  },
});

let socket: ReturnType<typeof createMockSocket>;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  socket = createMockSocket();
  (mockIo as unknown as jest.Mock).mockReturnValue(socket);
});

function makeClient(overrides: Record<string, unknown> = {}) {
  const client = new SocketClient(
    { url: "http://localhost:3001", onValidationError: () => {}, ...overrides },
    contracts,
  );
  client.connect();
  return client;
}

/** Replays socket.io's `connect` event, as happens on connect and reconnect. */
function fireConnect() {
  socket.receive("connect", undefined);
}

describe("contract + wiring", () => {
  it("generates a module surface with stable cross-package ids", () => {
    const client = makeClient();
    expect(client.modules.chat.sendMessage.eventId).toBe("chat.sendMessage");
    expect(client.modules.chat.message.eventId).toBe("chat.message");
    expect(client.modules.chat.sendMessage.def).toBe(contracts.chat.sendMessage);
  });

  it("exposes a flattened event list for devtools", () => {
    expect(makeClient().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "chat.message",
          direction: "server->client",
        }),
      ]),
    );
  });

  it("rejects a contract whose events collide on one wire name", () => {
    expect(
      () =>
        new SocketClient({ url: "/" }, {
          a: { one: { direction: "client->server", event: "dup", request: z.any() } },
          b: { two: { direction: "client->server", event: "dup", request: z.any() } },
        }),
    ).toThrow(/both map to wire event "dup"/);
  });

  it("rejects a contract with an unknown direction", () => {
    expect(
      () =>
        new SocketClient({ url: "/" }, {
          a: { one: { direction: "sideways", request: z.any() } as any },
        }),
    ).toThrow(/invalid direction/);
  });
});

describe("listener registry", () => {
  // v1 registered the wrapped handler on the socket *and* re-registered every
  // stored handler on `connect`, so handlers fired twice on the first
  // connection and once more per reconnect.
  it("dispatches a handler exactly once per frame, across reconnects", () => {
    const client = makeClient();
    const handler = jest.fn();
    client.modules.chat.message.on(handler);

    fireConnect();
    fireConnect();

    socket.receive("chat.message", { text: "hi", user: "taha" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("binds exactly one socket listener per contract event", () => {
    makeClient();
    fireConnect();
    expect(socket.countListeners("chat.message")).toBe(1);
  });

  // v1's `off()` passed the user's callback while the socket held a wrapper,
  // so nothing was ever removed.
  it("off() actually detaches the handler", () => {
    const client = makeClient();
    const handler = jest.fn();
    client.modules.chat.message.on(handler);
    client.modules.chat.message.off(handler);

    socket.receive("chat.message", { text: "hi", user: "taha" });
    expect(handler).not.toHaveBeenCalled();
    expect(client.modules.chat.message.listenerCount).toBe(0);
  });

  it("the subscribe return value detaches the handler", () => {
    const client = makeClient();
    const handler = jest.fn();
    const off = client.modules.chat.message.on(handler);
    off();

    socket.receive("chat.message", { text: "hi", user: "taha" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("once() fires a single time", () => {
    const client = makeClient();
    const handler = jest.fn();
    client.modules.chat.message.once(handler);

    socket.receive("chat.message", { text: "a", user: "taha" });
    socket.receive("chat.message", { text: "b", user: "taha" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("once() is not consumed by a payload that fails validation", () => {
    const client = makeClient();
    const handler = jest.fn();
    client.modules.chat.message.once(handler);

    socket.receive("chat.message", { nope: true });
    socket.receive("chat.message", { text: "b", user: "taha" });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith({ text: "b", user: "taha" });
  });

  it("survives a handler that unsubscribes mid-dispatch", () => {
    const client = makeClient();
    const second = jest.fn();
    const off = client.modules.chat.message.on(() => off());
    client.modules.chat.message.on(second);

    expect(() =>
      socket.receive("chat.message", { text: "x", user: "taha" }),
    ).not.toThrow();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("keeps subscriptions across an explicit reconnect", () => {
    const client = makeClient();
    const handler = jest.fn();
    client.modules.chat.message.on(handler);

    client.reconnect();
    socket.receive("chat.message", { text: "after", user: "taha" });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("routes an invalid inbound payload to onValidationError, not to handlers", () => {
    const onValidationError = jest.fn();
    const client = makeClient({ onValidationError });
    const handler = jest.fn();
    client.modules.chat.message.on(handler);

    socket.receive("chat.message", { text: 42 });

    expect(handler).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalledTimes(1);
    const error = onValidationError.mock.calls[0][0] as SocketValidationError;
    expect(error).toBeInstanceOf(SocketValidationError);
    expect(error.phase).toBe("payload");
    expect(error.eventId).toBe("chat.message");
  });
});

describe("emit", () => {
  it("validates and sends a fire-and-forget frame", () => {
    const client = makeClient();
    client.modules.chat.typing({ isTyping: true });
    expect(socket.sent).toEqual([
      { event: "chat.typing", payload: { isTyping: true }, hasAck: false },
    ]);
  });

  // v1 logged to console.error and returned, so a contract violation was
  // indistinguishable from a successful send.
  it("throws instead of silently dropping an invalid payload", () => {
    const client = makeClient();
    expect(() => client.modules.chat.typing({ isTyping: "yes" } as any)).toThrow(
      SocketValidationError,
    );
    expect(socket.sent).toHaveLength(0);
  });

  // v1's `this.socket?.emit(...)` no-opped when disconnected, losing the frame.
  it("throws when disconnected rather than dropping the frame", () => {
    const client = makeClient();
    socket.connected = false;
    expect(() => client.modules.chat.typing({ isTyping: true })).toThrow(
      SocketNotConnectedError,
    );
  });
});

describe("acknowledgements", () => {
  it("resolves with the validated ack", async () => {
    const client = makeClient();
    const promise = client.modules.chat.sendMessage({ text: "hi" });
    socket.pendingAck!({ id: "m1" });
    await expect(promise).resolves.toEqual({ id: "m1" });
  });

  // v1 typed this return from the `callback` schema but resolved the raw
  // server value — the type was never enforced.
  it("rejects when the server's ack violates the contract", async () => {
    const client = makeClient();
    const promise = client.modules.chat.sendMessage({ text: "hi" });
    socket.pendingAck!({ id: 123 });

    await expect(promise).rejects.toBeInstanceOf(SocketValidationError);
    await expect(promise).rejects.toMatchObject({ phase: "ack" });
  });

  it("rejects an invalid request without touching the wire", async () => {
    const client = makeClient();
    await expect(
      client.modules.chat.sendMessage({ text: 1 } as any),
    ).rejects.toBeInstanceOf(SocketValidationError);
    expect(socket.sent).toHaveLength(0);
  });

  // v1's emitAsync had no timeout: an unanswered emit hung forever.
  it("times out when no ack arrives", async () => {
    jest.useFakeTimers();
    const client = makeClient({ ackTimeoutMs: 1_000 });
    const promise = client.modules.chat.sendMessage({ text: "hi" });
    const assertion = expect(promise).rejects.toBeInstanceOf(
      SocketAckTimeoutError,
    );
    jest.advanceTimersByTime(1_001);
    await assertion;
  });

  it("ignores a late ack that arrives after the timeout", async () => {
    jest.useFakeTimers();
    const client = makeClient({ ackTimeoutMs: 500 });
    const promise = client.modules.chat.sendMessage({ text: "hi" });
    const assertion = expect(promise).rejects.toBeInstanceOf(
      SocketAckTimeoutError,
    );
    jest.advanceTimersByTime(501);
    await assertion;
    expect(() => socket.pendingAck!({ id: "late" })).not.toThrow();
  });

  it("honours a per-call timeout override", async () => {
    jest.useFakeTimers();
    const client = makeClient({ ackTimeoutMs: 60_000 });
    const promise = client.modules.chat.sendMessage({ text: "hi" }, { timeoutMs: 50 });
    const assertion = expect(promise).rejects.toBeInstanceOf(
      SocketAckTimeoutError,
    );
    jest.advanceTimersByTime(51);
    await assertion;
  });

  it("rejects when the caller's signal aborts", async () => {
    const client = makeClient();
    const controller = new AbortController();
    const promise = client.modules.chat.sendMessage(
      { text: "hi" },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "ERR_SOCKET_ABORTED" });
  });
});

describe("queue", () => {
  it("buffers while disconnected and flushes in order on connect", () => {
    const client = makeClient();
    socket.connected = false;

    client.modules.chat.typing.queue({ isTyping: true });
    client.modules.chat.typing.queue({ isTyping: false });
    expect(client.queueSize).toBe(2);
    expect(socket.sent).toHaveLength(0);

    socket.connected = true;
    fireConnect();

    expect(client.queueSize).toBe(0);
    expect(socket.sent.map((f) => f.payload)).toEqual([
      { isTyping: true },
      { isTyping: false },
    ]);
  });

  // v1 queued raw data and flushed it unvalidated.
  it("validates at queue time, not at flush time", () => {
    const client = makeClient();
    socket.connected = false;
    expect(() =>
      client.modules.chat.typing.queue({ isTyping: "later" } as any),
    ).toThrow(SocketValidationError);
    expect(client.queueSize).toBe(0);
  });

  it("sends immediately when already connected", () => {
    const client = makeClient();
    client.modules.chat.typing.queue({ isTyping: true });
    expect(client.queueSize).toBe(0);
    expect(socket.sent).toHaveLength(1);
  });

  it("evicts the oldest frame once the buffer is full", () => {
    const client = makeClient({ maxQueueSize: 2 });
    socket.connected = false;
    client.modules.chat.typing.queue({ isTyping: true });
    client.modules.chat.typing.queue({ isTyping: false });
    client.modules.chat.typing.queue({ isTyping: true });
    expect(client.queueSize).toBe(2);
  });
});

describe("wait", () => {
  it("resolves with the next valid payload", async () => {
    const client = makeClient();
    const promise = client.modules.chat.message.wait({ timeoutMs: 1_000 });
    socket.receive("chat.message", { text: "hello", user: "taha" });
    await expect(promise).resolves.toEqual({ text: "hello", user: "taha" });
  });

  // v1 leaked a listener per call, because its `off()` could not match the
  // wrapper it had registered.
  it("detaches its listener once settled", async () => {
    const client = makeClient();
    const promise = client.modules.chat.message.wait({ timeoutMs: 1_000 });
    socket.receive("chat.message", { text: "hello", user: "taha" });
    await promise;
    expect(client.modules.chat.message.listenerCount).toBe(0);
  });

  it("detaches its listener on timeout", async () => {
    jest.useFakeTimers();
    const client = makeClient();
    const promise = client.modules.chat.message.wait({ timeoutMs: 100 });
    const assertion = expect(promise).rejects.toBeInstanceOf(
      SocketWaitTimeoutError,
    );
    jest.advanceTimersByTime(101);
    await assertion;
    expect(client.modules.chat.message.listenerCount).toBe(0);
  });

  // v1 rejected the wait when *any* frame on that event failed validation.
  it("stays armed when an unrelated invalid frame arrives", async () => {
    const client = makeClient();
    const promise = client.modules.chat.message.wait({ timeoutMs: 1_000 });
    socket.receive("chat.message", { garbage: true });
    socket.receive("chat.message", { text: "real", user: "taha" });
    await expect(promise).resolves.toEqual({ text: "real", user: "taha" });
  });

  it("honours a filter predicate", async () => {
    const client = makeClient();
    const promise = client.modules.chat.message.wait({
      timeoutMs: 1_000,
      filter: (m) => m.user === "taha",
    });
    socket.receive("chat.message", { text: "no", user: "other" });
    socket.receive("chat.message", { text: "yes", user: "taha" });
    await expect(promise).resolves.toEqual({ text: "yes", user: "taha" });
  });
});

describe("middleware", () => {
  it("observes both directions", () => {
    const client = makeClient();
    const seen: string[] = [];
    client.use((frame) => void seen.push(`${frame.direction}:${frame.eventId}`));

    client.modules.chat.typing({ isTyping: true });
    socket.receive("chat.message", { text: "hi", user: "taha" });

    expect(seen).toEqual(["outbound:chat.typing", "inbound:chat.message"]);
  });

  it("drops a frame when it returns false", () => {
    const client = makeClient();
    client.use(() => false);
    const handler = jest.fn();
    client.modules.chat.message.on(handler);

    client.modules.chat.typing({ isTyping: true });
    socket.receive("chat.message", { text: "hi", user: "taha" });

    expect(socket.sent).toHaveLength(0);
    expect(handler).not.toHaveBeenCalled();
  });

  it("rewrites a payload, which is then validated", () => {
    const client = makeClient();
    client.use(() => ({ payload: { isTyping: false } }));
    client.modules.chat.typing({ isTyping: true });
    expect(socket.sent[0]?.payload).toEqual({ isTyping: false });
  });

  it("rejects a rewrite that breaks the contract", () => {
    const client = makeClient();
    client.use(() => ({ payload: { isTyping: "nope" } }));
    expect(() => client.modules.chat.typing({ isTyping: true })).toThrow(
      SocketValidationError,
    );
  });

  it("survives a throwing middleware", () => {
    const client = makeClient();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    client.use(() => {
      throw new Error("boom");
    });

    expect(() => client.modules.chat.typing({ isTyping: true })).not.toThrow();
    expect(socket.sent).toHaveLength(1);
    spy.mockRestore();
  });

  it("is removable", () => {
    const client = makeClient();
    const middleware = jest.fn();
    const remove = client.use(middleware);
    remove();
    client.modules.chat.typing({ isTyping: true });
    expect(middleware).not.toHaveBeenCalled();
  });
});

describe("instrumentation", () => {
  it("emits nothing when no hook is attached", () => {
    const client = makeClient();
    // The un-instrumented path must not even construct events.
    expect(() => client.modules.chat.typing({ isTyping: true })).not.toThrow();
    expect(socket.sent).toHaveLength(1);
  });

  it("reports outbound frames with a stable id and the endpoint identity", () => {
    const client = makeClient();
    const on = jest.fn();
    client.instrument({ on });

    client.modules.chat.typing({ isTyping: true });

    expect(on).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "outbound",
        eventId: "chat.typing",
        event: "chat.typing",
        payload: { isTyping: true },
        expectsAck: false,
        queued: false,
      }),
    );
  });

  it("correlates an emit with its ack via frameId", async () => {
    const client = makeClient();
    const events: any[] = [];
    client.instrument({ on: (e) => void events.push(e) });

    const promise = client.modules.chat.sendMessage({ text: "hi" });
    socket.pendingAck!({ id: "m1" });
    await promise;

    const outbound = events.find((e) => e.type === "outbound");
    const ack = events.find((e) => e.type === "ack");
    expect(outbound.expectsAck).toBe(true);
    expect(ack.frameId).toBe(outbound.frameId);
    expect(ack.data).toEqual({ id: "m1" });
    expect(ack.fromMock).toBe(false);
  });

  it("reports inbound frames with the parsed payload", () => {
    const client = makeClient();
    const on = jest.fn();
    client.instrument({ on });

    socket.receive("chat.message", { text: "hi", user: "taha" });

    expect(on).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "inbound",
        eventId: "chat.message",
        payload: { text: "hi", user: "taha" },
        injected: false,
      }),
    );
  });

  it("reports lifecycle transitions", () => {
    const client = makeClient();
    const on = jest.fn();
    client.instrument({ on });

    fireConnect();
    socket.receive("disconnect", "transport close");

    expect(on).toHaveBeenCalledWith(
      expect.objectContaining({ type: "connect", attempt: 1 }),
    );
    expect(on).toHaveBeenCalledWith(
      expect.objectContaining({ type: "disconnect", reason: "transport close" }),
    );
  });

  it("detaches on unsubscribe", () => {
    const client = makeClient();
    const on = jest.fn();
    client.instrument({ on })();
    client.modules.chat.typing({ isTyping: true });
    expect(on).not.toHaveBeenCalled();
  });

  it("lets the first hook that answers win the override", () => {
    const client = makeClient();
    client.instrument({ resolveOverride: () => undefined });
    client.instrument({ resolveOverride: () => ({ drop: true }) });
    client.instrument({ resolveOverride: () => ({ drop: false }) });

    client.modules.chat.typing({ isTyping: true });
    expect(socket.sent).toHaveLength(0);
  });
});

describe("overrides", () => {
  it("drops an outbound frame", () => {
    const client = makeClient();
    client.instrument({ resolveOverride: () => ({ drop: true }) });
    client.modules.chat.typing({ isTyping: true });
    expect(socket.sent).toHaveLength(0);
  });

  it("drops an inbound frame", () => {
    const client = makeClient();
    const handler = jest.fn();
    client.modules.chat.message.on(handler);
    client.instrument({ resolveOverride: () => ({ drop: true }) });

    socket.receive("chat.message", { text: "hi", user: "taha" });
    expect(handler).not.toHaveBeenCalled();
  });

  it("answers an ack locally without touching the network", async () => {
    const client = makeClient();
    client.instrument({ resolveOverride: () => ({ ack: { id: "mocked" } }) });

    await expect(client.modules.chat.sendMessage({ text: "hi" })).resolves.toEqual(
      { id: "mocked" },
    );
    expect(socket.sent).toHaveLength(0);
  });

  it("validates a mocked ack against the contract", async () => {
    const client = makeClient();
    client.instrument({ resolveOverride: () => ({ ack: { id: 42 } }) });
    await expect(
      client.modules.chat.sendMessage({ text: "hi" }),
    ).rejects.toBeInstanceOf(SocketValidationError);
  });

  it("rewrites an inbound payload and flags it as injected", () => {
    const client = makeClient();
    const handler = jest.fn();
    client.modules.chat.message.on(handler);
    client.instrument({
      resolveOverride: () => ({ payload: { text: "forced", user: "devtools" } }),
    });

    socket.receive("chat.message", { text: "real", user: "taha" });
    expect(handler).toHaveBeenCalledWith({ text: "forced", user: "devtools" });
  });

  it("swaps the response schema at runtime", () => {
    const onValidationError = jest.fn();
    const client = makeClient({ onValidationError });
    const handler = jest.fn();
    client.modules.chat.message.on(handler);
    client.instrument({
      resolveOverride: () => ({ response: z.object({ different: z.string() }) }),
    });

    socket.receive("chat.message", { text: "hi", user: "taha" });
    expect(handler).not.toHaveBeenCalled();
    expect(onValidationError).toHaveBeenCalled();
  });

  it("forces an error", () => {
    const client = makeClient();
    client.instrument({
      resolveOverride: () => ({ error: { message: "simulated outage" } }),
    });
    expect(() => client.modules.chat.typing({ isTyping: true })).toThrow(
      /simulated outage/,
    );
  });

  it("times out a dropped frame that expects an ack", async () => {
    jest.useFakeTimers();
    const client = makeClient({ ackTimeoutMs: 200 });
    client.instrument({ resolveOverride: () => ({ drop: true }) });

    const promise = client.modules.chat.sendMessage({ text: "hi" });
    const assertion = expect(promise).rejects.toBeInstanceOf(
      SocketAckTimeoutError,
    );
    jest.advanceTimersByTime(201);
    await assertion;
  });
});

describe("connection management", () => {
  it("connect() is idempotent and never opens a second socket", () => {
    const client = makeClient();
    client.connect();
    client.connect();
    expect(mockIo).toHaveBeenCalledTimes(1);
  });

  // v1's reconnectWithBackoff called init() without disconnecting, leaking a
  // socket per attempt.
  it("reconnect() tears the old socket down before opening a new one", () => {
    const client = makeClient();
    client.reconnect();
    expect(mockIo).toHaveBeenCalledTimes(2);
    expect(socket.listeners.size).toBeGreaterThan(0);
  });

  it("disconnect() detaches every socket listener", () => {
    const client = makeClient();
    client.disconnect();
    expect(socket.listeners.size).toBe(0);
    expect(client.raw).toBeNull();
    expect(client.connected).toBe(false);
  });

  it("destroy() clears handlers, middleware and instrumentation", () => {
    const client = makeClient();
    const handler = jest.fn();
    const on = jest.fn();
    client.modules.chat.message.on(handler);
    client.instrument({ on });

    client.destroy();
    expect(client.modules.chat.message.listenerCount).toBe(0);
    expect(client.connected).toBe(false);
  });

  it("surfaces connect errors as a normalized shape", () => {
    const onConnectError = jest.fn();
    const client = makeClient();
    client.onConnectError(onConnectError);

    socket.receive("connect_error", new Error("refused"));
    expect(onConnectError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "refused", code: "ERR_SOCKET_CONNECT" }),
    );
  });

  it("survives a throwing lifecycle handler", () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient();
    const second = jest.fn();
    client.onConnect(() => {
      throw new Error("boom");
    });
    client.onConnect(second);

    expect(() => fireConnect()).not.toThrow();
    expect(second).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("exposes the socket id", () => {
    expect(makeClient().id).toBe("mock-socket-id");
  });
});

describe("createSocketClient", () => {
  it("connects immediately by default", () => {
    createSocketClient({ url: "http://localhost:3001" }, contracts);
    expect(mockIo).toHaveBeenCalledTimes(1);
  });

  it("defers when autoConnect is false", () => {
    const client = createSocketClient(
      { url: "http://localhost:3001", autoConnect: false },
      contracts,
    );
    expect(mockIo).not.toHaveBeenCalled();
    client.connect();
    expect(mockIo).toHaveBeenCalledTimes(1);
  });
});

describe("errors", () => {
  it("every error carries a stable code and the event it belongs to", () => {
    const error = new SocketValidationError({
      eventId: "chat.typing",
      phase: "request",
      issues: [],
      received: null,
    });
    expect(error).toBeInstanceOf(SocketError);
    expect(error.code).toBe("ERR_SOCKET_VALIDATION");
    expect(error.eventId).toBe("chat.typing");
    expect(error.toJSON()).toMatchObject({ code: "ERR_SOCKET_VALIDATION" });
  });
});
