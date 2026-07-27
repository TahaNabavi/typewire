/**
 * @tahanabavi/type-devtools-core
 * ==============================
 * Transport-agnostic inspector bridge.
 *
 * Knows nothing about HTTP or WS: it stores generic `InspectorEvent`s and an
 * override registry, and each transport plugs in as a connector. Both
 * connectors type their client structurally, so this package imports neither
 * typefetch nor typesocket and has no dependencies at all.
 *
 * See ../../docs/ARCHITECTURE.md.
 */

export { InspectorBridge } from "./bridge";
export type { InspectorBridgeOptions } from "./bridge";

export { selectEntries } from "./entries";

export { connectTypeFetch } from "./connect-typefetch";
export type { TypeFetchLike } from "./connect-typefetch";

export { connectTypeSocket } from "./connect-typesocket";
export type { TypeSocketLike } from "./connect-typesocket";

export { QueryInspector } from "./query-inspector";
export type { QueryInspectorOptions } from "./query-inspector";

export { connectQueryClient } from "./connect-query";

export type {
  InspectorEntry,
  InspectorEvent,
  InspectorOverride,
  InspectorSource,
  Instrumentable,
  MutationSnapshot,
  MutationStatusLike,
  Observable,
  QueryCacheEntryLike,
  QueryCacheEventLike,
  QueryClientLike,
  QueryFiltersLike,
  QueryInspectorSnapshot,
  QuerySnapshot,
  QueryStateLike,
  TypeFetchOverride,
  TypeFetchRequestEvent,
  TypeSocketEvent,
  TypeSocketOverride,
} from "./types";
