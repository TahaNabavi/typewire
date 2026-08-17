import { ApiClient } from "@tahanabavi/typefetch";
import { graphqlTransport } from "@tahanabavi/typefetch-graphql";
import { grpcTransport } from "@tahanabavi/typefetch-grpc";
import { createSocketClient, defineSocketContracts } from "@tahanabavi/typesocket";
import { z } from "zod";
import { InspectorBridge } from "../bridge";
import { connectTypeFetch, type TypeFetchLike } from "../connect-typefetch";
import { connectTypeSocket, type TypeSocketLike } from "../connect-typesocket";
import { selectEntries } from "../entries";
import type { TypeFetchRequestEvent, TypeSocketEvent } from "../types";

/**
 * These run against the *real* typefetch and typesocket clients. The connectors
 * type both structurally, so nothing but an integration test notices when a
 * transport changes an event field — which is exactly the drift the split
 * architecture is most exposed to.
 */
const httpContracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string(), name: z.string() }),
      mockData: { id: "1", name: "Taha" },
    },
  },
} as const;

const wsContracts = defineSocketContracts({
  chat: {
    sendMessage: {
      direction: "client->server",
      request: z.object({ text: z.string() }),
      ack: z.object({ id: z.string() }),
    },
  },
});

function makeHttp(useMockData = true) {
  const client = new ApiClient(
    { baseUrl: "http://localhost:9999", useMockData, mockDelay: { min: 0, max: 0 } },
    httpContracts,
  );
  client.init();
  return client;
}

function makeWs() {
  return createSocketClient(
    { url: "http://localhost:9999", autoConnect: false },
    wsContracts,
  );
}

/**
 * The same module over three wires, answered from `mockData` so no server is
 * needed. Built against the real adapter packages on purpose: `transport` is a
 * field typefetch fills in from `adapter.kind`, and a hand-written event would
 * prove only that this test can spell "graphql".
 */
const multiContracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string() }),
      mockData: { id: "1" },
    },
    profile: {
      transport: "graphql",
      operation: "query",
      root: "user",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string() }),
      mockData: { id: "1" },
    },
    syncUser: {
      transport: "grpc",
      service: "user.v1.UserService",
      rpc: "GetUser",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string() }),
      mockData: { id: "1" },
    },
  },
} as const;

function makeMultiTransport() {
  const client = new ApiClient(
    {
      baseUrl: "http://localhost:9999",
      useMockData: true,
      mockDelay: { min: 0, max: 0 },
      transports: [graphqlTransport(), grpcTransport()],
    },
    multiContracts,
  );
  client.init();
  return client;
}

/**
 * Drive the connector's hook directly, for the events a real client cannot be
 * made to emit on demand — a legacy start with no `transport`, an unclassified
 * error, a progress tick without an upload.
 */
function driveTypeFetch(
  bridge: InspectorBridge,
  events: TypeFetchRequestEvent[],
): void {
  let hook: Parameters<TypeFetchLike["instrument"]>[0] | undefined;
  connectTypeFetch(
    {
      instrument: (h) => {
        hook = h;
        return () => {};
      },
    },
    bridge,
  );
  for (const event of events) hook?.on?.(event);
}

describe("connectTypeFetch", () => {
  it("records a start and a success for one request", async () => {
    const bridge = new InspectorBridge();
    const client = makeHttp();
    connectTypeFetch(client, bridge);

    await client.modules.user.getUser({ path: { id: "1" } });

    const events = bridge.getSnapshot();
    expect(events.map((e) => e.kind)).toEqual(["start", "success"]);
    expect(events.every((e) => e.source === "http")).toBe(true);
    expect(events.every((e) => e.label === "user.getUser")).toBe(true);
    // Both events share the request id, so they collapse into one row.
    expect(new Set(events.map((e) => e.id)).size).toBe(1);
  });

  it("carries the parsed input and output through", async () => {
    const bridge = new InspectorBridge();
    const client = makeHttp();
    connectTypeFetch(client, bridge);

    await client.modules.user.getUser({ path: { id: "1" } });

    const [entry] = selectEntries(bridge.getSnapshot());
    expect(entry?.status).toBe("success");
    expect(entry?.input).toEqual({ path: { id: "1" } });
    expect(entry?.output).toEqual({ id: "1", name: "Taha" });
  });

  it("records an error entry when the request fails", async () => {
    const bridge = new InspectorBridge();
    const client = makeHttp(false);
    connectTypeFetch(client, bridge);
    bridge.setOverride("http", "user.getUser", {
      error: { status: 500, message: "boom" },
    });

    await expect(
      client.modules.user.getUser({ path: { id: "1" } }),
    ).rejects.toBeDefined();

    const [entry] = selectEntries(bridge.getSnapshot());
    expect(entry?.status).toBe("error");
  });

  it("serves a bridge override without touching the network", async () => {
    const bridge = new InspectorBridge();
    // Mock mode off and an unreachable baseUrl: only the override can answer.
    const client = makeHttp(false);
    connectTypeFetch(client, bridge);
    bridge.setOverride("http", "user.getUser", {
      mock: { id: "override", name: "Forced" },
    });

    const data = await client.modules.user.getUser({ path: { id: "1" } });

    expect(data).toEqual({ id: "override", name: "Forced" });
  });

  it("tags the row with the transport the client actually used", async () => {
    const bridge = new InspectorBridge();
    const client = makeMultiTransport();
    connectTypeFetch(client, bridge);

    await client.modules.user.getUser({ path: { id: "1" } });
    await client.modules.user.profile({ id: "1" });
    await client.modules.user.syncUser({ id: "1" });

    const entries = selectEntries(bridge.getSnapshot());
    expect(entries.map((e) => e.transport)).toEqual(["http", "graphql", "grpc"]);
    // One client, one source: the wire is the new axis, not a second connector.
    expect(entries.every((e) => e.source === "http")).toBe(true);
  });

  it("defaults the transport to http for a client that reports none", () => {
    const bridge = new InspectorBridge();
    driveTypeFetch(bridge, [
      {
        type: "start",
        requestId: "r1",
        endpointId: "user.getUser",
        method: "GET",
        url: "http://x/users/1",
        input: undefined,
        timestamp: 1,
      },
    ]);

    // A typefetch older than the transport registry emits no `transport`, and
    // every call it could make was HTTP. Blank would read as "unknown wire".
    expect(selectEntries(bridge.getSnapshot())[0]?.transport).toBe("http");
  });

  it("lifts the normalized error kind onto the entry", async () => {
    const bridge = new InspectorBridge();
    const client = makeHttp(false);
    connectTypeFetch(client, bridge);
    bridge.setOverride("http", "user.getUser", {
      error: { status: 404, message: "nope" },
    });

    await expect(
      client.modules.user.getUser({ path: { id: "1" } }),
    ).rejects.toBeDefined();

    const [entry] = selectEntries(bridge.getSnapshot());
    expect(entry?.status).toBe("error");
    // The point of the taxonomy: a panel reads this instead of the status, so
    // the same row renders identically when the 404 arrives as a gRPC `5`.
    expect(entry?.errorKind).toBe("not_found");
  });

  it("leaves the error kind unset when the client classifies nothing", () => {
    const bridge = new InspectorBridge();
    driveTypeFetch(bridge, [
      {
        type: "error",
        requestId: "r1",
        endpointId: "user.getUser",
        error: { message: "boom" },
        durationMs: 3,
      },
    ]);

    expect(selectEntries(bridge.getSnapshot())[0]?.errorKind).toBeUndefined();
  });

  it("routes progress to the progress channel, not the event log", () => {
    const bridge = new InspectorBridge();
    driveTypeFetch(bridge, [
      {
        type: "start",
        requestId: "r1",
        endpointId: "user.upload",
        method: "POST",
        url: "http://x/upload",
        transport: "http",
        input: undefined,
        timestamp: 1,
      },
      {
        type: "progress",
        requestId: "r1",
        endpointId: "user.upload",
        phase: "upload",
        loaded: 512,
        total: 1024,
        percent: 50,
        lengthComputable: true,
        durationMs: 5,
      },
    ]);

    expect(bridge.getSnapshot().map((e) => e.kind)).toEqual(["start"]);
    const [entry] = selectEntries(
      bridge.getSnapshot(),
      bridge.getProgressSnapshot(),
    );
    expect(entry?.progress).toMatchObject({ phase: "upload", percent: 50 });
  });

  it("stops recording after the returned detach is called", async () => {
    const bridge = new InspectorBridge();
    const client = makeHttp();
    const detach = connectTypeFetch(client, bridge);
    await client.modules.user.getUser({ path: { id: "1" } });
    const recorded = bridge.getSnapshot().length;

    detach();
    await client.modules.user.getUser({ path: { id: "2" } });

    expect(bridge.getSnapshot()).toHaveLength(recorded);
  });
});

describe("connectTypeSocket", () => {
  it("records an outbound frame and its ack", async () => {
    const bridge = new InspectorBridge();
    const socket = makeWs();
    connectTypeSocket(socket, bridge);
    bridge.setOverride("ws", "chat.sendMessage", { mock: { id: "m1" } });

    await socket.modules.chat.sendMessage({ text: "hello" });

    const events = bridge.getSnapshot();
    expect(events.map((e) => e.kind)).toEqual(["outbound", "ack"]);
    expect(events.every((e) => e.source === "ws")).toBe(true);
    expect(events.every((e) => e.label === "chat.sendMessage")).toBe(true);
  });

  it("collapses the frame into one successful entry", async () => {
    const bridge = new InspectorBridge();
    const socket = makeWs();
    connectTypeSocket(socket, bridge);
    bridge.setOverride("ws", "chat.sendMessage", { mock: { id: "m1" } });

    await socket.modules.chat.sendMessage({ text: "hello" });

    const [entry] = selectEntries(bridge.getSnapshot());
    expect(entry?.status).toBe("success");
    expect(entry?.input).toEqual({ text: "hello" });
    expect(entry?.output).toEqual({ id: "m1" });
  });

  it("maps a generic drop override onto the socket", async () => {
    const bridge = new InspectorBridge();
    const socket = makeWs();
    connectTypeSocket(socket, bridge);
    bridge.setOverride("ws", "chat.sendMessage", { drop: true });

    // A dropped frame never acks; typesocket lets it time out on purpose.
    await expect(
      socket.modules.chat.sendMessage({ text: "hello" }, { timeoutMs: 20 }),
    ).rejects.toBeDefined();

    const [entry] = selectEntries(bridge.getSnapshot());
    expect(entry?.status).toBe("dropped");
  });
});

describe("connectTypeSocket event mapping", () => {
  /**
   * Inbound frames, frame errors and lifecycle events need a server to happen
   * naturally. Driving the hook directly covers the mapping — the part that
   * breaks if typesocket renames a field — without standing one up.
   */
  function drive(events: TypeSocketEvent[]) {
    const bridge = new InspectorBridge();
    let hook: Parameters<TypeSocketLike["instrument"]>[0] | undefined;
    const fake: TypeSocketLike = {
      instrument: (h) => {
        hook = h;
        return () => {};
      },
    };
    connectTypeSocket(fake, bridge);
    for (const event of events) hook?.on?.(event);
    return bridge;
  }

  it("maps an inbound frame", () => {
    const bridge = drive([
      {
        type: "inbound",
        frameId: "f1",
        eventId: "chat.message",
        event: "chat:message",
        payload: { text: "hi" },
        ts: 10,
        injected: false,
      },
    ]);

    expect(bridge.getSnapshot()[0]).toMatchObject({
      source: "ws",
      kind: "inbound",
      id: "f1",
      label: "chat.message",
      payload: { text: "hi" },
      meta: { event: "chat:message", injected: false },
    });
  });

  it("maps a frame error", () => {
    const bridge = drive([
      {
        type: "frame_error",
        frameId: "f2",
        eventId: "chat.sendMessage",
        direction: "outbound",
        error: { message: "bad shape" },
        ts: 11,
      },
    ]);

    expect(bridge.getSnapshot()[0]).toMatchObject({
      kind: "frame_error",
      payload: { message: "bad shape" },
      meta: { direction: "outbound" },
    });
  });

  it("gives each lifecycle event its own row", () => {
    const bridge = drive([
      { type: "connect", ts: 1, socketId: "s1", attempt: 1 },
      { type: "disconnect", ts: 2, reason: "transport close" },
      { type: "connect_error", ts: 3, error: { message: "refused" } },
    ]);

    const entries = selectEntries(bridge.getSnapshot());
    expect(entries).toHaveLength(3);
    expect(entries.map((e) => e.label)).toEqual(["socket", "socket", "socket"]);
    expect(bridge.getSnapshot().map((e) => e.kind)).toEqual([
      "connect",
      "disconnect",
      "connect_error",
    ]);
    expect(bridge.getSnapshot()[1]?.payload).toEqual({ reason: "transport close" });
  });
});

describe("one timeline, any transport", () => {
  it("interleaves HTTP and WS rows in a single bridge", async () => {
    const bridge = new InspectorBridge();
    const http = makeHttp();
    const socket = makeWs();
    connectTypeFetch(http, bridge);
    connectTypeSocket(socket, bridge);
    bridge.setOverride("ws", "chat.sendMessage", { mock: { id: "m1" } });

    await http.modules.user.getUser({ path: { id: "1" } });
    await socket.modules.chat.sendMessage({ text: "hello" });

    const entries = selectEntries(bridge.getSnapshot());
    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.source)).toEqual(["http", "ws"]);
    expect(entries.map((e) => e.label)).toEqual([
      "user.getUser",
      "chat.sendMessage",
    ]);
    expect(entries.every((e) => e.status === "success")).toBe(true);
  });

  it("keys overrides per source, so the same label does not collide", async () => {
    const bridge = new InspectorBridge();
    const http = makeHttp(false);
    connectTypeFetch(http, bridge);
    // An override registered for WS must not steer the HTTP endpoint.
    bridge.setOverride("ws", "user.getUser", { mock: { id: "x", name: "x" } });

    await expect(
      http.modules.user.getUser({ path: { id: "1" } }),
    ).rejects.toBeDefined();
  });
});
