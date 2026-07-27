import {
  InspectorBridge,
  connectQueryClient,
  type QueryCacheEntryLike,
  type QueryCacheEventLike,
  type QueryClientLike,
  type QueryFiltersLike,
  type QueryStateLike,
} from "@tahanabavi/type-devtools-core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TypeDevtools } from "../panel";

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
    return () => this.listeners.delete(listener);
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

function entry(endpointId: string, input: unknown, s: QueryStateLike): QueryCacheEntryLike {
  return { key: `${endpointId}|${JSON.stringify(input)}`, endpointId, input, getState: () => s };
}

function setup() {
  const client = new FakeQueryClient();
  client.setEntries([
    entry("user.getUser", { id: "1" }, state({ data: { name: "Taha" } })),
  ]);
  const queries = connectQueryClient(client);
  render(
    <TypeDevtools bridge={new InspectorBridge()} queries={queries} defaultOpen />,
  );
  return client;
}

describe("Cache tab", () => {
  it("shows the tab and lists cached queries", () => {
    setup();
    fireEvent.click(screen.getByTestId("typewire-tab-cache"));

    const rows = screen.getByTestId("typewire-cache-rows");
    expect(rows).toHaveTextContent("user.getUser");
    expect(rows).toHaveTextContent("fresh");
  });

  it("marks an invalidated query stale", () => {
    const client = new FakeQueryClient();
    client.setEntries([
      entry("user.getUser", { id: "1" }, state({ isInvalidated: true })),
    ]);
    const queries = connectQueryClient(client);
    render(
      <TypeDevtools bridge={new InspectorBridge()} queries={queries} defaultOpen />,
    );

    fireEvent.click(screen.getByTestId("typewire-tab-cache"));
    expect(screen.getByTestId("typewire-cache-rows")).toHaveTextContent("stale");
  });

  it("drives refetch / invalidate / remove from the detail pane", () => {
    const client = setup();
    fireEvent.click(screen.getByTestId("typewire-tab-cache"));
    fireEvent.click(screen.getByText("user.getUser"));

    fireEvent.click(screen.getByTestId("typewire-query-refetch"));
    fireEvent.click(screen.getByTestId("typewire-query-invalidate"));
    fireEvent.click(screen.getByTestId("typewire-query-remove"));

    expect(client.calls.refetch).toEqual([
      { endpointId: "user.getUser", input: { id: "1" } },
    ]);
    expect(client.calls.invalidate).toEqual([
      { endpointId: "user.getUser", input: { id: "1" } },
    ]);
    expect(client.calls.remove).toEqual([
      { endpointId: "user.getUser", input: { id: "1" } },
    ]);
  });

  it("lists recent mutations", () => {
    const client = setup();
    fireEvent.click(screen.getByTestId("typewire-tab-cache"));

    act(() => {
      client.emit({
        type: "mutation",
        endpointId: "user.updateUser",
        status: "success",
        variables: { name: "x" },
        data: { ok: true },
        error: undefined,
      });
    });

    expect(screen.getByTestId("typewire-mutations")).toHaveTextContent("user.updateUser");
  });
});
