import {
  InspectorBridge,
  connectQueryClient,
  connectTypeFetch,
  connectTypeSocket,
} from "@tahanabavi/type-devtools-core";
import { ApiClient } from "@tahanabavi/typefetch";
import { QueryClient } from "@tahanabavi/typefetch-query-core";
import { createSocketClient } from "@tahanabavi/typesocket";
import { httpContracts, wsContracts } from "./contracts.js";

/**
 * Wires the whole stack once, so the headless run and the React app demonstrate
 * the *same* setup rather than two that drifted apart.
 *
 * Both transports answer locally through `instrument({ resolveOverride })`, so
 * the example needs no server and no network. That is not a testing shim: it is
 * the same seam a devtools panel uses to force a mock, an error or latency at
 * runtime.
 */
export function createStack() {
  const http = new ApiClient(
    { baseUrl: "http://localhost:9310", mockDelay: { min: 0, max: 0 } },
    httpContracts,
  );
  http.init();

  // A tiny in-memory store, so an update is actually visible on the next read.
  // Two records, because one cache entry per input is the thing worth seeing.
  const users: Record<string, { id: string; name: string; version: number }> = {
    "1": { id: "1", name: "Taha", version: 1 },
    "2": { id: "2", name: "Ada", version: 1 },
  };
  http.instrument({
    resolveOverride: (endpointId, input) => {
      const { path } = input as { path: { id: string } };
      const record = users[path.id];
      if (!record) return undefined;
      if (endpointId === "user.getUser") return { mock: { ...record } };
      if (endpointId === "user.updateUser") {
        const { body } = input as { body: { name: string } };
        record.name = body.name;
        record.version += 1;
        return { mock: { ok: true } };
      }
      return undefined;
    },
  });

  const socket = createSocketClient(
    { url: "http://localhost:9310", autoConnect: false },
    wsContracts,
  );
  let sent = 0;
  socket.instrument({
    resolveOverride: () => ({
      ack: (input: unknown) => {
        sent += 1;
        return { id: `m${sent}`, text: (input as { text: string }).text };
      },
    }),
  });

  // ── One bridge, two transports ─────────────────────────────────────────────
  // The point of the devtools split: adding the second source is one more line,
  // not a second inspector.
  const bridge = new InspectorBridge();
  connectTypeFetch(http, bridge);
  connectTypeSocket(socket, bridge);

  // ── The setup site ─────────────────────────────────────────────────────────
  // Invalidation is declared once, here. Nothing downstream names a cache key.
  const client = new QueryClient({
    relations: { "user.updateUser": ["user.getUser"] },
  });

  // The cache inspector: the same store the devtools Cache tab renders. It reads
  // the client structurally, so this line is where devtools-core's
  // `QueryClientLike` is proven compatible with the real `QueryClient`.
  const queries = connectQueryClient(client);

  return {
    client,
    bridge,
    queries,
    socket,
    getUser: http.modules.user.getUser,
    updateUser: http.modules.user.updateUser,
    sendMessage: socket.modules.chat.sendMessage,
  };
}
