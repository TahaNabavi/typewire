import { selectEntries } from "../entries";
import type { InspectorEvent } from "../types";

function event(overrides: Partial<InspectorEvent>): InspectorEvent {
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

describe("selectEntries", () => {
  it("returns nothing for an empty log", () => {
    expect(selectEntries([])).toEqual([]);
  });

  it("collapses events sharing a correlation id into one row", () => {
    const entries = selectEntries([
      event({ kind: "start", payload: { id: "1" } }),
      event({ kind: "success", payload: { name: "Taha" }, durationMs: 12 }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      key: "http:r1",
      status: "success",
      input: { id: "1" },
      output: { name: "Taha" },
      durationMs: 12,
    });
    expect(entries[0]?.events).toHaveLength(2);
  });

  it("keeps different correlation ids apart", () => {
    const entries = selectEntries([
      event({ id: "r1" }),
      event({ id: "r2" }),
    ]);

    expect(entries.map((e) => e.id)).toEqual(["r1", "r2"]);
  });

  it("keeps the same id apart across sources", () => {
    const entries = selectEntries([
      event({ source: "http", id: "1" }),
      event({ source: "ws", id: "1", kind: "outbound" }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((e) => e.key)).toEqual(["http:1", "ws:1"]);
  });

  it("leaves a request with no terminal event pending", () => {
    const entries = selectEntries([event({ kind: "start" })]);

    expect(entries[0]?.status).toBe("pending");
  });

  it("marks a failed request as an error", () => {
    const entries = selectEntries([
      event({ kind: "start" }),
      event({ kind: "error", payload: { message: "boom" }, durationMs: 5 }),
    ]);

    expect(entries[0]).toMatchObject({
      status: "error",
      error: { message: "boom" },
      durationMs: 5,
    });
  });

  it("treats an ack-less outbound frame as complete, not pending", () => {
    const entries = selectEntries([
      event({
        source: "ws",
        kind: "outbound",
        id: "f1",
        label: "chat.typing",
        payload: { typing: true },
        meta: { expectsAck: false },
      }),
    ]);

    // Nothing will ever arrive for it, so leaving it "pending" would read as a
    // hung frame in the panel.
    expect(entries[0]?.status).toBe("info");
    expect(entries[0]?.input).toEqual({ typing: true });
  });

  it("holds an ack-expecting frame pending until the ack lands", () => {
    const outbound = event({
      source: "ws",
      kind: "outbound",
      id: "f1",
      label: "chat.sendMessage",
      meta: { expectsAck: true },
    });

    expect(selectEntries([outbound])[0]?.status).toBe("pending");
    expect(
      selectEntries([
        outbound,
        event({ source: "ws", kind: "ack", id: "f1", payload: { id: "m1" } }),
      ])[0]?.status,
    ).toBe("success");
  });

  it("records an inbound frame as informational", () => {
    const entries = selectEntries([
      event({
        source: "ws",
        kind: "inbound",
        id: "f2",
        label: "chat.message",
        payload: { text: "hi" },
      }),
    ]);

    expect(entries[0]).toMatchObject({ status: "info", output: { text: "hi" } });
  });

  it("marks a dropped frame", () => {
    const entries = selectEntries([
      event({ source: "ws", kind: "outbound", id: "f3", meta: { expectsAck: true } }),
      event({ source: "ws", kind: "dropped", id: "f3" }),
    ]);

    expect(entries[0]?.status).toBe("dropped");
  });

  it("marks a frame error", () => {
    const entries = selectEntries([
      event({ source: "ws", kind: "outbound", id: "f4", meta: { expectsAck: true } }),
      event({ source: "ws", kind: "frame_error", id: "f4", payload: { code: "E" } }),
    ]);

    expect(entries[0]).toMatchObject({ status: "error", error: { code: "E" } });
  });

  it("shows lifecycle events without pretending they conclude anything", () => {
    const entries = selectEntries([
      event({
        source: "ws",
        kind: "connect",
        id: "lifecycle-connect-5",
        label: "socket",
        ts: 5,
      }),
    ]);

    expect(entries[0]).toMatchObject({ status: "info", label: "socket" });
  });

  it("preserves first-seen order across transports", () => {
    const entries = selectEntries([
      event({ source: "ws", kind: "outbound", id: "f1", ts: 1 }),
      event({ source: "http", kind: "start", id: "r1", ts: 2 }),
      event({ source: "ws", kind: "ack", id: "f1", ts: 3 }),
    ]);

    expect(entries.map((e) => e.key)).toEqual(["ws:f1", "http:r1"]);
  });
});
