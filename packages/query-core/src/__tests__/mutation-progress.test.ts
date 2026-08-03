import { QueryClient } from "../query-client";
import type { EndpointCallOptions, TransferProgressLike } from "../types";
import { deferred, makeEndpoint } from "./helpers";

const noop = () => {};

function tick(
  phase: "upload" | "download",
  loaded: number,
  total?: number,
): TransferProgressLike {
  return total === undefined
    ? { phase, loaded, lengthComputable: false }
    : {
        phase,
        loaded,
        total,
        percent: Math.round((loaded / total) * 10000) / 100,
        lengthComputable: true,
      };
}

/**
 * An endpoint that hands its received call options back to the test, so the
 * transport's progress callbacks can be driven by hand.
 */
function progressEndpoint() {
  const gate = deferred<{ ok: boolean }>();
  let received: EndpointCallOptions | undefined;

  const endpoint = makeEndpoint<{ id: string }, { ok: boolean }>(
    "file.upload",
    async (_input, options) => {
      received = options;
      return gate.promise;
    },
  );

  return {
    endpoint,
    gate,
    options: () => received,
  };
}

describe("mutation progress", () => {
  it("passes no options at all when nothing needs them", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint);

    const pending = observer.mutateAsync({ id: "1" });
    gate.resolve({ ok: true });
    await pending;

    // The un-instrumented call is byte-for-byte what it was before progress
    // existed — no options object, so nothing switches transport downstream.
    expect(options()).toBeUndefined();
    expect(observer.getSnapshot().progress).toBeUndefined();
  });

  it("mirrors upload ticks into result.progress", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint, {
      trackProgress: "upload",
    });
    observer.subscribe(noop);

    const pending = observer.mutateAsync({ id: "1" });

    options()!.onUploadProgress!(tick("upload", 25, 100));
    expect(observer.getSnapshot().progress?.upload).toEqual(
      tick("upload", 25, 100),
    );

    options()!.onUploadProgress!(tick("upload", 100, 100));
    expect(observer.getSnapshot().progress?.upload?.percent).toBe(100);

    gate.resolve({ ok: true });
    await pending;
  });

  it("notifies subscribers on every tick so a bar re-renders", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint, { trackProgress: true });

    const listener = jest.fn();
    observer.subscribe(listener);

    const pending = observer.mutateAsync({ id: "1" });
    const before = listener.mock.calls.length;

    options()!.onUploadProgress!(tick("upload", 10, 100));
    options()!.onUploadProgress!(tick("upload", 20, 100));

    expect(listener.mock.calls.length).toBe(before + 2);

    gate.resolve({ ok: true });
    await pending;
  });

  it("tracks upload and download independently", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint, { trackProgress: true });

    const pending = observer.mutateAsync({ id: "1" });

    options()!.onUploadProgress!(tick("upload", 100, 100));
    options()!.onDownloadProgress!(tick("download", 30, 60));

    expect(observer.getSnapshot().progress).toEqual({
      upload: tick("upload", 100, 100),
      download: tick("download", 30, 60),
    });

    gate.resolve({ ok: true });
    await pending;
  });

  it("requests only the tracked direction", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint, {
      trackProgress: "download",
    });

    const pending = observer.mutateAsync({ id: "1" });

    // Not requesting upload progress is what keeps the request on `fetch`
    // instead of silently moving it to XHR.
    expect(options()!.onUploadProgress).toBeUndefined();
    expect(options()!.onDownloadProgress).toBeDefined();

    gate.resolve({ ok: true });
    await pending;
  });

  it("forwards raw ticks to a caller-supplied handler", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const onUploadProgress = jest.fn();
    const observer = client.watchMutation(endpoint, { onUploadProgress });

    const pending = observer.mutateAsync({ id: "1" });

    options()!.onUploadProgress!(tick("upload", 40, 80));

    expect(onUploadProgress).toHaveBeenCalledWith(tick("upload", 40, 80));
    // A handler alone doesn't populate state; `trackProgress` is what does.
    expect(observer.getSnapshot().progress).toBeUndefined();

    gate.resolve({ ok: true });
    await pending;
  });

  it("clears progress when a new mutation starts", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint, { trackProgress: true });

    const first = observer.mutateAsync({ id: "1" });
    options()!.onUploadProgress!(tick("upload", 100, 100));
    gate.resolve({ ok: true });
    await first;

    expect(observer.getSnapshot().progress?.upload?.percent).toBe(100);

    observer.mutateAsync({ id: "2" }).catch(noop);

    // Leaving the previous 100% on screen would show the new upload as already
    // finished before a single byte moved.
    expect(observer.getSnapshot().progress).toBeUndefined();
  });

  it("clears progress on reset", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint, { trackProgress: true });

    const pending = observer.mutateAsync({ id: "1" });
    options()!.onUploadProgress!(tick("upload", 50, 100));
    gate.resolve({ ok: true });
    await pending;

    observer.reset();

    expect(observer.getSnapshot().progress).toBeUndefined();
    expect(observer.getSnapshot().status).toBe("idle");
  });

  it("ignores ticks from a superseded call", async () => {
    const client = new QueryClient();
    const first = progressEndpoint();
    const observer = client.watchMutation(first.endpoint, {
      trackProgress: true,
    });

    observer.mutateAsync({ id: "1" }).catch(noop);
    const staleHandler = first.options()!.onUploadProgress!;

    // A second call supersedes the first; the first's transport may still be
    // streaming, and its ticks must not drive the bar for the current call.
    observer.mutateAsync({ id: "2" }).catch(noop);

    staleHandler(tick("upload", 90, 100));

    expect(observer.getSnapshot().progress).toBeUndefined();
    expect(observer.getSnapshot().variables).toEqual({ id: "2" });
  });

  it("stops writing state when tracking is turned off mid-flight", async () => {
    const client = new QueryClient();
    const { endpoint, gate, options } = progressEndpoint();
    const observer = client.watchMutation(endpoint, { trackProgress: true });

    const pending = observer.mutateAsync({ id: "1" });
    options()!.onUploadProgress!(tick("upload", 20, 100));
    expect(observer.getSnapshot().progress?.upload).toBeDefined();

    // A re-render passing new options — the observer reads them fresh.
    observer.setOptions({ trackProgress: false });
    options()!.onUploadProgress!(tick("upload", 80, 100));

    expect(observer.getSnapshot().progress?.upload?.loaded).toBe(20);

    gate.resolve({ ok: true });
    await pending;
  });
});
