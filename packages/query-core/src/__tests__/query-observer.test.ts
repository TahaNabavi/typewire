import { QueryClient } from "../query-client";
import { deferred, makeEndpoint, waitFor } from "./helpers";

const noop = () => {};

describe("QueryObserver", () => {
  describe("snapshot identity", () => {
    it("returns the same reference while nothing changes", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" });

      expect(observer.getSnapshot()).toBe(observer.getSnapshot());
    });

    it("returns a new reference after the state changes", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" });
      const before = observer.getSnapshot();

      await client.fetchQuery(endpoint, { id: "1" });

      expect(observer.getSnapshot()).not.toBe(before);
      expect(observer.getSnapshot().data).toEqual({ id: "1" });
    });

    it("starts pending with no data", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      const snapshot = client.watchQuery(endpoint, { id: "1" }).getSnapshot();

      expect(snapshot.status).toBe("pending");
      expect(snapshot.isPending).toBe(true);
      expect(snapshot.data).toBeUndefined();
      expect(snapshot.isFetching).toBe(false);
    });
  });

  describe("mounting", () => {
    it("fetches on first subscribe when stale", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" });

      observer.subscribe(noop);

      await waitFor(() => observer.getSnapshot().isSuccess);
      expect(endpoint.calls).toHaveLength(1);
      observer.destroy();
    });

    it("does not fetch when the data is still fresh", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 10_000 });

      const observer = client.watchQuery(endpoint, { id: "1" }, { staleTime: 10_000 });
      observer.subscribe(noop);

      expect(endpoint.calls).toHaveLength(1);
      observer.destroy();
    });

    it("does not fetch when disabled", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" }, { enabled: false });

      observer.subscribe(noop);

      expect(endpoint.calls).toHaveLength(0);
      observer.destroy();
    });

    it("does not fetch when refetchOnMount is false", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(
        endpoint,
        { id: "1" },
        { refetchOnMount: false },
      );

      observer.subscribe(noop);

      expect(endpoint.calls).toHaveLength(0);
      observer.destroy();
    });

    it("notifies subscribers as state changes", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" });
      let notifications = 0;

      observer.subscribe(() => {
        notifications += 1;
      });

      await waitFor(() => observer.getSnapshot().isSuccess);
      expect(notifications).toBeGreaterThan(0);
      observer.destroy();
    });

    it("releases the query when the last subscriber leaves", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" });
      const unsubscribe = observer.subscribe(noop);
      await waitFor(() => observer.getSnapshot().isSuccess);
      const query = client.cache.find({ endpointId: "user.getUser" })[0];
      expect(query?.getObserverCount()).toBe(1);

      unsubscribe();

      expect(query?.getObserverCount()).toBe(0);
    });
  });

  describe("derived flags", () => {
    it("reports isLoading on the first fetch and isRefetching after", async () => {
      const client = new QueryClient();
      const gate = deferred<{ id: string }>();
      let call = 0;
      const endpoint = makeEndpoint("user.getUser", async () => {
        call += 1;
        return call === 1 ? gate.promise : { id: "2" };
      });
      const observer = client.watchQuery(endpoint, { id: "1" });
      observer.subscribe(noop);

      expect(observer.getSnapshot().isLoading).toBe(true);
      expect(observer.getSnapshot().isRefetching).toBe(false);

      gate.resolve({ id: "1" });
      await waitFor(() => observer.getSnapshot().isSuccess);

      const refetching = observer.refetch();
      expect(observer.getSnapshot().isRefetching).toBe(true);
      expect(observer.getSnapshot().isLoading).toBe(false);

      await refetching;
      observer.destroy();
    });

    it("exposes the error without rejecting refetch", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => {
        throw new Error("boom");
      });
      const observer = client.watchQuery(endpoint, { id: "1" });

      const result = await observer.refetch();

      expect(result.isError).toBe(true);
      expect(result.error?.message).toBe("boom");
      observer.destroy();
    });
  });

  describe("select", () => {
    it("projects the cached data", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({
        id: "1",
        name: "Taha",
      }));
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        select: (data: { id: string; name: string }) => data.name,
      });

      await client.fetchQuery(endpoint, { id: "1" });

      expect(observer.getSnapshot().data).toBe("Taha");
      observer.destroy();
    });

    it("is not recomputed while the data keeps its identity", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({
        id: "1",
        name: "Taha",
      }));
      let selectCalls = 0;
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        select: (data: { id: string; name: string }) => {
          selectCalls += 1;
          return data.name;
        },
      });
      await client.fetchQuery(endpoint, { id: "1" });
      observer.getSnapshot();
      expect(selectCalls).toBe(1);

      // Changes the state object but not the data reference.
      client.invalidateQueries({ endpointId: "user.getUser" });
      observer.getSnapshot();

      expect(selectCalls).toBe(1);
      observer.destroy();
    });
  });

  describe("placeholderData", () => {
    it("is shown while pending and flagged as a placeholder", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        placeholderData: { id: "placeholder" },
      });

      const snapshot = observer.getSnapshot();

      expect(snapshot.data).toEqual({ id: "placeholder" });
      expect(snapshot.isPlaceholderData).toBe(true);
      expect(snapshot.status).toBe("pending");
    });

    it("is never written to the cache", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      client.watchQuery(endpoint, { id: "1" }, {
        placeholderData: { id: "placeholder" },
      });

      expect(client.getQueryData(endpoint, { id: "1" })).toBeUndefined();
    });

    it("gives way to real data", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "real" }));
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        placeholderData: { id: "placeholder" },
      });
      observer.subscribe(noop);

      await waitFor(() => observer.getSnapshot().isSuccess);

      expect(observer.getSnapshot().data).toEqual({ id: "real" });
      expect(observer.getSnapshot().isPlaceholderData).toBe(false);
      observer.destroy();
    });
  });

  describe("initialData", () => {
    it("seeds the cache and counts as a real value", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        initialData: { id: "seed" },
      });

      expect(observer.getSnapshot().data).toEqual({ id: "seed" });
      expect(observer.getSnapshot().isSuccess).toBe(true);
      expect(observer.getSnapshot().isPlaceholderData).toBe(false);
      expect(client.getQueryData(endpoint, { id: "1" })).toEqual({ id: "seed" });
    });
  });

  describe("setInput", () => {
    it("rebinds without fetching until sync is called", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint(
        "user.getUser",
        async (input: { id: string }) => ({ id: input.id }),
      );
      const observer = client.watchQuery(endpoint, { id: "1" });
      observer.subscribe(noop);
      await waitFor(() => observer.getSnapshot().isSuccess);

      observer.setInput({ id: "2" });

      // Silent by contract: React adapters call this during render, where
      // starting a request would notify the store mid-render.
      expect(endpoint.calls).toEqual([{ id: "1" }]);
      expect(observer.getSnapshot().data).toBeUndefined();

      observer.sync();

      await waitFor(() => observer.getSnapshot().data?.id === "2");
      observer.destroy();
    });

    it("rebinds to the query for the new input", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint(
        "user.getUser",
        async (input: { id: string }) => ({ id: input.id }),
      );
      const observer = client.watchQuery(endpoint, { id: "1" });
      observer.subscribe(noop);
      await waitFor(() => observer.getSnapshot().isSuccess);

      observer.setInput({ id: "2" });
      observer.sync();

      await waitFor(() => observer.getSnapshot().data?.id === "2");
      expect(endpoint.calls).toEqual([{ id: "1" }, { id: "2" }]);
      observer.destroy();
    });

    it("moves the observer count across to the new query", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint(
        "user.getUser",
        async (input: { id: string }) => ({ id: input.id }),
      );
      const observer = client.watchQuery(endpoint, { id: "1" });
      observer.subscribe(noop);
      await waitFor(() => observer.getSnapshot().isSuccess);

      observer.setInput({ id: "2" });
      observer.sync();
      await waitFor(() => observer.getSnapshot().data?.id === "2");

      const first = client.cache.find({
        endpointId: "user.getUser",
        input: { id: "1" },
      })[0];
      const second = client.cache.find({
        endpointId: "user.getUser",
        input: { id: "2" },
      })[0];
      expect(first?.getObserverCount()).toBe(0);
      expect(second?.getObserverCount()).toBe(1);
      observer.destroy();
    });
  });

  describe("automatic invalidation", () => {
    it("refetches a watched query when it is invalidated", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        staleTime: 10_000,
      });
      observer.subscribe(noop);
      await waitFor(() => observer.getSnapshot().isSuccess);

      client.invalidateQueries({ endpointId: "user.getUser" });

      await waitFor(() => endpoint.calls.length === 2);
      expect(endpoint.calls).toHaveLength(2);
      observer.destroy();
    });

    it("does not drop an invalidation that lands while a fetch is in flight", async () => {
      const client = new QueryClient();
      const gate = deferred<{ id: string }>();
      let call = 0;
      const endpoint = makeEndpoint("user.getUser", async () => {
        call += 1;
        return call === 1 ? gate.promise : { id: "fresh" };
      });
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        staleTime: 10_000,
      });
      observer.subscribe(noop);
      await waitFor(() => endpoint.calls.length === 1);

      // Invalidate mid-flight, then let the already-started response land. It
      // predates the write, so it must not satisfy the invalidation.
      client.invalidateQueries({ endpointId: "user.getUser" });
      gate.resolve({ id: "in-flight" });

      await waitFor(() => observer.getSnapshot().data?.id === "fresh");
      expect(endpoint.calls).toHaveLength(2);
      observer.destroy();
    });

    it("does not refetch a disabled observer", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      await client.fetchQuery(endpoint, { id: "1" });
      const observer = client.watchQuery(endpoint, { id: "1" }, { enabled: false });
      observer.subscribe(noop);

      client.invalidateQueries({ endpointId: "user.getUser" });

      expect(endpoint.calls).toHaveLength(1);
      observer.destroy();
    });

    it("does not loop when the refetch keeps failing", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => {
        throw new Error("boom");
      });
      const observer = client.watchQuery(endpoint, { id: "1" }, {
        staleTime: 10_000,
      });
      observer.subscribe(noop);
      await waitFor(() => observer.getSnapshot().isError);
      const afterFirst = endpoint.calls.length;

      client.invalidateQueries({ endpointId: "user.getUser" });
      await waitFor(() => endpoint.calls.length > afterFirst);
      const afterInvalidate = endpoint.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 50));

      // One refetch per invalidation — the failure must not re-trigger itself.
      expect(endpoint.calls.length).toBe(afterInvalidate);
      observer.destroy();
    });
  });

  describe("sharing", () => {
    it("two observers of the same key share one request", async () => {
      const client = new QueryClient();
      const gate = deferred<{ id: string }>();
      const endpoint = makeEndpoint("user.getUser", () => gate.promise);
      const a = client.watchQuery(endpoint, { id: "1" });
      const b = client.watchQuery(endpoint, { id: "1" });

      a.subscribe(noop);
      b.subscribe(noop);
      gate.resolve({ id: "1" });

      await waitFor(() => a.getSnapshot().isSuccess && b.getSnapshot().isSuccess);
      expect(endpoint.calls).toHaveLength(1);
      expect(a.getSnapshot().data).toEqual(b.getSnapshot().data);
      a.destroy();
      b.destroy();
    });
  });
});
