import type { QueryKey } from "./hash-key";

/**
 * Per-call options forwarded to the transport. Structurally identical to
 * typefetch's `RequestOptions`, redeclared here so the engine has no value
 * import from any transport package.
 */
export type EndpointCallOptions = {
  signal?: AbortSignal;
  timeout?: number;
};

/** The callable half of a source: input in, promise out. */
export interface CallableContract<TInput = any, TOutput = any> {
  (input: TInput, options?: EndpointCallOptions): Promise<TOutput>;
}

/**
 * A typefetch endpoint member: callable, plus the stable `"module.endpoint"` id.
 *
 * These are *structural* types, deliberately not imports of typefetch's
 * `EndpointMethod` or typesocket's `EmitApi`. Generated members satisfy them
 * as-is, so the engine stays a peer of both transports rather than a dependent
 * of either.
 */
export interface QueryEndpoint<TInput = any, TOutput = any>
  extends CallableContract<TInput, TOutput> {
  readonly endpointId: string;
}

/**
 * A typesocket event member. Only `client->server` events that declare an `ack`
 * qualify — those return `Promise<Ack>` and are request/response shaped. A
 * fire-and-forget emit returns `void` and a `server->client` listener is push,
 * so neither is a query; they belong on the devtools timeline instead.
 */
export interface QueryEvent<TInput = any, TOutput = any>
  extends CallableContract<TInput, TOutput> {
  readonly eventId: string;
}

/**
 * Anything the engine can cache. The two transports spell the id differently
 * (`endpointId` / `eventId`) but the value means the same thing — see
 * `resolveSourceId`.
 */
export type QuerySource<TInput = any, TOutput = any> =
  | QueryEndpoint<TInput, TOutput>
  | QueryEvent<TInput, TOutput>;

/** Any source, for use in generic constraints. */
export type AnyQuerySource = QuerySource<any, any>;

/** The input type a source accepts. */
export type InferInput<E> = E extends (input: infer I, ...rest: any[]) => any
  ? I
  : never;

/** The data type a source resolves to. */
export type InferOutput<E> = E extends (...args: any[]) => Promise<infer O>
  ? O
  : never;

/**
 * Whether the query has usable data yet. Orthogonal to `FetchStatus`: a query
 * can be `success` and `fetching` at the same time (a background refetch), and
 * that distinction is the whole reason the two are separate fields.
 */
export type QueryStatus = "pending" | "success" | "error";

/** Whether a request is currently in flight for this query. */
export type FetchStatus = "idle" | "fetching";

/** The cached state of one query. Replaced wholesale on every change. */
export interface QueryState<TData = unknown, TError = Error> {
  status: QueryStatus;
  fetchStatus: FetchStatus;
  data: TData | undefined;
  error: TError | undefined;
  /** When `data` was last written (ms). `0` means never. */
  dataUpdatedAt: number;
  /** When `error` was last written (ms). `0` means never. */
  errorUpdatedAt: number;
  /** Consecutive failures for the in-flight attempt; reset on success. */
  failureCount: number;
  /** Set by `invalidateQueries`; forces the next read to be treated as stale. */
  isInvalidated: boolean;
}

/**
 * A query's state with its generics erased. The event bus and filter callbacks
 * are shared by every query in the cache, so they cannot name one query's
 * `TData`/`TError` — widening `TError` to `unknown` (rather than leaving it at
 * `Error`) is what lets a query typed with a custom error still publish here.
 */
export type AnyQueryState = QueryState<unknown, unknown>;

/** `true`/`false`, a max attempt count, or a per-failure decision. */
export type RetryValue<TError = Error> =
  | boolean
  | number
  | ((failureCount: number, error: TError) => boolean);

/** A fixed delay, or one computed from the attempt number (e.g. backoff). */
export type RetryDelayValue<TError = Error> =
  | number
  | ((failureCount: number, error: TError) => number);

/** Options that belong to the cached query itself, not to one observer. */
export interface QueryOptions<TError = Error> {
  /**
   * How long data stays fresh (ms). While fresh, mounting an observer will not
   * trigger a refetch. Default `0` — fresh only for the current tick.
   */
  staleTime?: number;
  /**
   * How long an observer-less query is kept before removal (ms). Default five
   * minutes. `Infinity` disables collection.
   */
  gcTime?: number;
  retry?: RetryValue<TError>;
  retryDelay?: RetryDelayValue<TError>;
}

/** Options for a single observer of a query. */
export interface QueryObserverOptions<
  TData = unknown,
  TError = Error,
  TSelected = TData,
> extends QueryOptions<TError> {
  /** When `false`, the observer never triggers a fetch. Default `true`. */
  enabled?: boolean;
  /** Fetch on first subscribe if the data is stale. Default `true`. */
  refetchOnMount?: boolean;
  /**
   * Derive what the UI reads from the cached data. Re-run only when `data`
   * changes identity, so an expensive projection is not recomputed per render.
   */
  select?: (data: TData) => TSelected;
  /** Seed the cache before the first fetch. Treated as real, cacheable data. */
  initialData?: TData;
  /**
   * Shown while `pending`, but never written to the cache — the query still
   * reports `status: "pending"` so the UI can tell placeholder from real.
   */
  placeholderData?: TData;
}

/** What an observer exposes to the UI: query state plus derived booleans. */
export interface QueryObserverResult<TData = unknown, TError = Error> {
  status: QueryStatus;
  fetchStatus: FetchStatus;
  data: TData | undefined;
  error: TError | undefined;
  dataUpdatedAt: number;
  errorUpdatedAt: number;
  failureCount: number;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
  /** First load: no data yet *and* a request is in flight. */
  isLoading: boolean;
  /** A refetch while data is already on screen. */
  isRefetching: boolean;
  isStale: boolean;
  /** `data` is `placeholderData`, not a cached value. */
  isPlaceholderData: boolean;
  refetch: () => Promise<QueryObserverResult<TData, TError>>;
}

/** Lifecycle of a single mutation observer. */
export type MutationStatus = "idle" | "pending" | "success" | "error";

/** The state of one mutation observer. */
export interface MutationState<TData = unknown, TError = Error, TInput = unknown> {
  status: MutationStatus;
  data: TData | undefined;
  error: TError | undefined;
  /** The input of the most recent `mutate` call. */
  variables: TInput | undefined;
  failureCount: number;
}

/** What a mutation observer exposes to the UI. */
export interface MutationObserverResult<
  TData = unknown,
  TError = Error,
  TInput = unknown,
> extends MutationState<TData, TError, TInput> {
  isIdle: boolean;
  isPending: boolean;
  isSuccess: boolean;
  isError: boolean;
  /**
   * Fire and forget. Deliberately returns `void` and never rejects: the common
   * call site is an event handler (`onClick={() => mutate(input)}`), where a
   * rejected floating promise becomes an unhandled rejection. Read the outcome
   * from `data` / `error`, or use `mutateAsync` when you need to await it.
   */
  mutate: (input: TInput) => void;
  /** Same call, but resolves with the data and rejects on failure. */
  mutateAsync: (input: TInput) => Promise<TData>;
  reset: () => void;
}

/** Options for a mutation observer. */
export interface MutationObserverOptions<
  TData = unknown,
  TError = Error,
  TInput = unknown,
> {
  retry?: RetryValue<TError>;
  retryDelay?: RetryDelayValue<TError>;
  /**
   * Returns `unknown` rather than `void | Promise<void>` on purpose. A union
   * return type defeats TypeScript's rule that a value-returning function is
   * assignable where `void` is expected, which would reject the most natural
   * way to write these: `onSettled: () => setOpen(false)`. A returned promise
   * is still awaited before `mutateAsync` resolves.
   */
  onSuccess?: (data: TData, variables: TInput) => unknown;
  onError?: (error: TError, variables: TInput) => unknown;
  onSettled?: (
    data: TData | undefined,
    error: TError | undefined,
    variables: TInput,
  ) => unknown;
  /**
   * Endpoint ids to invalidate after this mutation succeeds, on top of whatever
   * the client-level `relations` map declares.
   */
  invalidates?: string[];
}

/**
 * Selects a subset of cached queries. An omitted field matches everything, so
 * `{}` matches the whole cache.
 */
export interface QueryFilters {
  /** One id or several, e.g. `"user.getUser"`. */
  endpointId?: string | string[];
  /**
   * Restrict to one exact input. Requires `endpointId` to be a single id —
   * an input alone does not identify a query.
   */
  input?: unknown;
  predicate?: (query: {
    key: QueryKey;
    endpointId: string;
    input: unknown;
    state: AnyQueryState;
  }) => boolean;
}

/**
 * Emitted by the cache for every structural or state change. This is the event
 * bus the third design law is about: invalidation, devtools and persistence all
 * subscribe here rather than forking the engine.
 */
export type QueryCacheEvent =
  | { type: "added"; key: QueryKey; endpointId: string; state: AnyQueryState }
  | { type: "updated"; key: QueryKey; endpointId: string; state: AnyQueryState }
  | { type: "removed"; key: QueryKey; endpointId: string }
  | {
      type: "mutation";
      endpointId: string;
      status: MutationStatus;
      variables: unknown;
      data: unknown;
      error: unknown;
    };

/**
 * Which queries a successful mutation should invalidate, declared once at the
 * setup site. Either a fixed list of endpoint ids or a resolver that reads the
 * mutation's input and result.
 */
export type RelationsConfig = Record<
  string,
  | string[]
  | ((ctx: { variables: unknown; data: unknown }) => string[])
>;
