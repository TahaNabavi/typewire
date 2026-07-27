/**
 * @tahanabavi/typefetch-react
 * ===========================
 * React adapter over @tahanabavi/typefetch-query-core.
 *
 * Deliberately thin: the engine already exposes `getSnapshot`/`subscribe`, so
 * every hook here is that contract handed to `useSyncExternalStore`. All the
 * caching, staleness and invalidation logic lives in the core, which is why the
 * same engine can back a Vue or Angular adapter without changing.
 */

export { TypeFetchProvider, useQueryClient } from "./context";
export type { TypeFetchProviderProps } from "./context";

export { useQuery } from "./use-query";
export { useMutation } from "./use-mutation";

// Re-exported so an app can build a client without a second direct dependency.
export {
  QueryClient,
  createQueryClient,
  hashKey,
  buildQueryKey,
  CancelledError,
  isCancelledError,
} from "@tahanabavi/typefetch-query-core";

export type {
  AnyQuerySource,
  InferInput,
  InferOutput,
  MutationObserverOptions,
  MutationObserverResult,
  Observable,
  QueryCacheEvent,
  QueryClientOptions,
  QueryEndpoint,
  QueryEvent,
  QueryFilters,
  QueryKey,
  QueryObserverOptions,
  QueryObserverResult,
  QueryOptions,
  QuerySource,
  QueryState,
  RelationsConfig,
} from "@tahanabavi/typefetch-query-core";
