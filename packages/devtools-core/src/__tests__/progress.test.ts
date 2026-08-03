import { InspectorBridge } from "../bridge";
import { connectTypeFetch } from "../connect-typefetch";
import { selectEntries } from "../entries";
import type {
  InspectorProgress,
  TypeFetchRequestEvent,
  TypeFetchOverride,
  Instrumentable,
} from "../types";

/** A typefetch client reduced to the `instrument` seam, driven by hand. */
function fakeClient() {
  let hook: Parameters<
    Instrumentable<TypeFetchRequestEvent, TypeFetchOverride>["instrument"]
  >[0];

  const client: Instrumentable<TypeFetchRequestEvent, TypeFetchOverride> = {
    instrument: (h) => {
      hook = h;
      return () => {};
    },
  };

  return {
    client,
    emit: (event: TypeFetchRequestEvent) => hook.on?.(event),
  };
}

const progressEvent = (
  loaded: number,
  total: number,
): TypeFetchRequestEvent => ({
  type: "progress",
  requestId: "tf_1",
  endpointId: "files.upload",
  phase: "upload",
  loaded,
  total,
  percent: (loaded / total) * 100,
  lengthComputable: true,
  durationMs: loaded,
});

describe("progress channel", () => {
  it("keeps progress out of the event log", () => {
    const bridge = new InspectorBridge();
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    emit({
      type: "start",
      requestId: "tf_1",
      endpointId: "files.upload",
      method: "POST",
      url: "https://api.test/files",
      input: { name: "clip.mp4" },
      timestamp: 1,
    });

    for (let loaded = 10; loaded <= 100; loaded += 10) {
      emit(progressEvent(loaded, 100));
    }

    // Ten ticks through `record` would have been ten ring-buffer writes; the
    // whole point of the separate channel is that the log still holds one event.
    expect(bridge.getSnapshot()).toHaveLength(1);
    expect(bridge.getProgressSnapshot().get("http:tf_1")).toMatchObject({
      phase: "upload",
      loaded: 100,
      total: 100,
      percent: 100,
    });
  });

  it("does not evict real events under a long upload", () => {
    const bridge = new InspectorBridge({ limit: 5 });
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    emit({
      type: "start",
      requestId: "tf_1",
      endpointId: "files.upload",
      method: "POST",
      url: "https://api.test/files",
      input: {},
      timestamp: 1,
    });

    for (let i = 0; i < 200; i += 1) emit(progressEvent(i, 200));

    expect(bridge.getSnapshot()).toHaveLength(1);
    expect(bridge.getSnapshot()[0]!.kind).toBe("start");
  });

  it("notifies subscribers on each tick", () => {
    const bridge = new InspectorBridge();
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    const listener = jest.fn();
    bridge.subscribe(listener);

    emit(progressEvent(10, 100));
    emit(progressEvent(20, 100));

    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("replaces rather than accumulates per call", () => {
    const bridge = new InspectorBridge();
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    emit(progressEvent(10, 100));
    emit(progressEvent(90, 100));

    expect(bridge.getProgressSnapshot().size).toBe(1);
    expect(bridge.getProgressSnapshot().get("http:tf_1")?.loaded).toBe(90);
  });

  it("keeps concurrent calls of the same endpoint separate", () => {
    const bridge = new InspectorBridge();
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    emit(progressEvent(10, 100));
    emit({ ...progressEvent(50, 100), requestId: "tf_2" });

    expect(bridge.getProgressSnapshot().size).toBe(2);
    expect(bridge.getProgressSnapshot().get("http:tf_1")?.loaded).toBe(10);
    expect(bridge.getProgressSnapshot().get("http:tf_2")?.loaded).toBe(50);
  });

  it("releases progress once the call concludes", () => {
    const bridge = new InspectorBridge();
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    emit(progressEvent(100, 100));
    expect(bridge.getProgressSnapshot().size).toBe(1);

    emit({
      type: "success",
      requestId: "tf_1",
      endpointId: "files.upload",
      data: { id: "f1" },
      durationMs: 120,
      fromMock: false,
    });

    // Otherwise every upload a long-lived page ever made would be retained.
    expect(bridge.getProgressSnapshot().size).toBe(0);
  });

  it("releases progress when the call fails", () => {
    const bridge = new InspectorBridge();
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    emit(progressEvent(40, 100));
    emit({
      type: "error",
      requestId: "tf_1",
      endpointId: "files.upload",
      status: 413,
      error: { message: "Too large" },
      durationMs: 90,
    });

    expect(bridge.getProgressSnapshot().size).toBe(0);
  });

  it("clears progress alongside the log", () => {
    const bridge = new InspectorBridge();
    const { client, emit } = fakeClient();
    connectTypeFetch(client, bridge);

    emit(progressEvent(40, 100));
    bridge.clear();

    expect(bridge.getProgressSnapshot().size).toBe(0);
    expect(bridge.getSnapshot()).toHaveLength(0);
  });
});

describe("selectEntries with progress", () => {
  const startEvent = {
    source: "http" as const,
    kind: "start",
    id: "tf_1",
    label: "files.upload",
    ts: 1,
    payload: { name: "clip.mp4" },
  };

  const snapshot: InspectorProgress = {
    phase: "upload",
    loaded: 60,
    total: 100,
    percent: 60,
    lengthComputable: true,
    ts: 5,
  };

  it("joins the progress snapshot onto the matching entry", () => {
    const entry = selectEntries(
      [startEvent],
      new Map([["http:tf_1", snapshot]]),
    )[0]!;

    expect(entry.status).toBe("pending");
    expect(entry.progress).toEqual(snapshot);
    // Progress must not masquerade as a timeline event.
    expect(entry.events).toHaveLength(1);
  });

  it("leaves entries untouched when no progress map is passed", () => {
    const entry = selectEntries([startEvent])[0]!;

    expect(entry.progress).toBeUndefined();
  });

  it("leaves unrelated entries alone", () => {
    const other = { ...startEvent, id: "tf_2", label: "user.getUser" };
    const entries = selectEntries(
      [startEvent, other],
      new Map([["http:tf_1", snapshot]]),
    );

    expect(entries[0]!.progress).toEqual(snapshot);
    expect(entries[1]!.progress).toBeUndefined();
  });
});
