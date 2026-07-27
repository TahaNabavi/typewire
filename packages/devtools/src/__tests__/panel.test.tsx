import { InspectorBridge, type InspectorEvent } from "@tahanabavi/type-devtools-core";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { TypeDevtools } from "../panel";

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

/** A finished HTTP request and a finished WS frame, on one bridge. */
function seeded() {
  const bridge = new InspectorBridge();
  bridge.record(event({ kind: "start", payload: { path: { id: "1" } } }));
  bridge.record(
    event({ kind: "success", payload: { name: "Taha" }, durationMs: 12 }),
  );
  bridge.record(
    event({
      source: "ws",
      kind: "outbound",
      id: "f1",
      label: "chat.sendMessage",
      payload: { text: "hi" },
      meta: { expectsAck: true },
    }),
  );
  bridge.record(
    event({
      source: "ws",
      kind: "ack",
      id: "f1",
      label: "chat.sendMessage",
      payload: { id: "m1" },
      durationMs: 4,
    }),
  );
  return bridge;
}

describe("TypeDevtools", () => {
  it("renders collapsed with a count", () => {
    render(<TypeDevtools bridge={seeded()} />);

    expect(screen.getByTestId("typewire-devtools-toggle")).toHaveTextContent("2");
    expect(screen.queryByTestId("typewire-devtools")).not.toBeInTheDocument();
  });

  it("opens and closes", () => {
    render(<TypeDevtools bridge={seeded()} />);

    fireEvent.click(screen.getByTestId("typewire-devtools-toggle"));
    expect(screen.getByTestId("typewire-devtools")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("typewire-devtools-close"));
    expect(screen.queryByTestId("typewire-devtools")).not.toBeInTheDocument();
  });

  it("shows one row per call, tagged by source", () => {
    render(<TypeDevtools bridge={seeded()} defaultOpen />);

    const rows = screen.getByTestId("typewire-rows");
    expect(rows).toHaveTextContent("user.getUser");
    expect(rows).toHaveTextContent("chat.sendMessage");
    expect(rows).toHaveTextContent("http");
    expect(rows).toHaveTextContent("ws");
    expect(rows.querySelectorAll("li")).toHaveLength(2);
  });

  it("filters by source", () => {
    render(<TypeDevtools bridge={seeded()} defaultOpen />);

    fireEvent.click(screen.getByTestId("typewire-filter-ws"));

    const rows = screen.getByTestId("typewire-rows");
    expect(rows).toHaveTextContent("chat.sendMessage");
    expect(rows).not.toHaveTextContent("user.getUser");

    fireEvent.click(screen.getByTestId("typewire-filter-all"));
    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("user.getUser");
  });

  it("filters by status", () => {
    const bridge = new InspectorBridge();
    bridge.record(event({ kind: "start" })); // user.getUser — pending
    bridge.record(event({ kind: "start", id: "r2", label: "user.listUsers" }));
    bridge.record(
      event({ kind: "success", id: "r2", label: "user.listUsers", durationMs: 5 }),
    );
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    fireEvent.click(screen.getByTestId("typewire-status-error"));
    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("No traffic yet.");

    fireEvent.click(screen.getByTestId("typewire-status-pending"));
    const rows = screen.getByTestId("typewire-rows");
    expect(rows).toHaveTextContent("user.getUser");
    expect(rows).not.toHaveTextContent("user.listUsers");
  });

  it("searches label and payload text", () => {
    const bridge = new InspectorBridge();
    bridge.record(event({ kind: "start", payload: { path: { id: "42" } } }));
    bridge.record(event({ kind: "start", id: "r2", label: "user.listUsers" }));
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    fireEvent.change(screen.getByTestId("typewire-search"), {
      target: { value: "listUsers" },
    });
    const rows = screen.getByTestId("typewire-rows");
    expect(rows).toHaveTextContent("user.listUsers");
    expect(rows).not.toHaveTextContent("user.getUser");

    // Payload text is searchable too, not just the label.
    fireEvent.change(screen.getByTestId("typewire-search"), {
      target: { value: "42" },
    });
    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("user.getUser");
  });

  it("shows the selected row's input and output as a JSON tree", () => {
    render(<TypeDevtools bridge={seeded()} defaultOpen />);

    fireEvent.click(screen.getByText("user.getUser"));

    const detail = screen.getByTestId("typewire-detail");
    expect(detail).toHaveTextContent("success");
    expect(detail).toHaveTextContent("name");
    expect(detail).toHaveTextContent("Taha");
  });

  it("pauses and freezes the timeline, then resumes", () => {
    const bridge = new InspectorBridge();
    bridge.record(event({ kind: "start" }));
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    fireEvent.click(screen.getByTestId("typewire-pause"));
    act(() => {
      bridge.record(event({ kind: "start", id: "r2", label: "user.listUsers" }));
    });
    expect(screen.getByTestId("typewire-rows")).not.toHaveTextContent("user.listUsers");

    fireEvent.click(screen.getByTestId("typewire-pause"));
    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("user.listUsers");
  });

  it("clears the timeline", () => {
    const bridge = seeded();
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    fireEvent.click(screen.getByTestId("typewire-clear"));

    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("No traffic yet.");
    expect(bridge.getSnapshot()).toEqual([]);
  });

  it("live-updates as events arrive", () => {
    const bridge = new InspectorBridge();
    render(<TypeDevtools bridge={bridge} defaultOpen />);
    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("No traffic yet.");

    act(() => {
      bridge.record(event({ kind: "start", label: "user.listUsers" }));
    });

    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("user.listUsers");
    expect(screen.getByTestId("typewire-rows")).toHaveTextContent("pending");
  });

  it("renders an error payload without throwing", () => {
    const bridge = new InspectorBridge();
    bridge.record(event({ kind: "start" }));
    bridge.record(event({ kind: "error", payload: new Error("boom") }));
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    fireEvent.click(screen.getByText("user.getUser"));

    // The Error is normalized to its fields in the tree.
    expect(screen.getByTestId("typewire-detail")).toHaveTextContent("boom");
  });

  it("renders a circular payload without throwing", () => {
    const bridge = new InspectorBridge();
    const circular: Record<string, unknown> = { name: "loop" };
    circular.self = circular;
    bridge.record(event({ kind: "start", payload: circular }));
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    fireEvent.click(screen.getByText("user.getUser"));

    expect(screen.getByTestId("typewire-detail")).toHaveTextContent("[Circular]");
  });

  it("adds an override from the detail pane and lists it", () => {
    const bridge = seeded();
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    fireEvent.click(screen.getByText("user.getUser"));
    fireEvent.click(screen.getByText("force error"));

    expect(bridge.getOverride("http", "user.getUser")).toMatchObject({
      error: { status: 500 },
    });
    const strip = screen.getByTestId("typewire-active-overrides");
    expect(strip).toHaveTextContent("user.getUser");
    expect(strip).toHaveTextContent("error 500");

    // Remove it via the active-overrides strip.
    fireEvent.click(screen.getByLabelText("Remove override for user.getUser"));
    expect(bridge.getOverride("http", "user.getUser")).toBeUndefined();
    expect(screen.queryByTestId("typewire-active-overrides")).not.toBeInTheDocument();
  });

  it("hides the Cache tab when no query client is attached", () => {
    render(<TypeDevtools bridge={seeded()} defaultOpen />);

    expect(screen.getByTestId("typewire-tab-timeline")).toBeInTheDocument();
    expect(screen.queryByTestId("typewire-tab-cache")).not.toBeInTheDocument();
  });

  it("opens the settings tab", () => {
    render(<TypeDevtools bridge={seeded()} defaultOpen />);

    fireEvent.click(screen.getByTestId("typewire-tab-settings"));

    expect(screen.getByTestId("typewire-set-theme")).toBeInTheDocument();
    // Toggling sound must not throw where AudioContext is unavailable (jsdom).
    fireEvent.click(screen.getByTestId("typewire-set-sound"));
    expect(screen.getByTestId("typewire-set-volume")).toBeInTheDocument();
  });

  it("summarizes traffic in the status bar", () => {
    const bridge = new InspectorBridge();
    bridge.record(event({ kind: "start" }));
    bridge.record(event({ kind: "error", payload: new Error("x"), durationMs: 3 }));
    render(<TypeDevtools bridge={bridge} defaultOpen />);

    const panel = screen.getByTestId("typewire-devtools");
    expect(panel).toHaveTextContent("1 calls");
    expect(panel).toHaveTextContent("1 errors");
  });
});
