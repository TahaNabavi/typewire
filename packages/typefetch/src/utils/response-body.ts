import type {
  ProgressHandler,
  ResponseType,
  TypeFetchFile,
} from "../types";
import { safeProgress, toProgress } from "./progress";

/**
 * Response body decoding
 * ======================
 * One place that turns a `Response` into whatever the endpoint's
 * `responseType` asked for, plus the download-progress wrapper and the
 * `Content-Disposition` parsing that `responseType: "file"` depends on.
 */

/** `Content-Length` as a number, or `undefined` when absent/unparseable. */
export function contentLengthOf(res: Response): number | undefined {
  const raw = res.headers.get("content-length");
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/**
 * Extract the download filename from a `Content-Disposition` header.
 *
 * Handles both spellings from RFC 6266, preferring the RFC 5987 extended form
 * (`filename*=UTF-8''na%C3%AFve.pdf`) over the plain one, since a server that
 * sends both sends the plain one as the ASCII-only fallback.
 *
 * Any directory component is stripped. A filename is attacker-influenced data
 * in any app that lets users upload what others download, and it routinely ends
 * up in a `download` attribute or a write path — a value like
 * `../../config.json` should not be able to steer that.
 */
export function parseContentDisposition(
  header: string | null,
): string | undefined {
  if (!header) return undefined;

  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (extended) {
    const value = extended[2].trim();
    try {
      return sanitizeFilename(decodeURIComponent(value));
    } catch {
      // Malformed percent-encoding: fall back to the raw token rather than
      // discarding a filename the user can still read.
      return sanitizeFilename(value);
    }
  }

  const quoted = /filename\s*=\s*"([^"]*)"/i.exec(header);
  if (quoted) return sanitizeFilename(quoted[1]);

  const bare = /filename\s*=\s*([^;]+)/i.exec(header);
  if (bare) return sanitizeFilename(bare[1].trim());

  return undefined;
}

/** Reduce a header-supplied name to a single path segment. */
function sanitizeFilename(name: string): string | undefined {
  const base = name.split(/[\\/]/).pop()?.trim();
  if (!base || base === "." || base === "..") return undefined;
  return base;
}

/**
 * Wrap a response so its body reports progress as it is consumed.
 *
 * The returned `Response` shares status and headers with the original but
 * carries a counting stream, so the bytes are tallied by whatever downstream
 * call actually drains it (`.json()`, `.blob()`, …) rather than being buffered
 * here. Returns the original untouched when there is no body to count or the
 * environment lacks streams.
 */
export function withDownloadProgress(
  res: Response,
  handler: ProgressHandler,
): Response {
  if (!res.body || typeof ReadableStream === "undefined") return res;

  const total = contentLengthOf(res);
  const lengthComputable = total !== undefined;
  const reader = res.body.getReader();
  let loaded = 0;

  safeProgress(handler, toProgress("download", 0, total, lengthComputable));

  const counted = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();

        if (done) {
          controller.close();
          return;
        }

        loaded += value.byteLength;
        safeProgress(
          handler,
          toProgress("download", loaded, total, lengthComputable),
        );
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    cancel(reason) {
      // Propagate so an aborted download actually stops the socket read.
      return reader.cancel(reason);
    },
  });

  return new Response(counted, {
    status: res.status,
    statusText: res.statusText,
    headers: res.headers,
  });
}

/**
 * Decode a successful response according to its declared `responseType`.
 *
 * `"stream"` and `"response"` hand the undrained body to the caller — they are
 * the escape hatches for SSE and manual consumption, so nothing is read here.
 */
export async function decodeResponse(
  res: Response,
  responseType: ResponseType,
): Promise<unknown> {
  switch (responseType) {
    case "text":
      return res.text();

    case "blob":
      return res.blob();

    case "arrayBuffer":
      return res.arrayBuffer();

    case "formData":
      return res.formData();

    case "stream":
      return res.body;

    case "response":
      return res;

    case "file": {
      const blob = await res.blob();
      const file: TypeFetchFile = {
        blob,
        filename: parseContentDisposition(
          res.headers.get("content-disposition"),
        ),
        contentType: res.headers.get("content-type") ?? undefined,
        size: blob.size,
      };
      return file;
    }

    case "json":
    default:
      return decodeJson(res);
  }
}

/**
 * Whether a value is a full `Response` rather than a stand-in.
 *
 * Middleware may legitimately return a hand-rolled `{ ok, status, json() }`
 * object, and test suites do it constantly. Those satisfy the parts of the
 * contract this client actually used before — so reading `text()`
 * unconditionally would break working code. Real responses still take the
 * text-first path, which is what tolerates non-JSON and empty bodies.
 */
function canReadText(res: Response): boolean {
  return typeof (res as { text?: unknown }).text === "function";
}

/**
 * Read a JSON body, tolerating the empty one.
 *
 * `res.json()` throws on a zero-length body, which is exactly what a 200 with
 * no content or a 204 sends. Endpoints declaring `z.void()`/`z.null()` are
 * common enough that treating that as a parse failure would be wrong.
 */
async function decodeJson(res: Response): Promise<unknown> {
  if (!canReadText(res)) return res.json();

  const text = await res.text();
  if (text.length === 0) return undefined;
  return JSON.parse(text);
}

/**
 * Read a failed response's body, whatever it happens to be.
 *
 * Error bodies are read as text and *then* parsed, never with `res.json()`
 * directly: a 502 from a proxy is an HTML page, a 401 from a gateway is often
 * empty, and letting a `SyntaxError` escape here would replace a perfectly good
 * status-carrying error with a parse failure. Returns the parsed JSON when the
 * body is JSON, `{ detail: <text> }` when it is not, and `{}` when it is empty.
 */
export async function readErrorBody(
  res: Response,
): Promise<{ body: any; wasJson: boolean }> {
  if (!canReadText(res)) {
    try {
      return normalizeErrorBody(await res.json());
    } catch {
      return { body: {}, wasJson: false };
    }
  }

  let text: string;

  try {
    text = await res.text();
  } catch {
    // Body already consumed by a middleware, or the connection dropped
    // mid-read. The status is still worth reporting.
    return { body: {}, wasJson: false };
  }

  if (text.trim().length === 0) return { body: {}, wasJson: false };

  try {
    return normalizeErrorBody(JSON.parse(text));
  } catch {
    return { body: { detail: text }, wasJson: false };
  }
}

/**
 * A JSON scalar (`"nope"`, `42`, `null`) parses fine but has no `.message` or
 * `.code` to read. Fold it into the same shape as a non-JSON body so the error
 * builder can treat every case uniformly.
 */
function normalizeErrorBody(parsed: unknown): { body: any; wasJson: boolean } {
  if (parsed === null || typeof parsed !== "object") {
    return { body: { detail: String(parsed) }, wasJson: false };
  }
  return { body: parsed, wasJson: true };
}
