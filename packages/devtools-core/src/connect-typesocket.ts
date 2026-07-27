import type { InspectorBridge } from "./bridge";
import type {
  Instrumentable,
  TypeSocketEvent,
  TypeSocketOverride,
} from "./types";

/** A typesocket `SocketClient`, reduced to the seam this connector uses. */
export type TypeSocketLike = Instrumentable<TypeSocketEvent, TypeSocketOverride>;

/**
 * Feed a typesocket client's frames into the same bridge as HTTP traffic.
 *
 * This is the payoff of the split: adding WS is one more connector, not a
 * refactor. Rows arrive tagged `source: "ws"` and land in the same timeline.
 */
export function connectTypeSocket(
  socket: TypeSocketLike,
  bridge: InspectorBridge,
): () => void {
  return socket.instrument({
    on: (event) => {
      switch (event.type) {
        case "outbound":
          bridge.record({
            source: "ws",
            kind: "outbound",
            id: event.frameId,
            label: event.eventId,
            ts: event.ts,
            payload: event.payload,
            meta: {
              event: event.event,
              queued: event.queued,
              expectsAck: event.expectsAck,
            },
          });
          return;
        case "ack":
          bridge.record({
            source: "ws",
            kind: "ack",
            id: event.frameId,
            label: event.eventId,
            ts: Date.now(),
            payload: event.data,
            durationMs: event.durationMs,
            meta: { fromMock: event.fromMock },
          });
          return;
        case "inbound":
          bridge.record({
            source: "ws",
            kind: "inbound",
            id: event.frameId,
            label: event.eventId,
            ts: event.ts,
            payload: event.payload,
            meta: { event: event.event, injected: event.injected },
          });
          return;
        case "dropped":
          bridge.record({
            source: "ws",
            kind: "dropped",
            id: event.frameId,
            label: event.eventId,
            ts: event.ts,
            payload: undefined,
            meta: { direction: event.direction, by: event.by },
          });
          return;
        case "frame_error":
          bridge.record({
            source: "ws",
            kind: "frame_error",
            id: event.frameId,
            label: event.eventId,
            ts: event.ts,
            payload: event.error,
            meta: { direction: event.direction },
          });
          return;
        default:
          // Lifecycle events carry no frame id, so they get a synthetic one
          // keyed to their timestamp — otherwise every connect/disconnect would
          // collapse into a single timeline row.
          bridge.record({
            source: "ws",
            kind: event.type,
            id: `lifecycle-${event.type}-${event.ts}`,
            label: "socket",
            ts: event.ts,
            payload:
              event.type === "connect_error"
                ? event.error
                : event.type === "disconnect"
                  ? { reason: event.reason }
                  : { socketId: event.socketId, attempt: event.attempt },
          });
      }
    },
    resolveOverride: (eventId) => {
      const override = bridge.getOverride("ws", eventId);
      if (!override) return undefined;
      const mapped: TypeSocketOverride = {};
      // A generic `mock` means "answer locally", which for a socket is the ack.
      if ("mock" in override) mapped.ack = override.mock;
      if (override.error) mapped.error = override.error;
      if (override.latencyMs !== undefined) mapped.latencyMs = override.latencyMs;
      if (override.drop !== undefined) mapped.drop = override.drop;
      return mapped;
    },
  });
}
