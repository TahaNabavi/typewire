import { CancelledError } from "../errors";
import { QueryClient, createQueryClient } from "../query-client";
import type { QueryCacheEvent } from "../types";
import { deferred, delay, makeEndpoint, makeEvent, waitFor } from "./helpers";

describe("QueryClient", () => {
  describe("fetchQuery", () => {
    it("resolves and caches the result", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async (input: { id: string }) => ({
        id: input.id,
        name: "Taha",
      }));

      const data = await client.fetchQuery(endpoint, { id: "1" });

      expect(data).toEqual({ id: "1", name: "Taha" });
      expect(client.getQueryData(endpoint, { id: "1" })).toEqual(data);
    });

    it("deduplicates concurrent calls for the same key", async () => {
      const client = new QueryClient();
      const gate = deferred<{ id: string }>();
      const endpoint = makeEndpoint("user.getUser", () => gate.promise);

      const a = client.fetchQuery(endpoint, { id: "1" });
      const b = client.fetchQuery(endpoint, { id: "1" });
      gate.resolve({ id: "1" });

      expect(await a).toEqual({ id: "1" });
      expect(await b).toEqual({ id: "1" });
      expect(endpoint.calls).toHaveLength(1);
    });

    it("does not deduplicate different inputs", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async (input: { id: string }) => input);

      await Promise.all([
        client.fetchQuery(endpoint, { id: "1" }),
        client.fetchQuery(endpoint, { id: "2" }),
      ]);

      expect(endpoint.calls).toHaveLength(2);
    });

    it("serves fresh data without refetching", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 10_000 });
      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 10_000 });

      expect(endpoint.calls).toHaveLength(1);
    });

    it("refetches once the data is stale", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 10 });
      await delay(30);
      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 10 });

      expect(endpoint.calls).toHaveLength(2);
    });

    it("rejects and records the error", async () => {
      const client = new QueryClient();
      const boom = new Error("boom");
      const endpoint = makeEndpoint("user.getUser", async () => {
        throw boom;
      });

      await expect(client.fetchQuery(endpoint, { id: "1" })).rejects.toThrow("boom");

      const query = client.cache.find({ endpointId: "user.getUser" })[0];
      expect(query?.getState().status).toBe("error");
      expect(query?.getState().error).toBe(boom);
    });

    it("accepts a typesocket event by its eventId", async () => {
      const client = new QueryClient();
      const event = makeEvent("chat.sendMessage", async () => ({ id: "m1" }));

      const data = await client.fetchQuery(event, { text: "hi" });

      expect(data).toEqual({ id: "m1" });
      expect(client.cache.find({ endpointId: "chat.sendMessage" })).toHaveLength(1);
    });
  });

  describe("retry", () => {
    it("recovers when a later attempt succeeds", async () => {
      const client = new QueryClient();
      let attempts = 0;
      const endpoint = makeEndpoint("user.getUser", async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("flaky");
        return { id: "1" };
      });

      const data = await client.fetchQuery(endpoint, { id: "1" }, { retry: 2 });

      expect(data).toEqual({ id: "1" });
      expect(attempts).toBe(3);
    });

    it("gives up once the budget is exhausted", async () => {
      const client = new QueryClient();
      let attempts = 0;
      const endpoint = makeEndpoint("user.getUser", async () => {
        attempts += 1;
        throw new Error("always");
      });

      await expect(
        client.fetchQuery(endpoint, { id: "1" }, { retry: 1 }),
      ).rejects.toThrow("always");
      expect(attempts).toBe(2);
    });

    it("does not retry by default", async () => {
      const client = new QueryClient();
      let attempts = 0;
      const endpoint = makeEndpoint("user.getUser", async () => {
        attempts += 1;
        throw new Error("always");
      });

      await expect(client.fetchQuery(endpoint, { id: "1" })).rejects.toThrow();
      expect(attempts).toBe(1);
    });

    it("consults a predicate", async () => {
      const client = new QueryClient();
      let attempts = 0;
      const endpoint = makeEndpoint("user.getUser", async () => {
        attempts += 1;
        throw new Error("nope");
      });

      await expect(
        client.fetchQuery(endpoint, { id: "1" }, { retry: (count) => count < 3 }),
      ).rejects.toThrow();
      expect(attempts).toBe(3);
    });
  });

  describe("cache writes", () => {
    it("getQueryData is undefined before any fetch", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      expect(client.getQueryData(endpoint, { id: "1" })).toBeUndefined();
    });

    it("setQueryData writes a value and marks it fresh", () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({
        id: "1",
        name: "fetched",
      }));

      client.setQueryData(endpoint, { id: "1" }, { id: "1", name: "seeded" });

      expect(client.getQueryData(endpoint, { id: "1" })).toEqual({
        id: "1",
        name: "seeded",
      });
      const query = client.cache.find({ endpointId: "user.getUser" })[0];
      expect(query?.getState().status).toBe("success");
      expect(query?.isStale(10_000)).toBe(false);
    });

    it("setQueryData with an updater receives the previous value", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("counter.get", async () => ({ n: 1 }));
      await client.fetchQuery(endpoint, {});

      client.setQueryData(endpoint, {}, (previous) => ({
        n: (previous as { n: number }).n + 1,
      }));

      expect(client.getQueryData(endpoint, {})).toEqual({ n: 2 });
    });
  });

  describe("invalidation", () => {
    it("marks matching queries stale without refetching them", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 10_000 });

      client.invalidateQueries({ endpointId: "user.getUser" });

      const query = client.cache.find({ endpointId: "user.getUser" })[0];
      expect(query?.getState().isInvalidated).toBe(true);
      // No observer is attached, so nothing refetches on its own.
      expect(endpoint.calls).toHaveLength(1);
    });

    it("leaves unmatched queries alone", async () => {
      const client = new QueryClient();
      const getUser = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const listUsers = makeEndpoint("user.listUsers", async () => []);
      await client.fetchQuery(getUser, { id: "1" });
      await client.fetchQuery(listUsers, {});

      client.invalidateQueries({ endpointId: "user.getUser" });

      const other = client.cache.find({ endpointId: "user.listUsers" })[0];
      expect(other?.getState().isInvalidated).toBe(false);
    });

    it("refetchQueries forces a fetch now", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 10_000 });

      await client.refetchQueries({ endpointId: "user.getUser" });

      expect(endpoint.calls).toHaveLength(2);
    });

    it("refetchQueries resolves even when a query fails", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => {
        throw new Error("boom");
      });
      await expect(client.fetchQuery(endpoint, { id: "1" })).rejects.toThrow();

      await expect(
        client.refetchQueries({ endpointId: "user.getUser" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("removal and cancellation", () => {
    it("removeQueries drops matching entries", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      await client.fetchQuery(endpoint, { id: "1" });

      client.removeQueries({ endpointId: "user.getUser" });

      expect(client.cache.getAll()).toHaveLength(0);
    });

    it("clear drops everything", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      await client.fetchQuery(endpoint, { id: "1" });

      client.clear();

      expect(client.cache.getAll()).toHaveLength(0);
    });

    it("cancelQueries aborts in flight work and keeps prior data", async () => {
      const client = new QueryClient();
      const gate = deferred<{ id: string }>();
      let call = 0;
      const endpoint = makeEndpoint("user.getUser", async () => {
        call += 1;
        // First call resolves; the second hangs until cancelled.
        return call === 1 ? { id: "first" } : gate.promise;
      });
      await client.fetchQuery(endpoint, { id: "1" });

      const pending = client.fetchQuery(endpoint, { id: "1" });
      client.cancelQueries({ endpointId: "user.getUser" });

      await expect(pending).rejects.toBeInstanceOf(CancelledError);
      const query = client.cache.find({ endpointId: "user.getUser" })[0];
      expect(query?.getState().status).toBe("success");
      expect(query?.getState().data).toEqual({ id: "first" });
      expect(query?.getState().fetchStatus).toBe("idle");
    });
  });

  describe("prefetchQuery", () => {
    it("warms the cache", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      await client.prefetchQuery(endpoint, { id: "1" });

      expect(client.getQueryData(endpoint, { id: "1" })).toEqual({ id: "1" });
    });

    it("swallows failures", async () => {
      const client = new QueryClient();
      const endpoint = makeEndpoint("user.getUser", async () => {
        throw new Error("boom");
      });

      await expect(
        client.prefetchQuery(endpoint, { id: "1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("event bus", () => {
    it("publishes cache events to subscribers", async () => {
      const client = new QueryClient();
      const events: QueryCacheEvent[] = [];
      client.subscribe((event) => events.push(event));
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      await client.fetchQuery(endpoint, { id: "1" });

      expect(events.map((e) => e.type)).toContain("added");
      expect(events.map((e) => e.type)).toContain("updated");
    });
  });

  describe("defaultOptions", () => {
    it("applies default query options", async () => {
      const client = createQueryClient({
        defaultOptions: { queries: { staleTime: 10_000 } },
      });
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      await client.fetchQuery(endpoint, { id: "1" });
      await client.fetchQuery(endpoint, { id: "1" });

      expect(endpoint.calls).toHaveLength(1);
    });

    it("lets a per-call option win", async () => {
      const client = createQueryClient({
        defaultOptions: { queries: { staleTime: 10_000 } },
      });
      const endpoint = makeEndpoint("user.getUser", async () => ({ id: "1" }));

      await client.fetchQuery(endpoint, { id: "1" });
      await client.fetchQuery(endpoint, { id: "1" }, { staleTime: 0 });

      expect(endpoint.calls).toHaveLength(2);
    });
  });

  describe("relations", () => {
    it("invalidates declared queries after a mutation succeeds", async () => {
      const client = createQueryClient({
        relations: { "user.updateUser": ["user.getUser"] },
      });
      const getUser = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const updateUser = makeEndpoint("user.updateUser", async () => ({ ok: true }));
      await client.fetchQuery(getUser, { id: "1" }, { staleTime: 10_000 });

      await client.watchMutation(updateUser).mutateAsync({ id: "1" });

      const query = client.cache.find({ endpointId: "user.getUser" })[0];
      expect(query?.getState().isInvalidated).toBe(true);
    });

    it("supports a resolver that reads variables and data", async () => {
      const seen: unknown[] = [];
      const client = createQueryClient({
        relations: {
          "user.updateUser": (ctx) => {
            seen.push(ctx);
            return ["user.getUser"];
          },
        },
      });
      const getUser = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const updateUser = makeEndpoint("user.updateUser", async () => ({ ok: true }));
      await client.fetchQuery(getUser, { id: "1" }, { staleTime: 10_000 });

      await client.watchMutation(updateUser).mutateAsync({ id: "7" });

      expect(seen).toEqual([{ variables: { id: "7" }, data: { ok: true } }]);
      expect(
        client.cache.find({ endpointId: "user.getUser" })[0]?.getState().isInvalidated,
      ).toBe(true);
    });

    it("does not invalidate when the mutation fails", async () => {
      const client = createQueryClient({
        relations: { "user.updateUser": ["user.getUser"] },
      });
      const getUser = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const updateUser = makeEndpoint("user.updateUser", async () => {
        throw new Error("boom");
      });
      await client.fetchQuery(getUser, { id: "1" }, { staleTime: 10_000 });

      await expect(
        client.watchMutation(updateUser).mutateAsync({ id: "1" }),
      ).rejects.toThrow("boom");

      expect(
        client.cache.find({ endpointId: "user.getUser" })[0]?.getState().isInvalidated,
      ).toBe(false);
    });

    it("merges per-observer invalidates with the declared relations", async () => {
      const client = createQueryClient({
        relations: { "user.updateUser": ["user.getUser"] },
      });
      const getUser = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const listUsers = makeEndpoint("user.listUsers", async () => []);
      const updateUser = makeEndpoint("user.updateUser", async () => ({ ok: true }));
      await client.fetchQuery(getUser, { id: "1" }, { staleTime: 10_000 });
      await client.fetchQuery(listUsers, {}, { staleTime: 10_000 });

      await client
        .watchMutation(updateUser, { invalidates: ["user.listUsers"] })
        .mutateAsync({ id: "1" });

      expect(
        client.cache.find({ endpointId: "user.getUser" })[0]?.getState().isInvalidated,
      ).toBe(true);
      expect(
        client.cache.find({ endpointId: "user.listUsers" })[0]?.getState().isInvalidated,
      ).toBe(true);
    });

    it("triggers an attached observer to refetch", async () => {
      const client = createQueryClient({
        relations: { "user.updateUser": ["user.getUser"] },
      });
      const getUser = makeEndpoint("user.getUser", async () => ({ id: "1" }));
      const updateUser = makeEndpoint("user.updateUser", async () => ({ ok: true }));
      const observer = client.watchQuery(getUser, { id: "1" }, { staleTime: 10_000 });
      observer.subscribe(() => {});
      await waitFor(() => observer.getSnapshot().isSuccess);

      await client.watchMutation(updateUser).mutateAsync({ id: "1" });

      await waitFor(() => getUser.calls.length === 2);
      expect(getUser.calls).toHaveLength(2);
      observer.destroy();
    });
  });
});
