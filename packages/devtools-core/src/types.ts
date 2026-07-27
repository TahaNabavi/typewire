/** Which transport produced an event. Open string so new sources can be added. */
export type InspectorSource = "http" | "ws" | (string & {});

/**
 * The reactivity contract, redeclared rather than imported from
 * `typefetch-query-core` so the bridge stays dependency-free. Structurally
 * identical, so anything binding one binds the other.
 */
export interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/**
 * A generic, source-tagged inspector event. Each transport maps its own events
 * (typefetch `RequestEvent`, typesocket `SocketEvent`) into this shape so the
 * panel can render one unified timeline.
 */
export interface InspectorEvent {
  source: InspectorSource;
  /** Transport-specific event name, e.g. `start`, `ack`, `dropped`. */
  kind: string;
  /** Correlates related events: typefetch's `requestId`, typesocket's `frameId`. */
  id: string;
  /** The `"module.member"` key — `endpointId` or `eventId`. */
  label: string;
  /** Timestamp (ms). */
  ts: number;
  /** The meaningful data for this event: the input, the result, or the error. */
  payload: unknown;
  /** Elapsed time, on the events that conclude a call. */
  durationMs?: number;
  /** Transport-specific extras (`fromMock`, `queued`, `direction`, `by`, …). */
  meta?: Record<string, unknown>;
}

/**
 * How one collapsed timeline row looks: every event sharing a correlation id,
 * reduced to a single request/frame.
 */
export interface InspectorEntry {
  /** `${source}:${id}` — unique across transports. */
  key: string;
  source: InspectorSource;
  id: string;
  label: string;
  status: "pending" | "success" | "error" | "dropped" | "info";
  startedAt: number;
  durationMs?: number;
  input?: unknown;
  output?: unknown;
  error?: unknown;
  events: InspectorEvent[];
}

/**
 * A transport-neutral override. Each connector translates the fields its
 * transport understands and ignores the rest, so a panel offers one control set
 * for HTTP and WS instead of two.
 */
export interface InspectorOverride {
  /** Answer locally: a mocked HTTP response, or a mocked WS ack. */
  mock?: unknown | ((input: unknown) => unknown);
  /** Force a failure. `status` is HTTP-only; `code`/`message` apply to both. */
  error?: { status?: number; code?: string; message?: string };
  /** Artificial latency (ms). */
  latencyMs?: number;
  /** Discard the frame. WS-only — HTTP has no equivalent and ignores it. */
  drop?: boolean;
}

/**
 * What a connector needs from a transport client: the `instrument` seam both
 * typefetch and typesocket ship. Structural, so neither package is imported.
 */
export interface Instrumentable<TEvent, TOverride> {
  instrument(hook: {
    on?: (event: TEvent) => void;
    resolveOverride?: (id: string, input: unknown) => TOverride | undefined;
  }): () => void;
}

/** typefetch's `RequestEvent`, structurally. */
export type TypeFetchRequestEvent =
  | {
      type: "start";
      requestId: string;
      endpointId: string;
      method: string;
      url: string;
      input: unknown;
      timestamp: number;
    }
  | {
      type: "success";
      requestId: string;
      endpointId: string;
      data: unknown;
      durationMs: number;
      fromMock: boolean;
    }
  | {
      type: "error";
      requestId: string;
      endpointId: string;
      status?: number;
      error: unknown;
      durationMs: number;
    };

/** typefetch's `Override`, structurally. */
export interface TypeFetchOverride {
  mock?: unknown | ((input: unknown) => unknown);
  error?: { status?: number; code?: string; message?: string; body?: unknown };
  latencyMs?: number;
}

/** typesocket's `SocketEvent`, structurally. */
export type TypeSocketEvent =
  | { type: "connect"; ts: number; socketId?: string; attempt: number }
  | { type: "disconnect"; ts: number; reason: string }
  | { type: "connect_error"; ts: number; error: unknown }
  | {
      type: "outbound";
      frameId: string;
      eventId: string;
      event: string;
      payload: unknown;
      ts: number;
      queued: boolean;
      expectsAck: boolean;
    }
  | {
      type: "ack";
      frameId: string;
      eventId: string;
      data: unknown;
      durationMs: number;
      fromMock: boolean;
    }
  | {
      type: "inbound";
      frameId: string;
      eventId: string;
      event: string;
      payload: unknown;
      ts: number;
      injected: boolean;
    }
  | {
      type: "dropped";
      frameId: string;
      eventId: string;
      direction: "inbound" | "outbound";
      by: "middleware" | "override";
      ts: number;
    }
  | {
      type: "frame_error";
      frameId: string;
      eventId: string;
      direction: "inbound" | "outbound";
      error: unknown;
      ts: number;
    };

/** typesocket's `SocketOverride`, structurally. */
export interface TypeSocketOverride {
  drop?: boolean;
  latencyMs?: number;
  ack?: unknown | ((input: unknown) => unknown);
  error?: { code?: string; message?: string };
}

// ── query-core, structurally ─────────────────────────────────────────────────
// The query engine is a peer, not a dependency: these mirror its public shape so
// the cache inspector reads and drives a `QueryClient` without importing one.

/** query-core's `QueryState`, structurally. */
export interface QueryStateLike {
  status: "pending" | "success" | "error";
  fetchStatus: "idle" | "fetching";
  data: unknown;
  error: unknown;
  /** When `data` was last written (ms). `0` means never. */
  dataUpdatedAt: number;
  /** When `error` was last written (ms). `0` means never. */
  errorUpdatedAt: number;
  failureCount: number;
  /** Set by `invalidateQueries`; the next read is treated as stale. */
  isInvalidated: boolean;
}

/** A mutation's lifecycle, structurally. */
export type MutationStatusLike = "idle" | "pending" | "success" | "error";

/** query-core's `QueryCacheEvent`, structurally. */
export type QueryCacheEventLike =
  | { type: "added"; key: string; endpointId: string; state: QueryStateLike }
  | { type: "updated"; key: string; endpointId: string; state: QueryStateLike }
  | { type: "removed"; key: string; endpointId: string }
  | {
      type: "mutation";
      endpointId: string;
      status: MutationStatusLike;
      variables: unknown;
      data: unknown;
      error: unknown;
    };

/** One live query in the cache, reduced to what the inspector reads. */
export interface QueryCacheEntryLike {
  readonly key: string;
  readonly endpointId: string;
  readonly input: unknown;
  getState(): QueryStateLike;
}

/** Which queries an action targets. A subset of query-core's `QueryFilters`. */
export interface QueryFiltersLike {
  endpointId?: string | string[];
  input?: unknown;
}

/**
 * A `QueryClient`, reduced to the seam the cache inspector uses: subscribe to
 * the cache bus, enumerate live queries, and drive the three actions a panel
 * offers. Structural, so devtools-core never imports the query engine.
 */
export interface QueryClientLike {
  subscribe(listener: (event: QueryCacheEventLike) => void): () => void;
  readonly cache: { getAll(): QueryCacheEntryLike[] };
  invalidateQueries(filters?: QueryFiltersLike): void;
  refetchQueries(filters?: QueryFiltersLike): Promise<void>;
  removeQueries(filters?: QueryFiltersLike): void;
}

/** One row in the cache view: a live query with its current state. */
export interface QuerySnapshot {
  key: string;
  endpointId: string;
  input: unknown;
  state: QueryStateLike;
}

/** A recent mutation, kept in a small ring for the cache view's activity list. */
export interface MutationSnapshot {
  /** Synthetic id — mutations carry no cache key. */
  id: string;
  endpointId: string;
  status: MutationStatusLike;
  variables: unknown;
  data: unknown;
  error: unknown;
  ts: number;
}

/** The whole cache, as the panel sees it. Replaced wholesale on every change. */
export interface QueryInspectorSnapshot {
  queries: QuerySnapshot[];
  mutations: MutationSnapshot[];
}
