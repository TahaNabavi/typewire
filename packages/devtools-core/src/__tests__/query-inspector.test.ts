import { connectQueryClient } from "../connect-query";
import { QueryInspector } from "../query-inspector";
import type {
  QueryCacheEntryLike,
  QueryCacheEventLike,
  QueryClientLike,
  QueryFiltersLike,
  QueryStateLike,
} from "../types";

/**
 * A hand-driven `QueryClientLike`. The inspector's job is purely to follow the
 * cache bus and delegate actions, so a controllable fake exercises every branch
 * deterministically. The real-client structural check lives in the query
 * example, where `connectQueryClient(realQueryClient)` typechecks in CI.
 */
class FakeQueryClient implements QueryClientLike {
  private readonly listeners = new Set<(event: QueryCacheEventLike) => void>();
  private entries: QueryCacheEntryLike[] = [];
  readonly calls = {
    invalidate: [] as QueryFiltersLike[],
    refetch: [] as QueryFiltersLike[],
    remove: [] as QueryFiltersLike[],
  };

  readonly cache = { getAll: (): QueryCacheEntryLike[] => this.entries };

  subscribe(listener: (event: QueryCacheEventLike) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  invalidateQueries(filters: QueryFiltersLike = {}): void {
    this.calls.invalidate.push(filters);
  }

  refetchQueries(filters: QueryFiltersLike = {}): Promise<void> {
    this.calls.refetch.push(filters);
    return Promise.resolve();
  }

  removeQueries(filters: QueryFiltersLike = {}): void {
    this.calls.remove.push(filters);
  }

  // ── test helpers ───────────────────────────────────────────────────────────
  setEntries(entries: QueryCacheEntryLike[]): void {
    this.entries = entries;
  }

  emit(event: QueryCacheEventLike): void {
    for (const listener of [...this.listeners]) listener(event);
  }
}

function state(overrides: Partial<QueryStateLike> = {}): QueryStateLike {
  return {
    status: "success",
    fetchStatus: "idle",
    data: undefined,
    error: undefined,
    dataUpdatedAt: 0,
    errorUpdatedAt: 0,
    failureCount: 0,
    isInvalidated: false,
    ...overrides,
  };
}

function entry(
  endpointId: string,
  input: unknown,
  s: QueryStateLike,
): QueryCacheEntryLike {
  return {
    key: `${endpointId}|${JSON.stringify(input)}`,
    endpointId,
    input,
    getState: () => s,
  };
}

describe("QueryInspector", () => {
  it("seeds from the current cache on connect", () => {
    const client = new FakeQueryClient();
    client.setEntries([entry("user.getUser", { id: "1" }, state({ data: { name: "Taha" } }))]);

    const inspector = new QueryInspector(client);
    inspector.connect();

    const { queries } = inspector.getSnapshot();
    expect(queries).toHaveLength(1);
    expect(queries[0]).toMatchObject({
      endpointId: "user.getUser",
      input: { id: "1" },
      state: { data: { name: "Taha" }, status: "success" },
    });
  });

  it("re-reads the cache on added / updated / removed", () => {
    const client = new FakeQueryClient();
    const inspector = new QueryInspector(client);
    inspector.connect();
    expect(inspector.getSnapshot().queries).toHaveLength(0);

    client.setEntries([entry("user.getUser", { id: "1" }, state({ status: "pending" }))]);
    client.emit({ type: "added", key: "k1", endpointId: "user.getUser", state: state() });
    expect(inspector.getSnapshot().queries[0]?.state.status).toBe("pending");

    client.setEntries([entry("user.getUser", { id: "1" }, state({ isInvalidated: true }))]);
    client.emit({ type: "updated", key: "k1", endpointId: "user.getUser", state: state() });
    expect(inspector.getSnapshot().queries[0]?.state.isInvalidated).toBe(true);

    client.setEntries([]);
    client.emit({ type: "removed", key: "k1", endpointId: "user.getUser" });
    expect(inspector.getSnapshot().queries).toHaveLength(0);
  });

  it("keeps recent mutations in a ring, newest retained", () => {
    const client = new FakeQueryClient();
    const inspector = new QueryInspector(client, { mutationLimit: 2 });
    inspector.connect();

    for (const name of ["a", "b", "c"]) {
      client.emit({
        type: "mutation",
        endpointId: `user.${name}`,
        status: "success",
        variables: { name },
        data: { ok: true },
        error: undefined,
      });
    }

    const { mutations } = inspector.getSnapshot();
    expect(mutations).toHaveLength(2);
    expect(mutations.map((m) => m.endpointId)).toEqual(["user.b", "user.c"]);
    // Synthetic ids stay unique across the dropped entries.
    expect(new Set(mutations.map((m) => m.id)).size).toBe(2);
  });

  it("leaves the query list untouched when a mutation arrives", () => {
    const client = new FakeQueryClient();
    client.setEntries([entry("user.getUser", { id: "1" }, state())]);
    const inspector = new QueryInspector(client);
    inspector.connect();

    client.emit({
      type: "mutation",
      endpointId: "user.updateUser",
      status: "pending",
      variables: { name: "x" },
      data: undefined,
      error: undefined,
    });

    const snap = inspector.getSnapshot();
    expect(snap.queries).toHaveLength(1);
    expect(snap.mutations).toHaveLength(1);
  });

  it("delegates actions to the client with endpointId + input", () => {
    const client = new FakeQueryClient();
    const inspector = new QueryInspector(client);
    const target = { endpointId: "user.getUser", input: { id: "1" } };

    inspector.refetch(target);
    inspector.invalidate(target);
    inspector.remove(target);

    expect(client.calls.refetch).toEqual([{ endpointId: "user.getUser", input: { id: "1" } }]);
    expect(client.calls.invalidate).toEqual([{ endpointId: "user.getUser", input: { id: "1" } }]);
    expect(client.calls.remove).toEqual([{ endpointId: "user.getUser", input: { id: "1" } }]);
  });

  it("clears only the mutation list", () => {
    const client = new FakeQueryClient();
    client.setEntries([entry("user.getUser", { id: "1" }, state())]);
    const inspector = new QueryInspector(client);
    inspector.connect();
    client.emit({
      type: "mutation",
      endpointId: "user.updateUser",
      status: "success",
      variables: {},
      data: {},
      error: undefined,
    });

    inspector.clearMutations();

    const snap = inspector.getSnapshot();
    expect(snap.mutations).toHaveLength(0);
    expect(snap.queries).toHaveLength(1);
  });

  it("stops mirroring after dispose", () => {
    const client = new FakeQueryClient();
    const inspector = new QueryInspector(client);
    const detach = inspector.connect();

    detach();
    client.setEntries([entry("user.getUser", { id: "1" }, state())]);
    client.emit({ type: "added", key: "k1", endpointId: "user.getUser", state: state() });

    expect(inspector.getSnapshot().queries).toHaveLength(0);
  });

  it("notifies subscribers on change", () => {
    const client = new FakeQueryClient();
    const inspector = new QueryInspector(client);
    const listener = jest.fn();
    inspector.subscribe(listener);

    inspector.connect();
    expect(listener).toHaveBeenCalled();
  });

  it("connectQueryClient returns a connected inspector", () => {
    const client = new FakeQueryClient();
    client.setEntries([entry("user.getUser", { id: "1" }, state())]);

    const inspector = connectQueryClient(client);

    expect(inspector).toBeInstanceOf(QueryInspector);
    expect(inspector.getSnapshot().queries).toHaveLength(1);
  });
});
