import type { InspectorBridge } from "./bridge";
import type {
  Instrumentable,
  TypeFetchOverride,
  TypeFetchRequestEvent,
} from "./types";

/** A typefetch `ApiClient`, reduced to the seam this connector uses. */
export type TypeFetchLike = Instrumentable<
  TypeFetchRequestEvent,
  TypeFetchOverride
>;

/**
 * Feed a typefetch client's traffic into a bridge, and let the bridge's
 * overrides steer it. Returns the detach function `instrument` handed back.
 *
 * The client is typed structurally, so devtools-core never imports typefetch —
 * the panel works against any client exposing the same `instrument` seam.
 */
export function connectTypeFetch(
  client: TypeFetchLike,
  bridge: InspectorBridge,
): () => void {
  return client.instrument({
    on: (event) => {
      switch (event.type) {
        case "start":
          bridge.record({
            source: "http",
            kind: "start",
            id: event.requestId,
            label: event.endpointId,
            ts: event.timestamp,
            payload: event.input,
            meta: { method: event.method, url: event.url },
          });
          return;
        case "success":
          bridge.record({
            source: "http",
            kind: "success",
            id: event.requestId,
            label: event.endpointId,
            // typefetch reports elapsed time, not a wall clock, on completion.
            ts: Date.now(),
            payload: event.data,
            durationMs: event.durationMs,
            meta: { fromMock: event.fromMock },
          });
          return;
        case "error":
          bridge.record({
            source: "http",
            kind: "error",
            id: event.requestId,
            label: event.endpointId,
            ts: Date.now(),
            payload: event.error,
            durationMs: event.durationMs,
            meta: { status: event.status },
          });
          return;
      }
    },
    resolveOverride: (endpointId) => {
      const override = bridge.getOverride("http", endpointId);
      if (!override) return undefined;
      // `drop` is intentionally not mapped: HTTP has no discard-the-frame
      // equivalent, and silently treating it as an error would misreport what
      // the panel was asked to do.
      const mapped: TypeFetchOverride = {};
      if ("mock" in override) mapped.mock = override.mock;
      if (override.error) mapped.error = override.error;
      if (override.latencyMs !== undefined) mapped.latencyMs = override.latencyMs;
      return mapped;
    },
  });
}
