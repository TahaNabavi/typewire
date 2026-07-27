import { buildQueryKey } from "./hash-key";
import { MutationObserver } from "./mutation-observer";
import { QueryCache } from "./query-cache";
import { QueryObserver } from "./query-observer";
import { resolveSourceId } from "./source";
import type {
  AnyQuerySource,
  InferInput,
  InferOutput,
  MutationObserverOptions,
  QueryCacheEvent,
  QueryFilters,
  QueryObserverOptions,
  QueryOptions,
  RelationsConfig,
} from "./types";

export interface QueryClientOptions {
  /** Defaults merged under every per-call option object. */
  defaultOptions?: {
    queries?: QueryOptions<any>;
    mutations?: MutationObserverOptions<any, any, any>;
  };
  /**
   * Which queries each mutation invalidates, declared once here rather than at
   * every call site. This is the whole point of the stable `endpointId`: no
   * hand-written cache keys anywhere in application code.
   *
   * ```ts
   * relations: { "user.updateUser": ["user.getUser", "user.listUsers"] }
   * ```
   */
  relations?: RelationsConfig;
}

/**
 * The engine: owns the cache, hands out observers, and runs invalidation.
 *
 * Everything here is transport-agnostic — it only ever calls `source(input)`
 * and reads its id, so the same client drives typefetch HTTP endpoints and
 * typesocket acked events without knowing which is which.
 */
export class QueryClient {
  readonly cache: QueryCache;

  private readonly defaultQueryOptions: QueryOptions<any>;
  private readonly defaultMutationOptions: MutationObserverOptions<any, any, any>;
  private readonly relations: RelationsConfig;

  constructor(options: QueryClientOptions = {}) {
    this.cache = new QueryCache();
    this.defaultQueryOptions = options.defaultOptions?.queries ?? {};
    this.defaultMutationOptions = options.defaultOptions?.mutations ?? {};
    this.relations = options.relations ?? {};
  }

  /** Subscribe to the cache event bus (devtools, persistence, logging). */
  subscribe(listener: (event: QueryCacheEvent) => void): () => void {
    return this.cache.subscribe(listener);
  }

  /** Cached data for this endpoint+input, without triggering a fetch. */
  getQueryData<E extends AnyQuerySource>(
    endpoint: E,
    input: InferInput<E>,
  ): InferOutput<E> | undefined {
    const key = buildQueryKey(resolveSourceId(endpoint), input);
    return this.cache.get<InferOutput<E>>(key)?.getState().data;
  }

  /**
   * Write cached data directly — optimistic updates, or seeding from a
   * mutation's response. Creates the entry if it does not exist yet.
   */
  setQueryData<E extends AnyQuerySource>(
    endpoint: E,
    input: InferInput<E>,
    updater:
      | InferOutput<E>
      | ((previous: InferOutput<E> | undefined) => InferOutput<E>),
  ): InferOutput<E> {
    const query = this.cache.build<InferOutput<E>>(
      endpoint,
      input,
      this.defaultQueryOptions,
    );
    return query.setData(updater);
  }

  /**
   * Fetch and cache, reusing an in-flight request for the same key. Rejects if
   * the request fails, so callers can await it directly.
   */
  fetchQuery<E extends AnyQuerySource>(
    endpoint: E,
    input: InferInput<E>,
    options: QueryOptions<any> = {},
  ): Promise<InferOutput<E>> {
    const query = this.cache.build<InferOutput<E>>(endpoint, input, {
      ...this.defaultQueryOptions,
      ...options,
    });
    // Fresh data short-circuits: prefetching in a loop should not re-request.
    if (!query.isStale(options.staleTime ?? this.defaultQueryOptions.staleTime)) {
      const { data } = query.getState();
      if (data !== undefined) return Promise.resolve(data);
    }
    return query.fetch();
  }

  /** Warm the cache, ignoring failures. Never rejects. */
  async prefetchQuery<E extends AnyQuerySource>(
    endpoint: E,
    input: InferInput<E>,
    options: QueryOptions<any> = {},
  ): Promise<void> {
    try {
      await this.fetchQuery(endpoint, input, options);
    } catch {
      // Prefetching is best-effort by definition.
    }
  }

  /**
   * Mark matching queries stale. Observers that are currently being watched
   * refetch themselves; unwatched entries simply refetch on next mount.
   */
  invalidateQueries(filters: QueryFilters = {}): void {
    for (const query of this.cache.find(filters)) query.invalidate();
  }

  /** Force matching queries to refetch now. Resolves when all have settled. */
  async refetchQueries(filters: QueryFilters = {}): Promise<void> {
    await Promise.allSettled(
      this.cache.find(filters).map((query) => query.fetch()),
    );
  }

  /** Abort in-flight requests for matching queries, keeping their data. */
  cancelQueries(filters: QueryFilters = {}): void {
    for (const query of this.cache.find(filters)) query.cancel();
  }

  /** Drop matching queries from the cache entirely. */
  removeQueries(filters: QueryFilters = {}): void {
    for (const query of this.cache.find(filters)) this.cache.remove(query);
  }

  /** Drop everything. The usual logout hook. */
  clear(): void {
    this.cache.clear();
  }

  /** An observer for one endpoint+input. The React adapter wraps this. */
  watchQuery<E extends AnyQuerySource, TSelected = InferOutput<E>>(
    endpoint: E,
    input: InferInput<E>,
    options: QueryObserverOptions<InferOutput<E>, any, TSelected> = {},
  ): QueryObserver<InferOutput<E>, any, TSelected> {
    return new QueryObserver<InferOutput<E>, any, TSelected>(
      this.cache,
      endpoint,
      input,
      { ...this.defaultQueryOptions, ...options },
    );
  }

  /** An observer for one write endpoint, wired to declared invalidation. */
  watchMutation<E extends AnyQuerySource>(
    endpoint: E,
    options: MutationObserverOptions<InferOutput<E>, any, InferInput<E>> = {},
  ): MutationObserver<InferInput<E>, InferOutput<E>, any> {
    return new MutationObserver<InferInput<E>, InferOutput<E>, any>(
      endpoint,
      { ...this.defaultMutationOptions, ...options },
      {
        onSuccess: (endpointId, variables, data, extraInvalidates) => {
          this.runRelations(endpointId, variables, data, extraInvalidates);
        },
        emit: (status, ctx) =>
          this.cache.emit({
            type: "mutation",
            endpointId: ctx.endpointId,
            status,
            variables: ctx.variables,
            data: ctx.data,
            error: ctx.error,
          }),
      },
    );
  }

  /** Resolve the declared relations for a mutation and invalidate them. */
  private runRelations(
    endpointId: string,
    variables: unknown,
    data: unknown,
    extraInvalidates: string[] | undefined,
  ): void {
    const declared = this.relations[endpointId];
    const fromRelations =
      typeof declared === "function"
        ? declared({ variables, data })
        : (declared ?? []);
    const ids = [...fromRelations, ...(extraInvalidates ?? [])];
    if (ids.length === 0) return;
    this.invalidateQueries({ endpointId: ids });
  }
}

/** Convenience factory, for callers who prefer not to write `new`. */
export function createQueryClient(options: QueryClientOptions = {}): QueryClient {
  return new QueryClient(options);
}
