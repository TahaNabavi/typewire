import { createSocketClient, defineSocketContracts } from "@tahanabavi/typesocket";
import { z } from "zod";
import { QueryClient } from "../query-client";
import type { QueryEvent } from "../types";

/**
 * The other half of the cross-package seam. typesocket names its id `eventId`
 * where typefetch names it `endpointId`; the engine accepts both, and only this
 * test fails if that stops being true.
 *
 * No server is involved: an `ack` override answers locally, which typesocket
 * resolves before it ever checks the connection. That keeps the test about the
 * seam rather than about sockets.
 */
const wsContracts = defineSocketContracts({
  chat: {
    sendMessage: {
      direction: "client->server",
      request: z.object({ text: z.string() }),
      ack: z.object({ id: z.string(), text: z.string() }),
    },
  },
});

function makeSocket() {
  const socket = createSocketClient(
    { url: "http://localhost:9999", autoConnect: false },
    wsContracts,
  );
  let counter = 0;
  socket.instrument({
    resolveOverride: () => ({
      ack: (input: unknown) => {
        counter += 1;
        return { id: `m${counter}`, text: (input as { text: string }).text };
      },
    }),
  });
  return socket;
}

describe("typesocket seam", () => {
  it("an acked client->server event satisfies QueryEvent", () => {
    const socket = makeSocket();

    // Compile-time assertion: this line failing to typecheck *is* the test.
    const event: QueryEvent = socket.modules.chat.sendMessage;

    expect(typeof event).toBe("function");
    expect(event.eventId).toBe("chat.sendMessage");
  });

  it("caches a real socket event keyed by its eventId", async () => {
    const socket = makeSocket();
    const queryClient = new QueryClient();
    const event = socket.modules.chat.sendMessage;

    const data = await queryClient.fetchQuery(event, { text: "hello" });

    expect(data).toEqual({ id: "m1", text: "hello" });
    expect(queryClient.cache.find({ endpointId: "chat.sendMessage" })).toHaveLength(1);
    expect(queryClient.getQueryData(event, { text: "hello" })).toEqual(data);
  });

  it("deduplicates concurrent emits of the same payload", async () => {
    const socket = makeSocket();
    const queryClient = new QueryClient();
    const event = socket.modules.chat.sendMessage;

    const a = queryClient.fetchQuery(event, { text: "hi" });
    const b = queryClient.fetchQuery(event, { text: "hi" });

    expect(a).toBe(b);
    // One ack counter increment proves a single emit went out.
    await expect(a).resolves.toEqual({ id: "m1", text: "hi" });
  });

  it("drives a mutation and its declared invalidation", async () => {
    const socket = makeSocket();
    const queryClient = new QueryClient({
      relations: { "chat.sendMessage": ["chat.sendMessage"] },
    });
    const event = socket.modules.chat.sendMessage;
    await queryClient.fetchQuery(event, { text: "seed" }, { staleTime: 10_000 });

    const observer = queryClient.watchMutation(event);
    await observer.mutateAsync({ text: "written" });

    expect(observer.getSnapshot().data).toEqual({ id: "m2", text: "written" });
    expect(
      queryClient.cache
        .find({ endpointId: "chat.sendMessage" })[0]
        ?.getState().isInvalidated,
    ).toBe(true);
  });

  it("surfaces a validation failure as a query error", async () => {
    const socket = createSocketClient(
      { url: "http://localhost:9999", autoConnect: false },
      wsContracts,
    );
    // An ack that violates the contract must fail loudly, not corrupt the cache.
    socket.instrument({ resolveOverride: () => ({ ack: { id: 42 } }) });
    const queryClient = new QueryClient();

    await expect(
      queryClient.fetchQuery(socket.modules.chat.sendMessage, { text: "x" }),
    ).rejects.toBeDefined();

    const query = queryClient.cache.find({ endpointId: "chat.sendMessage" })[0];
    expect(query?.getState().status).toBe("error");
    expect(query?.getState().data).toBeUndefined();
  });
});
