/**
 * @tahanabavi/typefetch-query-core
 * ================================
 * Framework-agnostic query engine for TypeWire contracts.
 *
 * Cache, dedup, staleness, mutations and declared invalidation, all behind the
 * `Observable` contract so framework adapters bind it natively. The engine
 * never imports a framework, and never imports a transport — it needs only a
 * callable endpoint carrying a stable `endpointId`.
 *
 * See ../../docs/ARCHITECTURE.md.
 */

export { hashKey, buildQueryKey } from "./hash-key";
export type { QueryKey } from "./hash-key";

export { Notifier } from "./observable";
export type { Observable } from "./observable";

export { CancelledError, isCancelledError } from "./errors";
export { resolveSourceId } from "./source";

export { Query } from "./query";
export type { QueryConfig } from "./query";

export { QueryCache } from "./query-cache";
export { QueryObserver } from "./query-observer";
export { MutationObserver } from "./mutation-observer";
export type { MutationHooks } from "./mutation-observer";

export { QueryClient, createQueryClient } from "./query-client";
export type { QueryClientOptions } from "./query-client";

export type {
  AnyQuerySource,
  AnyQueryState,
  CallableContract,
  EndpointCallOptions,
  FetchStatus,
  InferInput,
  InferOutput,
  MutationObserverOptions,
  MutationObserverResult,
  MutationState,
  MutationStatus,
  QueryCacheEvent,
  QueryEndpoint,
  QueryEvent,
  QuerySource,
  QueryFilters,
  QueryObserverOptions,
  QueryObserverResult,
  QueryOptions,
  QueryState,
  QueryStatus,
  RelationsConfig,
  RetryDelayValue,
  RetryValue,
} from "./types";
