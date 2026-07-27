import { CancelledError, isCancelledError } from "./errors";
import type { QueryKey } from "./hash-key";
import { Notifier } from "./observable";
import { rejectOnAbort, resolveRetryDelay, shouldRetry, sleep } from "./retry";
import type {
  AnyQuerySource,
  QueryOptions,
  QueryState,
} from "./types";

/** Five minutes — long enough to survive a route change, short enough to free. */
const DEFAULT_GC_TIME = 5 * 60 * 1000;

export interface QueryConfig<TData, TError> {
  key: QueryKey;
  endpointId: string;
  input: unknown;
  endpoint: AnyQuerySource;
  options: QueryOptions<TError>;
  initialData?: TData;
  /** Called after every state replacement, so the cache can emit an event. */
  onStateChange: (query: Query<TData, TError>) => void;
  /** Called when the query has had no observers for `gcTime`. */
  onGarbageCollect: (query: Query<TData, TError>) => void;
}

/**
 * One cached endpoint+input pair: its state, its in-flight request, and its
 * retry and garbage-collection timers.
 *
 * State is replaced wholesale rather than mutated. Observers hand their
 * snapshot straight to `useSyncExternalStore`, which compares by identity — an
 * in-place mutation would be invisible to React and the UI would not update.
 */
export class Query<TData = unknown, TError = Error> {
  readonly key: QueryKey;
  readonly endpointId: string;
  readonly input: unknown;

  private readonly endpoint: AnyQuerySource;
  private readonly config: QueryConfig<TData, TError>;
  private readonly notifier = new Notifier();

  private state: QueryState<TData, TError>;
  private options: QueryOptions<TError>;

  /** The in-flight request, shared by every concurrent caller (dedup). */
  private promise: Promise<TData> | null = null;
  private controller: AbortController | null = null;
  private gcTimer: ReturnType<typeof setTimeout> | null = null;
  private observerCount = 0;
  /**
   * Set when `invalidate()` lands while a request is already in flight. That
   * response was started *before* the write that invalidated it, so it must not
   * be allowed to clear the flag on arrival.
   */
  private invalidatedDuringFetch = false;

  constructor(config: QueryConfig<TData, TError>) {
    this.config = config;
    this.key = config.key;
    this.endpointId = config.endpointId;
    this.input = config.input;
    this.endpoint = config.endpoint;
    this.options = config.options;

    const hasInitial = config.initialData !== undefined;
    this.state = {
      status: hasInitial ? "success" : "pending",
      fetchStatus: "idle",
      data: config.initialData,
      error: undefined,
      dataUpdatedAt: hasInitial ? Date.now() : 0,
      errorUpdatedAt: 0,
      failureCount: 0,
      isInvalidated: false,
    };

    // A query built by `prefetch`/`setQueryData` may never gain an observer.
    // Schedule collection immediately so it cannot leak.
    this.scheduleGarbageCollection();
  }

  getState(): QueryState<TData, TError> {
    return this.state;
  }

  getOptions(): QueryOptions<TError> {
    return this.options;
  }

  /**
   * Merge in options from a newly-mounted observer. Later observers can only
   * *shorten* gcTime's effect by being present; the values themselves are
   * last-writer-wins, which keeps the merge predictable.
   */
  setOptions(options: QueryOptions<TError>): void {
    this.options = { ...this.options, ...options };
  }

  subscribe(listener: () => void): () => void {
    return this.notifier.subscribe(listener);
  }

  /** Register an observer, keeping the query alive. */
  addObserver(): void {
    this.observerCount += 1;
    if (this.gcTimer) {
      clearTimeout(this.gcTimer);
      this.gcTimer = null;
    }
  }

  /** Drop an observer; the last one leaving starts the collection clock. */
  removeObserver(): void {
    this.observerCount = Math.max(0, this.observerCount - 1);
    if (this.observerCount === 0) this.scheduleGarbageCollection();
  }

  getObserverCount(): number {
    return this.observerCount;
  }

  /**
   * Whether a read should trigger a refetch. Explicit invalidation always wins,
   * and a query that has never resolved is stale by definition.
   */
  isStale(staleTime = this.options.staleTime ?? 0): boolean {
    if (this.state.isInvalidated) return true;
    if (this.state.dataUpdatedAt === 0) return true;
    return Date.now() - this.state.dataUpdatedAt >= staleTime;
  }

  /**
   * Fetch, deduplicated: concurrent callers share one request and one promise.
   * The returned promise rejects on failure, so `fetchQuery` callers can await
   * it directly; observers read the resulting state instead.
   */
  fetch(): Promise<TData> {
    if (this.promise) return this.promise;

    this.controller = new AbortController();
    const signal = this.controller.signal;
    this.invalidatedDuringFetch = false;

    // Clear `isInvalidated` at the *start*, not on success. Observers refetch
    // when they see the flag, so leaving it set through a failed attempt would
    // make every failure re-trigger itself in a loop.
    this.setState({
      fetchStatus: "fetching",
      failureCount: 0,
      isInvalidated: false,
    });

    // Release the in-flight slot *before* publishing state, not in a trailing
    // `finally`. `setState` notifies observers synchronously, and an observer
    // reacting to an invalidated result calls `fetch()` again — with the slot
    // still occupied it would be handed the promise that just resolved and no
    // second request would ever go out.
    const settle = () => {
      this.promise = null;
      this.controller = null;
    };

    this.promise = this.run(signal)
      .then((data) => {
        settle();
        this.setState({
          status: "success",
          fetchStatus: "idle",
          data,
          error: undefined,
          dataUpdatedAt: Date.now(),
          failureCount: 0,
          // Carries a mid-flight invalidation through, so the observer sees a
          // stale query on arrival and refetches instead of trusting stale data.
          isInvalidated: this.invalidatedDuringFetch,
        });
        return data;
      })
      .catch((error: unknown) => {
        settle();
        if (isCancelledError(error)) {
          // Not a failure: keep whatever data and status we already had.
          this.setState({ fetchStatus: "idle" });
        } else {
          this.setState({
            status: "error",
            fetchStatus: "idle",
            error: error as TError,
            errorUpdatedAt: Date.now(),
          });
        }
        throw error;
      });

    return this.promise;
  }

  /** The attempt loop. Retries are driven here so each one updates state. */
  private async run(signal: AbortSignal): Promise<TData> {
    let failureCount = 0;
    for (;;) {
      if (signal.aborted) throw new CancelledError();
      const abort = rejectOnAbort(signal);
      try {
        return (await Promise.race([
          this.endpoint(this.input, { signal }),
          abort.promise,
        ])) as TData;
      } catch (error) {
        if (isCancelledError(error)) throw error;
        failureCount += 1;
        this.setState({ failureCount });
        if (!shouldRetry(this.options.retry, failureCount, error as TError)) {
          throw error;
        }
        const delay = resolveRetryDelay(
          this.options.retryDelay,
          failureCount,
          error as TError,
        );
        // Rejects with CancelledError if the query is cancelled mid-backoff.
        await sleep(delay, signal);
      } finally {
        abort.dispose();
      }
    }
  }

  /** Abort the in-flight request, if any. Leaves cached data untouched. */
  cancel(): void {
    this.controller?.abort();
  }

  /** Mark stale without fetching. Observers decide whether to refetch. */
  invalidate(): void {
    if (this.state.fetchStatus === "fetching") this.invalidatedDuringFetch = true;
    if (this.state.isInvalidated) return;
    this.setState({ isInvalidated: true });
  }

  /**
   * Write data directly (optimistic updates, or a mutation seeding its result).
   * Counts as a fresh resolve, so the staleness clock restarts.
   */
  setData(updater: TData | ((previous: TData | undefined) => TData)): TData {
    const next =
      typeof updater === "function"
        ? (updater as (previous: TData | undefined) => TData)(this.state.data)
        : updater;
    this.setState({
      status: "success",
      data: next,
      error: undefined,
      dataUpdatedAt: Date.now(),
      isInvalidated: false,
    });
    return next;
  }

  /** Stop all timers and in-flight work. Called by the cache on removal. */
  destroy(): void {
    if (this.gcTimer) {
      clearTimeout(this.gcTimer);
      this.gcTimer = null;
    }
    this.cancel();
  }

  private setState(patch: Partial<QueryState<TData, TError>>): void {
    this.state = { ...this.state, ...patch };
    this.notifier.notify();
    this.config.onStateChange(this);
  }

  private scheduleGarbageCollection(): void {
    const gcTime = this.options.gcTime ?? DEFAULT_GC_TIME;
    if (this.gcTimer) clearTimeout(this.gcTimer);
    this.gcTimer = null;
    if (gcTime === Infinity) return;

    this.gcTimer = setTimeout(() => {
      this.gcTimer = null;
      if (this.observerCount === 0) this.config.onGarbageCollect(this);
    }, gcTime);

    // Never hold the Node event loop open just to expire a cache entry.
    const timer = this.gcTimer as unknown as { unref?: () => void };
    if (typeof timer?.unref === "function") timer.unref();
  }
}
