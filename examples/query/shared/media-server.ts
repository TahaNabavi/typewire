import type { IncomingMessage, ServerResponse } from "node:http";

/**
 * The one piece of real infrastructure in this example.
 *
 * Progress is a property of bytes actually moving, so it cannot be demonstrated
 * through `resolveOverride` the way the user and chat endpoints are — an
 * override answers *before* the transport runs. This handler is deliberately
 * minimal: enough to accept a multipart upload and serve a file back, and
 * nothing that would turn the example into a lesson about servers.
 *
 * It is shared so the browser (Vite dev server) and the headless run
 * (`node:http`) serve identical responses.
 */

/** Uploaded blobs, by id. In memory — restarting the server forgets them. */
const store = new Map<string, { bytes: Buffer; filename: string }>();

let nextId = 1;

/** Read a request body fully. */
function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/**
 * Extract the first file part from a multipart body.
 *
 * Small but real: storing the whole envelope would make the download hand back
 * boundary markers and part headers rather than the file, and an example that
 * quietly does that teaches the wrong thing about the round trip.
 *
 * Still not a general RFC 7578 parser — it takes the first part carrying a
 * `filename`, which is all this example uploads.
 */
function extractFilePart(
  body: Buffer,
  contentType: string | undefined,
): { bytes: Buffer; filename: string } {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return { bytes: body, filename: "upload.bin" };

  const delimiter = Buffer.from(`--${marker}`);
  const parts: Buffer[] = [];
  let cursor = body.indexOf(delimiter);

  while (cursor !== -1) {
    const next = body.indexOf(delimiter, cursor + delimiter.length);
    if (next === -1) break;
    // Skip the delimiter and its trailing CRLF; drop the CRLF before the next.
    parts.push(body.subarray(cursor + delimiter.length + 2, next - 2));
    cursor = next;
  }

  for (const part of parts) {
    const split = part.indexOf("\r\n\r\n");
    if (split === -1) continue;

    const headers = part.subarray(0, split).toString("utf8");
    const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
    if (!filename) continue;

    return { bytes: part.subarray(split + 4), filename: filename || "upload.bin" };
  }

  return { bytes: body, filename: "upload.bin" };
}

/**
 * Handle `/media` and `/media/:id`. Returns `true` when it answered, so the
 * caller can fall through to whatever else it serves.
 */
export async function handleMedia(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith("/media")) return false;

  // The browser demo runs on the Vite origin, so same-origin — but a reader who
  // moves the server elsewhere hits CORS immediately, and the two `Expose`
  // headers are exactly the ones the README warns about.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader(
    "Access-Control-Expose-Headers",
    "Content-Disposition, Content-Length",
  );

  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return true;
  }

  if (req.method === "POST" && url.pathname === "/media") {
    const envelope = await readBody(req);
    const part = extractFilePart(envelope, req.headers["content-type"]);

    const id = `m${nextId++}`;
    store.set(id, part);

    // Reports the *file's* size, not the multipart envelope's, so the number in
    // the UI matches the file the user picked.
    res.writeHead(201, { "content-type": "application/json" });
    res.end(JSON.stringify({ id, bytes: part.bytes.byteLength }));
    return true;
  }

  if (req.method === "GET") {
    const id = url.pathname.slice("/media/".length);
    const record = store.get(id);

    if (!record) {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ message: `No upload ${id}`, code: "NOT_FOUND" }));
      return true;
    }

    res.writeHead(200, {
      "content-type": "application/octet-stream",
      // What `responseType: "file"` reads the filename from. Without the
      // `Expose` header above, a cross-origin browser could not see this.
      "content-disposition": `attachment; filename="${record.filename}"`,
      // What download progress needs to report a percentage rather than a
      // running byte count.
      "content-length": String(record.bytes.byteLength),
    });
    res.end(record.bytes);
    return true;
  }

  res.writeHead(405).end();
  return true;
}
