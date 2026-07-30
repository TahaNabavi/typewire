import { P } from "./fixture";

describe("createStore", () => {
  it("is a valid Observable and notifies on change", () => {
    const store = P.createStore({ global: P.pack(["chat.VIEW_CHANNEL"]) });
    let ticks = 0;
    const unsub = store.subscribe(() => ticks++);
    expect(P.has(store.getSnapshot().global, "chat.VIEW_CHANNEL")).toBe(true);

    store.set(P.pack(["chat.SEND_MESSAGES"]));
    expect(ticks).toBe(1);
    expect(store.getSnapshot().version).toBe(1);

    unsub();
    store.set(0n);
    expect(ticks).toBe(1); // no notification after unsubscribe
  });

  it("for(scope) falls back to global when unseen", () => {
    const store = P.createStore({ global: P.pack(["chat.VIEW_CHANNEL"]) });
    expect(store.for("channel:1")).toBe(store.getSnapshot().global);

    store.setScope("channel:1", P.pack(["chat.MANAGE_MESSAGES"]));
    expect(P.has(store.for("channel:1"), "chat.MANAGE_MESSAGES")).toBe(true);
    expect(store.for("channel:2")).toBe(store.getSnapshot().global);

    store.clearScope("channel:1");
    expect(store.for("channel:1")).toBe(store.getSnapshot().global);
  });

  it("accepts an explicit version (server-driven epoch)", () => {
    const store = P.createStore({});
    store.set(P.pack(["chat.VIEW_CHANNEL"]), 42);
    expect(store.getSnapshot().version).toBe(42);
  });
});

describe("createResolver", () => {
  it("memoizes by actor+scope and only computes once", () => {
    let calls = 0;
    const resolver = P.createResolver({
      compute: () => {
        calls++;
        return P.pack(["chat.VIEW_CHANNEL"]);
      },
    });
    resolver.get("u1", "c1");
    resolver.get("u1", "c1");
    expect(calls).toBe(1);
    resolver.get("u1", "c2");
    expect(calls).toBe(2);
  });

  it("a version bump invalidates every scope for that actor at once", () => {
    let calls = 0;
    const epoch = new Map<string, number>([["u1", 1]]);
    const resolver = P.createResolver({
      compute: () => {
        calls++;
        return 0n;
      },
      version: (id) => epoch.get(id) ?? 0,
    });
    resolver.get("u1", "c1");
    resolver.get("u1", "c2");
    expect(calls).toBe(2);
    epoch.set("u1", 2); // role change → bump epoch
    resolver.get("u1", "c1");
    resolver.get("u1", "c2");
    expect(calls).toBe(4);
  });

  it("expires entries after ttl (injected clock)", () => {
    let calls = 0;
    let t = 1000;
    const resolver = P.createResolver({
      compute: () => {
        calls++;
        return 0n;
      },
      ttl: 100,
      now: () => t,
    });
    resolver.get("u1");
    resolver.get("u1");
    expect(calls).toBe(1);
    t += 200; // past the ttl
    resolver.get("u1");
    expect(calls).toBe(2);
  });

  it("invalidate() targets one entry, one actor, or everything", () => {
    let calls = 0;
    const resolver = P.createResolver({
      compute: () => {
        calls++;
        return 0n;
      },
    });
    resolver.get("u1", "c1");
    resolver.invalidate("u1", "c1");
    resolver.get("u1", "c1");
    expect(calls).toBe(2);

    resolver.get("u2"); // call 3
    resolver.invalidate(); // clear all
    resolver.get("u1", "c1"); // call 4
    resolver.get("u2"); // call 5
    expect(calls).toBe(5);
  });

  it("does not cache a rejected async computation", async () => {
    let calls = 0;
    const resolver = P.createResolver({
      compute: async () => {
        calls++;
        throw new Error("boom");
      },
    });
    await expect(resolver.get("u1")).rejects.toThrow("boom");
    await expect(resolver.get("u1")).rejects.toThrow("boom");
    expect(calls).toBe(2); // evicted after rejection, so it recomputed
  });
});
