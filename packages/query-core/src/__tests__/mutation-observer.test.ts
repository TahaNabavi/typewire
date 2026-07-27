import { QueryClient } from "../query-client";
import type { QueryCacheEvent } from "../types";
import { deferred, makeEndpoint, makeEvent, waitFor } from "./helpers";

const noop = () => {};

describe("MutationObserver", () => {
  it("starts idle", () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));

    const snapshot = client.watchMutation(endpoint).getSnapshot();

    expect(snapshot.status).toBe("idle");
    expect(snapshot.isIdle).toBe(true);
    expect(snapshot.data).toBeUndefined();
    expect(snapshot.variables).toBeUndefined();
  });

  it("moves through pending to success", async () => {
    const client = new QueryClient();
    const gate = deferred<{ ok: boolean }>();
    const endpoint = makeEndpoint("user.updateUser", () => gate.promise);
    const observer = client.watchMutation(endpoint);
    observer.subscribe(noop);

    const pending = observer.mutateAsync({ id: "1" });
    expect(observer.getSnapshot().isPending).toBe(true);
    expect(observer.getSnapshot().variables).toEqual({ id: "1" });

    gate.resolve({ ok: true });
    await pending;

    expect(observer.getSnapshot().isSuccess).toBe(true);
    expect(observer.getSnapshot().data).toEqual({ ok: true });
  });

  it("records the error and rejects from mutateAsync", async () => {
    const client = new QueryClient();
    const boom = new Error("boom");
    const endpoint = makeEndpoint("user.updateUser", async () => {
      throw boom;
    });
    const observer = client.watchMutation(endpoint);

    await expect(observer.mutateAsync({ id: "1" })).rejects.toBe(boom);

    expect(observer.getSnapshot().isError).toBe(true);
    expect(observer.getSnapshot().error).toBe(boom);
  });

  it("mutate does not reject but still records the failure", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.updateUser", async () => {
      throw new Error("boom");
    });
    const observer = client.watchMutation(endpoint);

    // Returns void; an unhandled rejection here would fail the test run.
    expect(observer.getSnapshot().mutate({ id: "1" })).toBeUndefined();

    await waitFor(() => observer.getSnapshot().isError);
    expect(observer.getSnapshot().error?.message).toBe("boom");
  });

  it("notifies subscribers", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));
    const observer = client.watchMutation(endpoint);
    let notifications = 0;
    observer.subscribe(() => {
      notifications += 1;
    });

    await observer.mutateAsync({ id: "1" });

    expect(notifications).toBeGreaterThanOrEqual(2);
  });

  describe("callbacks", () => {
    it("runs onSuccess then onSettled", async () => {
      const client = new QueryClient();
      const order: string[] = [];
      const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));
      const observer = client.watchMutation(endpoint, {
        onSuccess: (data, variables) => {
          order.push(`success:${JSON.stringify(data)}:${JSON.stringify(variables)}`);
        },
        onSettled: () => order.push("settled"),
        onError: () => order.push("error"),
      });

      await observer.mutateAsync({ id: "1" });

      expect(order).toEqual([`success:{"ok":true}:{"id":"1"}`, "settled"]);
    });

    it("runs onError then onSettled", async () => {
      const client = new QueryClient();
      const order: string[] = [];
      const endpoint = makeEndpoint("user.updateUser", async () => {
        throw new Error("boom");
      });
      const observer = client.watchMutation(endpoint, {
        onSuccess: () => order.push("success"),
        onError: (error) => order.push(`error:${error.message}`),
        onSettled: (_data, error) => order.push(`settled:${error?.message}`),
      });

      await expect(observer.mutateAsync({ id: "1" })).rejects.toThrow("boom");

      expect(order).toEqual(["error:boom", "settled:boom"]);
    });

    it("awaits an async onSuccess before resolving", async () => {
      const client = new QueryClient();
      const gate = deferred<void>();
      let finished = false;
      const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));
      const observer = client.watchMutation(endpoint, {
        onSuccess: async () => {
          await gate.promise;
          finished = true;
        },
      });

      const pending = observer.mutateAsync({ id: "1" });
      expect(finished).toBe(false);
      gate.resolve();
      await pending;

      expect(finished).toBe(true);
    });
  });

  describe("retry", () => {
    it("retries until it succeeds", async () => {
      const client = new QueryClient();
      let attempts = 0;
      const endpoint = makeEndpoint("user.updateUser", async () => {
        attempts += 1;
        if (attempts < 2) throw new Error("flaky");
        return { ok: true };
      });
      const observer = client.watchMutation(endpoint, { retry: 1 });

      await expect(observer.mutateAsync({ id: "1" })).resolves.toEqual({ ok: true });
      expect(attempts).toBe(2);
    });

    it("does not retry by default", async () => {
      const client = new QueryClient();
      let attempts = 0;
      const endpoint = makeEndpoint("user.updateUser", async () => {
        attempts += 1;
        throw new Error("boom");
      });
      const observer = client.watchMutation(endpoint);

      await expect(observer.mutateAsync({ id: "1" })).rejects.toThrow();
      expect(attempts).toBe(1);
    });
  });

  it("reset returns to idle", async () => {
    const client = new QueryClient();
    const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));
    const observer = client.watchMutation(endpoint);
    await observer.mutateAsync({ id: "1" });

    observer.reset();

    expect(observer.getSnapshot().isIdle).toBe(true);
    expect(observer.getSnapshot().data).toBeUndefined();
    expect(observer.getSnapshot().variables).toBeUndefined();
  });

  it("a slow earlier call does not overwrite a newer result", async () => {
    const client = new QueryClient();
    const first = deferred<{ tag: string }>();
    const second = deferred<{ tag: string }>();
    let call = 0;
    const endpoint = makeEndpoint("user.updateUser", async () => {
      call += 1;
      return call === 1 ? first.promise : second.promise;
    });
    const observer = client.watchMutation(endpoint);

    const a = observer.mutateAsync({ n: 1 });
    const b = observer.mutateAsync({ n: 2 });
    second.resolve({ tag: "second" });
    await b;
    first.resolve({ tag: "first" });
    await a;

    expect(observer.getSnapshot().data).toEqual({ tag: "second" });
    expect(observer.getSnapshot().variables).toEqual({ n: 2 });
  });

  it("publishes mutation events on the cache bus", async () => {
    const client = new QueryClient();
    const events: QueryCacheEvent[] = [];
    client.subscribe((event) => events.push(event));
    const endpoint = makeEndpoint("user.updateUser", async () => ({ ok: true }));

    await client.watchMutation(endpoint).mutateAsync({ id: "1" });

    const mutations = events.filter((e) => e.type === "mutation");
    expect(mutations).toEqual([
      {
        type: "mutation",
        endpointId: "user.updateUser",
        status: "success",
        variables: { id: "1" },
        data: { ok: true },
        error: undefined,
      },
    ]);
  });

  it("accepts a typesocket acked event as the mutation source", async () => {
    const client = new QueryClient();
    const event = makeEvent("chat.sendMessage", async () => ({ id: "m1" }));

    const observer = client.watchMutation(event);
    await observer.mutateAsync({ text: "hello" });

    expect(observer.getSnapshot().data).toEqual({ id: "m1" });
  });
});
