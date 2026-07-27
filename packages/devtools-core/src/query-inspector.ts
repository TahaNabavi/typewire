import type {
  Observable,
  QueryClientLike,
  QueryInspectorSnapshot,
  QuerySnapshot,
} from "./types";

/** Enough recent mutations to see a flow without unbounded growth. */
const DEFAULT_MUTATION_LIMIT = 50;

export interface QueryInspectorOptions {
  /** Maximum retained mutations; the oldest drop first. Default 50. */
  mutationLimit?: number;
}

/**
 * A live mirror of a `QueryClient`'s cache, shaped for the panel.
 *
 * The timeline (`InspectorBridge`) is an append-only log of frames; the cache is
 * a *set of stateful entities* that change in place, so it gets its own store
 * rather than a second event stream. The engine already publishes every change
 * on its bus — this subscribes, re-reads the authoritative query list, and
 * exposes the three actions a cache view offers (refetch, invalidate, remove).
 *
 * The client is typed structurally (`QueryClientLike`), so devtools-core imports
 * neither `typefetch-query-core` nor any transport.
 */
export class QueryInspector implements Observable<QueryInspectorSnapshot> {
  private readonly client: QueryClientLike;
  private readonly mutationLimit: number;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private mutationSeq = 0;

  /**
   * Replaced, never mutated in place: `getSnapshot` feeds
   * `useSyncExternalStore`, which compares by identity.
   */
  private snapshot: QueryInspectorSnapshot = { queries: [], mutations: [] };

  constructor(client: QueryClientLike, options: QueryInspectorOptions = {}) {
    this.client = client;
    this.mutationLimit = options.mutationLimit ?? DEFAULT_MUTATION_LIMIT;
  }

  getSnapshot(): QueryInspectorSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Start mirroring the cache: seed from the current queries, then follow the
   * bus. Returns a detach function; idempotent if already connected.
   */
  connect(): () => void {
    if (!this.unsubscribe) {
      this.unsubscribe = this.client.subscribe((event) => {
        if (event.type === "mutation") {
          this.recordMutation(event);
        } else {
          // added / updated / removed all change the query set — re-read the
          // authoritative list rather than patch, so a missed field can't drift.
          this.syncQueries();
        }
      });
    }
    this.syncQueries();
    return () => this.dispose();
  }

  /** Stop following the bus. The last snapshot stays readable. */
  dispose(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /** Refetch this query now. Fire-and-forget: the bus reports the result. */
  refetch(query: Pick<QuerySnapshot, "endpointId" | "input">): void {
    void this.client.refetchQueries({
      endpointId: query.endpointId,
      input: query.input,
    });
  }

  /** Mark this query stale; watched observers refetch themselves. */
  invalidate(query: Pick<QuerySnapshot, "endpointId" | "input">): void {
    this.client.invalidateQueries({
      endpointId: query.endpointId,
      input: query.input,
    });
  }

  /** Drop this query from the cache entirely. */
  remove(query: Pick<QuerySnapshot, "endpointId" | "input">): void {
    this.client.removeQueries({
      endpointId: query.endpointId,
      input: query.input,
    });
  }

  /** Clear the recent-mutations list without touching the cache. */
  clearMutations(): void {
    if (this.snapshot.mutations.length === 0) return;
    this.snapshot = { queries: this.snapshot.queries, mutations: [] };
    this.notify();
  }

  private syncQueries(): void {
    const queries = this.client.cache.getAll().map((query) => ({
      key: query.key,
      endpointId: query.endpointId,
      input: query.input,
      state: query.getState(),
    }));
    this.snapshot = { queries, mutations: this.snapshot.mutations };
    this.notify();
  }

  private recordMutation(event: {
    endpointId: string;
    status: QueryInspectorSnapshot["mutations"][number]["status"];
    variables: unknown;
    data: unknown;
    error: unknown;
  }): void {
    const mutation = {
      id: `mutation-${(this.mutationSeq += 1)}`,
      endpointId: event.endpointId,
      status: event.status,
      variables: event.variables,
      data: event.data,
      error: event.error,
      ts: Date.now(),
    };
    const mutations = [...this.snapshot.mutations, mutation];
    this.snapshot = {
      queries: this.snapshot.queries,
      // Keep the newest `mutationLimit`, dropping the oldest.
      mutations:
        mutations.length > this.mutationLimit
          ? mutations.slice(mutations.length - this.mutationLimit)
          : mutations,
    };
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}
