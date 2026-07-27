import { Notifier, type Observable } from "./observable";
import type { Query } from "./query";
import type { QueryCache } from "./query-cache";
import type {
  AnyQuerySource,
  QueryObserverOptions,
  QueryObserverResult,
  QueryState,
} from "./types";

/**
 * One subscriber's view of a query.
 *
 * The daily call site (`useQuery(endpoint, input)`) is exactly this object
 * bound to a framework: `getSnapshot` feeds React's `useSyncExternalStore`,
 * Vue's `shallowRef`, or an Angular signal. Everything framework-specific lives
 * in the adapter; this class never imports one.
 */
export class QueryObserver<TData = unknown, TError = Error, TSelected = TData>
  implements Observable<QueryObserverResult<TSelected, TError>>
{
  private readonly cache: QueryCache;
  private readonly notifier = new Notifier();
  private readonly refetchFn = () => this.refetch();

  private endpoint: AnyQuerySource;
  private input: unknown;
  private options: QueryObserverOptions<TData, TError, TSelected>;

  private query: Query<TData, TError>;
  private unsubscribeQuery: (() => void) | null = null;
  private attached = false;

  /** The state object the current result was derived from, compared by identity. */
  private lastState: QueryState<TData, TError> | null = null;
  private currentResult!: QueryObserverResult<TSelected, TError>;
  /** Memoizes `select` so an expensive projection is not redone per render. */
  private selectCache: { source: TData; output: TSelected } | null = null;

  constructor(
    cache: QueryCache,
    endpoint: AnyQuerySource,
    input: unknown,
    options: QueryObserverOptions<TData, TError, TSelected> = {},
  ) {
    this.cache = cache;
    this.endpoint = endpoint;
    this.input = input;
    this.options = options;
    this.query = this.resolveQuery();
    this.updateResult();
  }

  /**
   * The current view. Must return an identical reference when nothing has
   * changed — `useSyncExternalStore` compares snapshots by identity and would
   * otherwise re-render forever.
   */
  getSnapshot(): QueryObserverResult<TSelected, TError> {
    this.updateResult();
    return this.currentResult;
  }

  subscribe(listener: () => void): () => void {
    const unsubscribe = this.notifier.subscribe(listener);
    if (!this.attached) this.attach();
    return () => {
      unsubscribe();
      if (this.notifier.size === 0) this.detach();
    };
  }

  /** Swap the input (e.g. a changed route param) and rebind to its query. */
  setInput(input: unknown): void {
    this.update(input, this.options);
  }

  setOptions(options: QueryObserverOptions<TData, TError, TSelected>): void {
    this.update(this.input, options);
  }

  /**
   * Point the observer at a new input and/or options.
   *
   * Deliberately silent: it rebinds and refreshes the snapshot but never
   * notifies and never starts a request. React adapters call this *during
   * render* so the snapshot already reflects the new input (no frame showing
   * the old input's data), and starting a fetch there would notify React's
   * store mid-render — the "cannot update a component while rendering" case.
   * Call {@link sync} from a commit-phase effect to actually fetch.
   */
  update(
    input: unknown,
    options: QueryObserverOptions<TData, TError, TSelected>,
  ): void {
    this.input = input;
    this.options = options;
    this.rebind();
  }

  /**
   * Run the mount/rebind fetch decision. Safe to call repeatedly — it is a
   * no-op when the data is fresh or a request is already in flight.
   */
  sync(): void {
    if (!this.attached) return;
    this.fetchIfNeeded();
  }

  /**
   * Force a fetch regardless of staleness. Resolves with the resulting view
   * rather than rejecting — a failed refetch is reported as `isError` on the
   * result, which is what a UI binding wants.
   */
  async refetch(): Promise<QueryObserverResult<TSelected, TError>> {
    try {
      await this.query.fetch();
    } catch {
      // Surfaced through `result.error`.
    }
    this.updateResult();
    return this.currentResult;
  }

  /** Release the underlying query. Idempotent. */
  destroy(): void {
    this.detach();
  }

  private resolveQuery(): Query<TData, TError> {
    return this.cache.build<TData, TError>(
      this.endpoint,
      this.input,
      {
        staleTime: this.options.staleTime,
        gcTime: this.options.gcTime,
        retry: this.options.retry,
        retryDelay: this.options.retryDelay,
      },
      this.options.initialData,
    );
  }

  /** Point at the query the current endpoint+input resolves to. */
  private rebind(): void {
    const next = this.resolveQuery();
    if (next === this.query) {
      // Same query. `updateResult` short-circuits on an unchanged state object,
      // so the snapshot keeps its identity and a caller in render does not
      // spin.
      this.updateResult();
      return;
    }

    const wasAttached = this.attached;
    if (wasAttached) this.detach();
    this.query = next;
    this.lastState = null;
    this.selectCache = null;
    if (wasAttached) this.listen();
    this.updateResult();
  }

  /** Subscribe to the query and fetch if needed. The mount path. */
  private attach(): void {
    if (this.attached) return;
    this.listen();
    this.fetchIfNeeded();
  }

  /** Subscribe only, without deciding whether to fetch. */
  private listen(): void {
    if (this.attached) return;
    this.attached = true;
    this.query.addObserver();
    this.unsubscribeQuery = this.query.subscribe(() => this.onQueryUpdate());
  }

  private detach(): void {
    if (!this.attached) return;
    this.attached = false;
    this.unsubscribeQuery?.();
    this.unsubscribeQuery = null;
    this.query.removeObserver();
  }

  /** Fetch on mount when the data is stale, and after an invalidation. */
  private fetchIfNeeded(): void {
    if (this.options.enabled === false) return;
    if (this.options.refetchOnMount === false) return;
    if (this.query.getState().fetchStatus === "fetching") return;
    if (!this.query.isStale(this.options.staleTime)) return;
    void this.query.fetch().catch(() => {
      // Surfaced through `result.error`.
    });
  }

  private onQueryUpdate(): void {
    const state = this.query.getState();
    this.updateResult();
    this.notifier.notify();
    // An `invalidateQueries` call marks the query; observers that are actually
    // being watched turn that mark into a refetch. This is what makes
    // invalidation automatic — no call site ever names a key.
    if (
      state.isInvalidated &&
      state.fetchStatus === "idle" &&
      this.options.enabled !== false &&
      this.notifier.size > 0
    ) {
      void this.query.fetch().catch(() => {
        // Surfaced through `result.error`.
      });
    }
  }

  private select(data: TData): TSelected {
    const { select } = this.options;
    if (!select) return data as unknown as TSelected;
    if (this.selectCache && this.selectCache.source === data) {
      return this.selectCache.output;
    }
    const output = select(data);
    this.selectCache = { source: data, output };
    return output;
  }

  private updateResult(): void {
    const state = this.query.getState();
    if (state === this.lastState && this.currentResult) return;
    this.lastState = state;

    const usePlaceholder =
      state.status === "pending" &&
      state.data === undefined &&
      this.options.placeholderData !== undefined;

    const source = usePlaceholder
      ? (this.options.placeholderData as TData)
      : state.data;
    const data = source === undefined ? undefined : this.select(source);

    const isFetching = state.fetchStatus === "fetching";
    const hasData = state.data !== undefined;

    this.currentResult = {
      status: state.status,
      fetchStatus: state.fetchStatus,
      data,
      error: state.error,
      dataUpdatedAt: state.dataUpdatedAt,
      errorUpdatedAt: state.errorUpdatedAt,
      failureCount: state.failureCount,
      isPending: state.status === "pending",
      isSuccess: state.status === "success",
      isError: state.status === "error",
      isFetching,
      isLoading: isFetching && !hasData,
      isRefetching: isFetching && hasData,
      isStale: this.query.isStale(this.options.staleTime),
      isPlaceholderData: usePlaceholder,
      refetch: this.refetchFn,
    };
  }
}
