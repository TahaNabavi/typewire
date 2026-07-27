import { InspectorBridge } from "../bridge";
import type { InspectorEvent } from "../types";

function event(overrides: Partial<InspectorEvent> = {}): InspectorEvent {
  return {
    source: "http",
    kind: "start",
    id: "r1",
    label: "user.getUser",
    ts: 1,
    payload: undefined,
    ...overrides,
  };
}

describe("InspectorBridge", () => {
  it("starts empty", () => {
    expect(new InspectorBridge().getSnapshot()).toEqual([]);
  });

  it("records events in order", () => {
    const bridge = new InspectorBridge();

    bridge.record(event({ id: "r1" }));
    bridge.record(event({ id: "r2" }));

    expect(bridge.getSnapshot().map((e) => e.id)).toEqual(["r1", "r2"]);
  });

  it("replaces the snapshot rather than mutating it", () => {
    const bridge = new InspectorBridge();
    const before = bridge.getSnapshot();

    bridge.record(event());

    // Identity must change, or useSyncExternalStore would never re-render.
    expect(bridge.getSnapshot()).not.toBe(before);
  });

  it("drops the oldest events past the limit", () => {
    const bridge = new InspectorBridge({ limit: 3 });

    for (let i = 1; i <= 5; i += 1) bridge.record(event({ id: `r${i}` }));

    expect(bridge.getSnapshot().map((e) => e.id)).toEqual(["r3", "r4", "r5"]);
  });

  it("notifies subscribers and stops after unsubscribe", () => {
    const bridge = new InspectorBridge();
    let notifications = 0;
    const unsubscribe = bridge.subscribe(() => {
      notifications += 1;
    });

    bridge.record(event());
    expect(notifications).toBe(1);

    unsubscribe();
    bridge.record(event());

    expect(notifications).toBe(1);
  });

  it("clear empties the log and notifies", () => {
    const bridge = new InspectorBridge();
    bridge.record(event());
    let notified = false;
    bridge.subscribe(() => {
      notified = true;
    });

    bridge.clear();

    expect(bridge.getSnapshot()).toEqual([]);
    expect(notified).toBe(true);
  });

  describe("overrides", () => {
    it("stores and reads back per source and label", () => {
      const bridge = new InspectorBridge();

      bridge.setOverride("http", "user.getUser", { latencyMs: 500 });

      expect(bridge.getOverride("http", "user.getUser")).toEqual({
        latencyMs: 500,
      });
      expect(bridge.getOverride("ws", "user.getUser")).toBeUndefined();
      expect(bridge.getOverride("http", "user.listUsers")).toBeUndefined();
    });

    it("removes an override", () => {
      const bridge = new InspectorBridge();
      bridge.setOverride("http", "user.getUser", { drop: true });

      bridge.removeOverride("http", "user.getUser");

      expect(bridge.getOverride("http", "user.getUser")).toBeUndefined();
    });

    it("lists active overrides with their source and label intact", () => {
      const bridge = new InspectorBridge();
      bridge.setOverride("http", "user.getUser", { latencyMs: 1 });
      bridge.setOverride("ws", "chat.sendMessage", { drop: true });

      expect(bridge.listOverrides()).toEqual([
        { source: "http", label: "user.getUser", override: { latencyMs: 1 } },
        { source: "ws", label: "chat.sendMessage", override: { drop: true } },
      ]);
    });

    it("keeps a label that itself contains a colon", () => {
      const bridge = new InspectorBridge();

      bridge.setOverride("http", "odd:label:here", { latencyMs: 2 });

      expect(bridge.listOverrides()[0]).toEqual({
        source: "http",
        label: "odd:label:here",
        override: { latencyMs: 2 },
      });
    });

    it("clearOverrides drops them all", () => {
      const bridge = new InspectorBridge();
      bridge.setOverride("http", "a", { latencyMs: 1 });
      bridge.setOverride("ws", "b", { drop: true });

      bridge.clearOverrides();

      expect(bridge.listOverrides()).toEqual([]);
    });
  });
});
