import { z } from "zod";
import { ApiClient } from "../client";
import type { Contracts } from "../types";

global.fetch = jest.fn();

/**
 * A minimal `XMLHttpRequest` stand-in.
 *
 * These tests only care about *which* sender ran, not what it reported, so this
 * fake completes immediately rather than driving progress ticks — that is
 * `progress.test.ts`'s job.
 */
class FakeXhr {
  static instances: FakeXhr[] = [];

  method = "";
  url = "";
  responseType = "";
  withCredentials = false;
  requestHeaders: Record<string, string> = {};
  status = 200;
  statusText = "OK";
  response: ArrayBuffer | null = null;

  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;

  upload = { addEventListener: () => {} };

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
    return "content-type: application/json";
  }

  send() {
    this.response = new TextEncoder().encode(
      JSON.stringify({ id: "1" }),
    ).buffer as ArrayBuffer;
    // Settle asynchronously so the client has attached its handlers first.
    queueMicrotask(() => this.onload?.());
  }

  abort() {}
}

const response = z.object({ id: z.string() });
const request = z.object({ name: z.string() });

const contracts = {
  files: {
    auto: { method: "POST", path: "/auto", request, response },
    pinnedFetch: {
      method: "POST",
      path: "/fetch",
      driver: "fetch",
      request,
      response,
    },
    pinnedXhr: {
      method: "POST",
      path: "/xhr",
      driver: "xhr",
      request,
      response,
    },
  },
} satisfies Contracts;

function makeClient() {
  const client = new ApiClient({ baseUrl: "https://api.test" }, contracts);
  client.init();
  return client;
}

function okJson() {
  return Promise.resolve(
    new Response(JSON.stringify({ id: "1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
}

describe("driver", () => {
  const originalXhr = (global as any).XMLHttpRequest;

  beforeEach(() => {
    FakeXhr.instances = [];
    (global as any).XMLHttpRequest = FakeXhr;
    (fetch as jest.Mock).mockReset();
    (fetch as jest.Mock).mockImplementation(okJson);
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = originalXhr;
  });

  it('defaults to fetch when nothing is declared, even though XHR exists', async () => {
    const api = makeClient().modules;

    await api.files.auto({ name: "a" });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it('"auto" still switches to XHR for a request asking for upload progress', async () => {
    const api = makeClient().modules;

    await api.files.auto({ name: "a" }, { onUploadProgress: () => {} });

    expect(fetch).not.toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(1);
  });

  it('"xhr" uses XHR even without a progress handler', async () => {
    const api = makeClient().modules;

    await api.files.pinnedXhr({ name: "a" });

    expect(fetch).not.toHaveBeenCalled();
    expect(FakeXhr.instances).toHaveLength(1);
    expect(FakeXhr.instances[0]!.url).toBe("https://api.test/xhr");
  });

  it('"fetch" stays on fetch even when upload progress is requested', async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const api = makeClient().modules;

    await api.files.pinnedFetch({ name: "a" }, { onUploadProgress: () => {} });

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(FakeXhr.instances).toHaveLength(0);

    // Pinning fetch is a deliberate choice, but silently never calling the
    // handler still reads as a hung upload — so it warns.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("keeps the request working when the response type is unaffected", async () => {
    const api = makeClient().modules;

    await expect(api.files.pinnedXhr({ name: "a" })).resolves.toEqual({
      id: "1",
    });
  });
});

describe('driver: "xhr" where XMLHttpRequest does not exist', () => {
  const originalXhr = (global as any).XMLHttpRequest;

  beforeEach(() => {
    delete (global as any).XMLHttpRequest;
    (fetch as jest.Mock).mockReset();
    (fetch as jest.Mock).mockImplementation(okJson);
  });

  afterEach(() => {
    (global as any).XMLHttpRequest = originalXhr;
  });

  it("falls back to fetch and says so once", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const api = makeClient().modules;

    await api.files.pinnedXhr({ name: "a" });
    await api.files.pinnedXhr({ name: "b" });

    expect(fetch).toHaveBeenCalledTimes(2);
    // Warned once, not per request — an SSR pass must not flood the log.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('driver: "xhr"');

    warn.mockRestore();
  });
});
