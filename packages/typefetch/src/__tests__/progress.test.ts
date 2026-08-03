import { z } from "zod";
import { ApiClient } from "../client";
import type { Contracts, RequestEvent, TransferProgress } from "../types";

global.fetch = jest.fn();

/**
 * A controllable `XMLHttpRequest` stand-in.
 *
 * The upload-progress path exists precisely because it cannot run on `fetch`,
 * so there is nothing to fake at the fetch layer — the test has to drive XHR
 * itself, tick by tick, to assert what the handler receives and when.
 */
class FakeXhr {
  static instances: FakeXhr[] = [];

  static get last(): FakeXhr {
    const instance = FakeXhr.instances[FakeXhr.instances.length - 1];
    if (!instance) throw new Error("no XMLHttpRequest was constructed");
    return instance;
  }

  method = "";
  url = "";
  responseType = "";
  withCredentials = false;
  sentBody: unknown = null;
  requestHeaders: Record<string, string> = {};

  status = 0;
  statusText = "";
  response: ArrayBuffer | null = null;
  aborted = false;

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  private rawResponseHeaders = "";
  private uploadListeners: Array<(event: any) => void> = [];

  upload = {
    addEventListener: (type: string, fn: (event: any) => void) => {
      if (type === "progress") this.uploadListeners.push(fn);
    },
  };

  constructor() {
    FakeXhr.instances.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders[name] = value;
  }

  getAllResponseHeaders() {
    return this.rawResponseHeaders;
  }

  send(body: unknown) {
    this.sentBody = body;
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  /** Drive one upload tick. */
  emitUpload(loaded: number, total: number, lengthComputable = true) {
    for (const fn of this.uploadListeners) {
      fn({ loaded, total, lengthComputable });
    }
  }

  /** Complete the request. */
  respond(
    init: {
      status?: number;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
  ) {
    this.status = init.status ?? 200;
    this.statusText = this.status === 200 ? "OK" : "Error";

    const text =
      init.body === undefined ? "" : JSON.stringify(init.body);
    this.response = new TextEncoder().encode(text).buffer as ArrayBuffer;

    const headers = { "content-type": "application/json", ...init.headers };
    this.rawResponseHeaders = Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join("\r\n");

    this.onload?.();
  }
}

const contracts = {
  files: {
    upload: {
      method: "POST",
      path: "/files",
      request: z.object({ name: z.string() }),
      response: z.object({ id: z.string() }),
    },
    fetchOne: {
      method: "GET",
      path: "/files/1",
      request: z.object({}),
      response: z.object({ id: z.string() }),
    },
  },
} satisfies Contracts;

function makeClient() {
  const client = new ApiClient({ baseUrl: "https://api.test" }, contracts);
  client.init();
  return client;
}

describe("upload progress", () => {
  const original = (global as any).XMLHttpRequest;

  beforeEach(() => {
    FakeXhr.instances = [];
    (global as any).XMLHttpRequest = FakeXhr;
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = original;
  });

  it("switches to XHR and reports ticks when a handler is given", async () => {
    const client = makeClient();
    const ticks: TransferProgress[] = [];

    const pending = client.modules.files.upload(
      { name: "clip.mp4" },
      { onUploadProgress: (p) => ticks.push(p) },
    );

    await Promise.resolve();

    FakeXhr.last.emitUpload(50, 200);
    FakeXhr.last.emitUpload(200, 200);
    FakeXhr.last.respond({ body: { id: "f1" } });

    await expect(pending).resolves.toEqual({ id: "f1" });

    expect(fetch).not.toHaveBeenCalled();
    expect(ticks).toEqual([
      { phase: "upload", loaded: 0, lengthComputable: false },
      {
        phase: "upload",
        loaded: 50,
        total: 200,
        percent: 25,
        lengthComputable: true,
      },
      {
        phase: "upload",
        loaded: 200,
        total: 200,
        percent: 100,
        lengthComputable: true,
      },
    ]);
  });

  it("sends the method, url, headers and body through XHR unchanged", async () => {
    const client = makeClient();

    const pending = client.modules.files.upload(
      { name: "clip.mp4" },
      { onUploadProgress: () => {} },
    );
    await Promise.resolve();

    const xhr = FakeXhr.last;
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe("https://api.test/files");
    expect(xhr.requestHeaders["Content-Type"]).toBe("application/json");
    expect(xhr.sentBody).toBe(JSON.stringify({ name: "clip.mp4" }));
    expect(xhr.responseType).toBe("arraybuffer");

    xhr.respond({ body: { id: "f1" } });
    await pending;
  });

  it("omits total and percent when the length is unknown", async () => {
    const client = makeClient();
    const ticks: TransferProgress[] = [];

    const pending = client.modules.files.upload(
      { name: "clip.mp4" },
      { onUploadProgress: (p) => ticks.push(p) },
    );
    await Promise.resolve();

    FakeXhr.last.emitUpload(1024, 0, false);
    FakeXhr.last.respond({ body: { id: "f1" } });
    await pending;

    expect(ticks[1]).toEqual({
      phase: "upload",
      loaded: 1024,
      lengthComputable: false,
    });
  });

  it("surfaces an XHR error response through the normal error path", async () => {
    const client = makeClient();

    const pending = client.modules.files.upload(
      { name: "clip.mp4" },
      { onUploadProgress: () => {} },
    );
    await Promise.resolve();

    FakeXhr.last.respond({ status: 413, body: { message: "Too large" } });

    await expect(pending).rejects.toMatchObject({
      status: 413,
      message: "Too large",
    });
  });

  it("aborts the XHR when the signal fires", async () => {
    const client = makeClient();
    const controller = new AbortController();

    const pending = client.modules.files.upload(
      { name: "clip.mp4" },
      { onUploadProgress: () => {}, signal: controller.signal },
    );
    await Promise.resolve();

    controller.abort();

    expect(FakeXhr.last.aborted).toBe(true);
    await expect(pending).rejects.toThrow(/aborted/i);
  });

  it("does not let a throwing handler fail the request", async () => {
    const client = makeClient();
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const pending = client.modules.files.upload(
      { name: "clip.mp4" },
      {
        onUploadProgress: () => {
          throw new Error("setState on unmounted component");
        },
      },
    );
    await Promise.resolve();

    FakeXhr.last.emitUpload(10, 20);
    FakeXhr.last.respond({ body: { id: "f1" } });

    await expect(pending).resolves.toEqual({ id: "f1" });
    expect(consoleError).toHaveBeenCalled();

    consoleError.mockRestore();
  });

  it("leaves requests without a progress handler on fetch", async () => {
    const client = makeClient();
    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "f1" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(
      client.modules.files.upload({ name: "clip.mp4" }),
    ).resolves.toEqual({ id: "f1" });

    expect(fetch).toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(0);
  });
});

describe("upload progress without XMLHttpRequest", () => {
  const original = (global as any).XMLHttpRequest;

  beforeEach(() => {
    delete (global as any).XMLHttpRequest;
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = original;
  });

  it("still performs the request over fetch and warns exactly once", async () => {
    const client = makeClient();
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    const ok = () =>
      new Response(JSON.stringify({ id: "f1" }), {
        headers: { "content-type": "application/json" },
      });
    (fetch as jest.Mock).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok());

    const handler = jest.fn();
    await expect(
      client.modules.files.upload({ name: "a" }, { onUploadProgress: handler }),
    ).resolves.toEqual({ id: "f1" });
    await expect(
      client.modules.files.upload({ name: "b" }, { onUploadProgress: handler }),
    ).resolves.toEqual({ id: "f1" });

    expect(handler).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain("XMLHttpRequest is not");

    warn.mockRestore();
  });
});

describe("download progress", () => {
  /** A response whose body arrives in discrete chunks. */
  function streamed(chunks: string[], headers: Record<string, string> = {}) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    });
    return new Response(stream, { headers });
  }

  it("reports ticks against Content-Length", async () => {
    const client = makeClient();
    const ticks: TransferProgress[] = [];
    const body = JSON.stringify({ id: "f1" });

    (fetch as jest.Mock).mockResolvedValueOnce(
      streamed([body.slice(0, 5), body.slice(5)], {
        "content-length": String(body.length),
        "content-type": "application/json",
      }),
    );

    await expect(
      client.modules.files.fetchOne(
        {},
        { onDownloadProgress: (p) => ticks.push(p) },
      ),
    ).resolves.toEqual({ id: "f1" });

    expect(ticks[0]).toMatchObject({ phase: "download", loaded: 0, percent: 0 });
    expect(ticks[ticks.length - 1]).toMatchObject({
      loaded: body.length,
      total: body.length,
      percent: 100,
      lengthComputable: true,
    });
  });

  it("reports loaded-only when Content-Length is missing or CORS-hidden", async () => {
    const client = makeClient();
    const ticks: TransferProgress[] = [];

    (fetch as jest.Mock).mockResolvedValueOnce(
      streamed([JSON.stringify({ id: "f1" })], {
        "content-type": "application/json",
      }),
    );

    await client.modules.files.fetchOne(
      {},
      { onDownloadProgress: (p) => ticks.push(p) },
    );

    expect(ticks.every((t) => t.lengthComputable === false)).toBe(true);
    expect(ticks.every((t) => t.total === undefined)).toBe(true);
    expect(ticks[ticks.length - 1].loaded).toBeGreaterThan(0);
  });

  it("leaves the response untouched when no handler is given", async () => {
    const client = makeClient();

    (fetch as jest.Mock).mockResolvedValueOnce(
      streamed([JSON.stringify({ id: "f1" })], {
        "content-type": "application/json",
      }),
    );

    await expect(client.modules.files.fetchOne({})).resolves.toEqual({
      id: "f1",
    });
  });
});

describe("progress instrumentation events", () => {
  const original = (global as any).XMLHttpRequest;

  beforeEach(() => {
    FakeXhr.instances = [];
    (global as any).XMLHttpRequest = FakeXhr;
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = original;
  });

  it("emits progress events alongside start and success", async () => {
    const client = makeClient();
    const events: RequestEvent[] = [];
    client.instrument({ on: (event) => events.push(event) });

    const pending = client.modules.files.upload(
      { name: "clip.mp4" },
      { onUploadProgress: () => {} },
    );
    await Promise.resolve();

    FakeXhr.last.emitUpload(100, 200);
    FakeXhr.last.respond({ body: { id: "f1" } });
    await pending;

    const progress = events.filter((e) => e.type === "progress");
    expect(progress.length).toBeGreaterThan(0);
    expect(progress[progress.length - 1]).toMatchObject({
      type: "progress",
      endpointId: "files.upload",
      phase: "upload",
      loaded: 100,
      total: 200,
      percent: 50,
    });

    // All events for one request share its correlation id.
    const ids = new Set(events.map((e) => e.requestId));
    expect(ids.size).toBe(1);
  });

  it("emits nothing extra when the caller asked for no progress", async () => {
    const client = makeClient();
    const events: RequestEvent[] = [];
    client.instrument({ on: (event) => events.push(event) });

    (fetch as jest.Mock).mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "f1" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await client.modules.files.upload({ name: "clip.mp4" });

    // Attaching devtools must not change which transport runs or re-stream a
    // body that nobody asked to measure.
    expect(events.map((e) => e.type)).toEqual(["start", "success"]);
    expect(FakeXhr.instances).toHaveLength(0);
  });
});
