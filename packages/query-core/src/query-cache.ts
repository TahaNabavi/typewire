import { buildQueryKey, hashKey, type QueryKey } from "./hash-key";
import { Query } from "./query";
import { resolveSourceId } from "./source";
import type {
  AnyQuerySource,
  QueryCacheEvent,
  QueryFilters,
  QueryOptions,
} from "./types";

/**
 * The store of live queries, keyed by `endpointId|hash(input)`.
 *
 * It owns creation, lookup and removal, and is the single publisher on the
 * event bus — invalidation, devtools and persistence all attach here rather
 * than wrapping the engine.
 */
export class QueryCache {
  private readonly queries = new Map<QueryKey, Query<any, any>>();
  private readonly listeners = new Set<(event: QueryCacheEvent) => void>();

  /** Subscribe to every cache event. Returns an unsubscribe function. */
  subscribe(listener: (event: QueryCacheEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: QueryCacheEvent): void {
    for (const listener of [...this.listeners]) listener(event);
  }

  get<TData = unknown, TError = Error>(
    key: QueryKey,
  ): Query<TData, TError> | undefined {
    return this.queries.get(key);
  }

  getAll(): Query<any, any>[] {
    return [...this.queries.values()];
  }

  /**
   * Return the query for this endpoint+input, creating it if absent. Options
   * from a later caller are merged onto the existing query, so a second
   * observer with a longer `staleTime` takes effect without a rebuild.
   */
  build<TData = unknown, TError = Error>(
    endpoint: AnyQuerySource,
    input: unknown,
    options: QueryOptions<TError> = {},
    initialData?: TData,
  ): Query<TData, TError> {
    const endpointId = resolveSourceId(endpoint);
    const key = buildQueryKey(endpointId, input);
    const existing = this.queries.get(key) as Query<TData, TError> | undefined;
    if (existing) {
      existing.setOptions(options);
      return existing;
    }

    const query = new Query<TData, TError>({
      key,
      endpointId,
      input,
      endpoint,
      options,
      initialData,
      onStateChange: (q) =>
        this.emit({
          type: "updated",
          key: q.key,
          endpointId: q.endpointId,
          state: q.getState(),
        }),
      onGarbageCollect: (q) => this.remove(q),
    });

    this.queries.set(key, query);
    this.emit({
      type: "added",
      key,
      endpointId: query.endpointId,
      state: query.getState(),
    });
    return query;
  }

  /** Remove a query and stop its timers. No-op if already gone. */
  remove(query: Query<any, any>): void {
    const existing = this.queries.get(query.key);
    // Guard against removing a *replacement* registered under the same key by
    // a late garbage-collection callback from the query it replaced.
    if (existing !== query) return;
    this.queries.delete(query.key);
    query.destroy();
    this.emit({
      type: "removed",
      key: query.key,
      endpointId: query.endpointId,
    });
  }

  /** Queries matching the filters. `{}` matches everything. */
  find(filters: QueryFilters = {}): Query<any, any>[] {
    const ids =
      filters.endpointId === undefined
        ? undefined
        : Array.isArray(filters.endpointId)
          ? filters.endpointId
          : [filters.endpointId];
    const inputHash =
      filters.input === undefined ? undefined : hashKey(filters.input);

    return this.getAll().filter((query) => {
      if (ids && !ids.includes(query.endpointId)) return false;
      if (inputHash !== undefined && hashKey(query.input) !== inputHash) {
        return false;
      }
      if (
        filters.predicate &&
        !filters.predicate({
          key: query.key,
          endpointId: query.endpointId,
          input: query.input,
          state: query.getState(),
        })
      ) {
        return false;
      }
      return true;
    });
  }

  /** Drop every query. Used on logout and between tests. */
  clear(): void {
    for (const query of this.getAll()) this.remove(query);
  }
}
