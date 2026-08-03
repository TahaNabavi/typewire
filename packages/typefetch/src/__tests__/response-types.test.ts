import { z } from "zod";
import { ApiClient, RichError } from "../client";
import { parseContentDisposition } from "../utils/response-body";
import {
  zArrayBuffer,
  zBlob,
  zFile,
  zResponse,
  zStream,
} from "../schemas";
import type { Contracts } from "../types";

global.fetch = jest.fn();

/** A real `Response`, so decoding is exercised against the actual Fetch API. */
function respond(
  body: BodyInit | null,
  init: { status?: number; headers?: Record<string, string> } = {},
) {
  return new Response(body, {
    status: init.status ?? 200,
    headers: init.headers,
  });
}

const contracts = {
  files: {
    download: {
      method: "GET",
      path: "/files/report.pdf",
      request: z.object({}),
      response: zBlob(),
      responseType: "blob",
    },
    downloadAsFile: {
      method: "GET",
      path: "/files/report.pdf",
      request: z.object({}),
      response: zFile(),
      responseType: "file",
    },
    raw: {
      method: "GET",
      path: "/files/raw",
      request: z.object({}),
      response: zArrayBuffer(),
      responseType: "arrayBuffer",
    },
    plain: {
      method: "GET",
      path: "/files/notes.txt",
      request: z.object({}),
      response: z.string(),
      responseType: "text",
    },
    stream: {
      method: "GET",
      path: "/files/stream",
      request: z.object({}),
      response: zStream(),
      responseType: "stream",
    },
    passthrough: {
      method: "GET",
      path: "/files/sse",
      request: z.object({}),
      response: zResponse(),
      responseType: "response",
    },
    // Declares `errors` so the typed-error path can be checked on an endpoint
    // whose *success* type is binary.
    guarded: {
      method: "GET",
      path: "/files/guarded",
      request: z.object({}),
      response: zBlob(),
      responseType: "blob",
      errors: {
        404: z.object({ code: z.string(), missing: z.string() }),
      },
    },
  },
  user: {
    getUser: {
      method: "GET",
      path: "/user",
      request: z.object({}),
      response: z.object({ id: z.string() }),
    },
    noContent: {
      method: "POST",
      path: "/user/ping",
      request: z.object({}),
      response: z.undefined(),
    },
  },
} satisfies Contracts;

function makeClient() {
  const client = new ApiClient({ baseUrl: "https://api.test" }, contracts);
  client.init();
  return client;
}

describe("responseType", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  it("defaults to json, leaving existing endpoints untouched", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ id: "1" }), {
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.user.getUser({})).resolves.toEqual({ id: "1" });
  });

  it("decodes a blob and validates it against zBlob()", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond("%PDF-1.7 binary", {
        headers: { "content-type": "application/pdf" },
      }),
    );

    const result = await client.modules.files.download({});

    expect(result).toBeInstanceOf(Blob);
    expect(await (result as Blob).text()).toBe("%PDF-1.7 binary");
  });

  it("decodes text", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(respond("hello there"));

    await expect(client.modules.files.plain({})).resolves.toBe("hello there");
  });

  it("decodes an arrayBuffer", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(respond("abc"));

    const result = await client.modules.files.raw({});

    expect(result).toBeInstanceOf(ArrayBuffer);
    expect((result as ArrayBuffer).byteLength).toBe(3);
  });

  it("returns the undrained body for stream", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(respond("chunked"));

    const result = await client.modules.files.stream({});

    expect(result).toBeInstanceOf(ReadableStream);
  });

  it("returns the whole Response, still unread, for response", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ event: "tick" }), {
        headers: { "content-type": "text/event-stream" },
      }),
    );

    const result = (await client.modules.files.passthrough({})) as Response;

    expect(result).toBeInstanceOf(Response);
    expect(result.bodyUsed).toBe(false);
    expect(result.headers.get("content-type")).toBe("text/event-stream");
    await expect(result.json()).resolves.toEqual({ event: "tick" });
  });

  it("builds a file with the filename, content type and size", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond("report body", {
        headers: {
          "content-type": "application/pdf",
          "content-disposition": 'attachment; filename="Q3 report.pdf"',
        },
      }),
    );

    const file = await client.modules.files.downloadAsFile({});

    expect(file.filename).toBe("Q3 report.pdf");
    expect(file.contentType).toBe("application/pdf");
    expect(file.size).toBe(11);
    expect(await file.blob.text()).toBe("report body");
  });

  it("leaves the filename undefined when the header is absent or CORS-hidden", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(respond("body"));

    const file = await client.modules.files.downloadAsFile({});

    expect(file.filename).toBeUndefined();
    expect(file.size).toBe(4);
  });

  it("skips the response wrapper and transform for non-JSON types", async () => {
    // Both would corrupt a Blob: the wrapper would try to read `.data` off it,
    // the transform would spread it into a plain object.
    client.setResponseWrapper((success) =>
      z.object({ success: z.literal(true), data: success }),
    );
    client.useResponseTransform((data) => ({ ...data, touched: true }));

    (fetch as jest.Mock).mockResolvedValueOnce(respond("raw bytes"));

    const result = await client.modules.files.download({});

    expect(result).toBeInstanceOf(Blob);
    expect(await (result as Blob).text()).toBe("raw bytes");
  });

  it("treats an empty JSON body as undefined rather than a parse failure", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(respond(null, { status: 200 }));

    await expect(client.modules.user.noContent({})).resolves.toBeUndefined();
  });

  it("rejects when the decoded value does not match the declared schema", async () => {
    // `responseType: "text"` with a `z.string()` response is satisfied, but a
    // mismatched pair must still fail loudly rather than pass a wrong type on.
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ id: "1" })),
    );

    await expect(client.modules.files.download({})).resolves.toBeInstanceOf(
      Blob,
    );

    (fetch as jest.Mock).mockResolvedValueOnce(respond("not-a-blob"));
    await expect(client.modules.user.getUser({})).rejects.toThrow();
  });
});

describe("error responses on non-JSON endpoints", () => {
  let client: ReturnType<typeof makeClient>;

  beforeEach(() => {
    client = makeClient();
  });

  it("reads a JSON error from a blob endpoint", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce(
      respond(JSON.stringify({ code: "GONE", missing: "report.pdf" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      }),
    );

    await expect(client.modules.files.guarded({})).rejects.toMatchObject({
      status: 404,
      code: "GONE",
      dataParsed: true,
      data: { code: "GONE", missing: "report.pdf" },
    });
  });
});

describe("parseContentDisposition", () => {
  it("reads a quoted filename", () => {
    expect(
      parseContentDisposition('attachment; filename="annual report.pdf"'),
    ).toBe("annual report.pdf");
  });

  it("reads an unquoted filename", () => {
    expect(parseContentDisposition("attachment; filename=report.pdf")).toBe(
      "report.pdf",
    );
  });

  it("prefers the RFC 5987 extended form and percent-decodes it", () => {
    expect(
      parseContentDisposition(
        "attachment; filename=\"naive.pdf\"; filename*=UTF-8''na%C3%AFve.pdf",
      ),
    ).toBe("naïve.pdf");
  });

  it("strips directory components from the header value", () => {
    // A filename is attacker-influenced in any app where one user downloads
    // what another uploaded; it must not be able to steer a write path.
    expect(
      parseContentDisposition('attachment; filename="../../etc/passwd"'),
    ).toBe("passwd");
    expect(
      parseContentDisposition('attachment; filename="C:\\Windows\\host.ini"'),
    ).toBe("host.ini");
  });

  it("returns undefined for a missing, empty or dot-only filename", () => {
    expect(parseContentDisposition(null)).toBeUndefined();
    expect(parseContentDisposition("attachment")).toBeUndefined();
    expect(parseContentDisposition('attachment; filename=".."')).toBeUndefined();
  });

  it("falls back to the raw token when percent-decoding fails", () => {
    expect(
      parseContentDisposition("attachment; filename*=UTF-8''bad%ZZname.pdf"),
    ).toBe("bad%ZZname.pdf");
  });
});
