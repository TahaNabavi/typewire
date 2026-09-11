import type { InspectorBridge } from './bridge'
import type {
  Instrumentable,
  TypeFetchOverride,
  TypeFetchRequestEvent,
} from './types'

/** A typefetch `ApiClient`, reduced to the seam this connector uses. */
export type TypeFetchLike = Instrumentable<
  TypeFetchRequestEvent,
  TypeFetchOverride
>

/**
 * Feed a typefetch client's traffic into a bridge, and let the bridge's
 * overrides steer it. Returns the detach function `instrument` handed back.
 *
 * The client is typed structurally, so devtools-core never imports typefetch —
 * the panel works against any client exposing the same `instrument` seam.
 */
export function connectTypeFetch(
  client: TypeFetchLike,
  bridge: InspectorBridge
): () => void {
  return client.instrument({
    on: (event) => {
      switch (event.type) {
        case 'start':
          bridge.record({
            source: 'http',
            kind: 'start',
            id: event.requestId,
            label: event.endpointId,
            ts: event.timestamp,
            payload: event.input,
            // Defaulted, not left blank: a typefetch older than the transport
            // registry reports none, and every call it could possibly make was
            // HTTP. Showing "http" is the truth there; showing nothing would
            // read as "unknown wire" for a client that only ever had one.
            transport: event.transport ?? 'http',
            meta: { method: event.method, url: event.url },
          })
          return
        case 'success':
          bridge.record({
            source: 'http',
            kind: 'success',
            id: event.requestId,
            label: event.endpointId,
            // typefetch reports elapsed time, not a wall clock, on completion.
            ts: Date.now(),
            payload: event.data,
            durationMs: event.durationMs,
            meta: { fromMock: event.fromMock },
          })
          return
        case 'error':
          bridge.record({
            source: 'http',
            kind: 'error',
            id: event.requestId,
            label: event.endpointId,
            ts: Date.now(),
            payload: event.error,
            durationMs: event.durationMs,
            // `kind` is lifted out of the error rather than left inside it.
            // `status` is meaningless on gRPC and GraphQL, so it is the only
            // field an inspector can rely on to say what went wrong — it has to
            // be reachable without walking a transport-specific body.
            meta: { status: event.status, kind: event.error?.kind },
          })
          return
        case 'progress':
          // Routed to the progress channel, not `record`. Ticks arrive far too
          // often to belong in the event log — see `recordProgress`.
          bridge.recordProgress('http', event.requestId, {
            phase: event.phase,
            loaded: event.loaded,
            total: event.total,
            percent: event.percent,
            lengthComputable: event.lengthComputable,
            ts: Date.now(),
          })
          return
      }
    },
    resolveOverride: (endpointId) => {
      const override = bridge.getOverride('http', endpointId)
      if (!override) return undefined
      // `drop` is intentionally not mapped: HTTP has no discard-the-frame
      // equivalent, and silently treating it as an error would misreport what
      // the panel was asked to do.
      const mapped: TypeFetchOverride = {}
      if ('mock' in override) mapped.mock = override.mock
      if (override.error) mapped.error = override.error
      if (override.latencyMs !== undefined)
        mapped.latencyMs = override.latencyMs
      return mapped
    },
  })
}
