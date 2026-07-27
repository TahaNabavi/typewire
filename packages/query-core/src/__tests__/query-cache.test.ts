import { QueryCache } from "../query-cache";
import type { QueryCacheEvent } from "../types";
import { delay, makeEndpoint, waitFor } from "./helpers";

describe("QueryCache", () => {
  it("returns the same query for the same endpoint and input", () => {
    const cache = new QueryCache();
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

    const a = cache.build(endpoint, { id: "1" });
    const b = cache.build(endpoint, { id: "1" });

    expect(a).toBe(b);
  });

  it("returns the same query when input differs only in key order", () => {
    const cache = new QueryCache();
    const endpoint = makeEndpoint("user.search", async () => []);

    expect(cache.build(endpoint, { a: 1, b: 2 })).toBe(
      cache.build(endpoint, { b: 2, a: 1 }),
    );
  });

  it("returns different queries for different input", () => {
    const cache = new QueryCache();
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

    expect(cache.build(endpoint, { id: "1" })).not.toBe(
      cache.build(endpoint, { id: "2" }),
    );
  });

  it("merges options from a later caller onto the existing query", () => {
    const cache = new QueryCache();
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

    const query = cache.build(endpoint, { id: "1" }, { staleTime: 100 });
    cache.build(endpoint, { id: "1" }, { staleTime: 5000 });

    expect(query.getOptions().staleTime).toBe(5000);
  });

  it("emits added once and updated on every state change", async () => {
    const cache = new QueryCache();
    const events: QueryCacheEvent[] = [];
    cache.subscribe((event) => events.push(event));
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

    const query = cache.build(endpoint, { id: "1" });
    await query.fetch();

    expect(events.filter((e) => e.type === "added")).toHaveLength(1);
    expect(events.filter((e) => e.type === "updated").length).toBeGreaterThan(0);
  });

  it("stops emitting after unsubscribe", () => {
    const cache = new QueryCache();
    const events: QueryCacheEvent[] = [];
    const unsubscribe = cache.subscribe((event) => events.push(event));
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

    cache.build(endpoint, { id: "1" });
    unsubscribe();
    cache.build(endpoint, { id: "2" });

    expect(events).toHaveLength(1);
  });

  describe("find", () => {
    const setup = () => {
      const cache = new QueryCache();
      const getUser = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const listUsers = makeEndpoint("user.listUsers", async () => []);
      cache.build(getUser, { id: "1" });
      cache.build(getUser, { id: "2" });
      cache.build(listUsers, { page: 1 });
      return { cache, getUser, listUsers };
    };

    it("matches everything with no filters", () => {
      const { cache } = setup();
      expect(cache.find()).toHaveLength(3);
    });

    it("matches a single endpoint id", () => {
      const { cache } = setup();
      expect(cache.find({ endpointId: "user.getUser" })).toHaveLength(2);
    });

    it("matches a list of endpoint ids", () => {
      const { cache } = setup();
      expect(
        cache.find({ endpointId: ["user.getUser", "user.listUsers"] }),
      ).toHaveLength(3);
    });

    it("narrows to one input", () => {
      const { cache } = setup();
      const found = cache.find({ endpointId: "user.getUser", input: { id: "2" } });
      expect(found).toHaveLength(1);
      expect(found[0]?.input).toEqual({ id: "2" });
    });

    it("applies a predicate", () => {
      const { cache } = setup();
      const found = cache.find({
        predicate: ({ endpointId }) => endpointId.endsWith("listUsers"),
      });
      expect(found).toHaveLength(1);
    });

    it("returns nothing for an unknown endpoint id", () => {
      const { cache } = setup();
      expect(cache.find({ endpointId: "nope.missing" })).toHaveLength(0);
    });
  });

  it("removes a query and emits removed", () => {
    const cache = new QueryCache();
    const events: QueryCacheEvent[] = [];
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
    const query = cache.build(endpoint, { id: "1" });
    cache.subscribe((event) => events.push(event));

    cache.remove(query);

    expect(cache.getAll()).toHaveLength(0);
    expect(events).toEqual([
      { type: "removed", key: query.key, endpointId: "user.getUser" },
    ]);
  });

  it("ignores a removal request for a query that was already replaced", () => {
    const cache = new QueryCache();
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
    const first = cache.build(endpoint, { id: "1" });
    cache.remove(first);
    const replacement = cache.build(endpoint, { id: "1" });

    // A late garbage-collection callback from `first` must not evict the
    // replacement now sitting under the same key.
    cache.remove(first);

    expect(cache.getAll()).toEqual([replacement]);
  });

  it("clear drops every query", () => {
    const cache = new QueryCache();
    const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
    cache.build(endpoint, { id: "1" });
    cache.build(endpoint, { id: "2" });

    cache.clear();

    expect(cache.getAll()).toHaveLength(0);
  });

  describe("garbage collection", () => {
    it("removes an observer-less query after gcTime", async () => {
      const cache = new QueryCache();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      cache.build(endpoint, { id: "1" }, { gcTime: 20 });

      await waitFor(() => cache.getAll().length === 0);

      expect(cache.getAll()).toHaveLength(0);
    });

    it("keeps a query alive while an observer is attached", async () => {
      const cache = new QueryCache();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const query = cache.build(endpoint, { id: "1" }, { gcTime: 20 });
      query.addObserver();

      await delay(60);

      expect(cache.getAll()).toEqual([query]);
    });

    it("collects once the last observer leaves", async () => {
      const cache = new QueryCache();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const query = cache.build(endpoint, { id: "1" }, { gcTime: 20 });
      query.addObserver();
      await delay(40);
      query.removeObserver();

      await waitFor(() => cache.getAll().length === 0);

      expect(cache.getAll()).toHaveLength(0);
    });

    it("never collects when gcTime is Infinity", async () => {
      const cache = new QueryCache();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const query = cache.build(endpoint, { id: "1" }, { gcTime: Infinity });

      await delay(40);

      expect(cache.getAll()).toEqual([query]);
    });
  });
});
