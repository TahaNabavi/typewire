import type { ProgressHandler } from "../types";
import { safeProgress, toProgress } from "../utils/progress";

/**
 * XHR transport
 * =============
 * `fetch` has no upload-progress API and never has. The streaming-request-body
 * workaround (`ReadableStream` body + `duplex: "half"`) is Chromium-only and
 * requires HTTP/2, so it cannot be the answer for a client that has to work
 * everywhere. `XMLHttpRequest` can report upload progress, in every browser,
 * and that is the only reason this file exists.
 *
 * It stands in for the terminal `fetch(ctx.url, ctx.init)` at the end of the
 * middleware chain, and *only* when a request asks for upload progress. It
 * returns a real `Response`, so every middleware and every line of response
 * handling downstream is unaware of the swap.
 *
 * What is deliberately not carried over from `RequestInit`: `cache`, `mode`,
 * `redirect`, `referrerPolicy`, `integrity`, and `duplex`. XHR has no equivalent
 * for any of them, and silently accepting a value the transport cannot honor is
 * worse than the documented gap.
 */

/** Whether this environment can do upload progress at all. */
export function isXhrAvailable(): boolean {
  return typeof XMLHttpRequest !== "undefined";
}

/**
 * Turn `getAllResponseHeaders()`'s raw block into a `Headers`.
 *
 * The spec joins headers with CRLF and separates name from value at the first
 * colon only — values legitimately contain colons (`Date`, any URL). Splitting
 * on every colon would corrupt them.
 */
function parseHeaders(raw: string): Headers {
  const headers = new Headers();
  if (!raw) return headers;

  for (const line of raw.trim().split(/[\r\n]+/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (!name) continue;

    try {
      headers.append(name, value);
    } catch {
      // A malformed name from a misbehaving server shouldn't sink the response.
    }
  }

  return headers;
}

/** Normalize the client's `RequestInit.headers` into flat entries. */
function headerEntries(headers: HeadersInit | undefined): Array<[string, string]> {
  if (!headers) return [];
  if (headers instanceof Headers) return Array.from(headers.entries());
  if (Array.isArray(headers)) return headers.map(([k, v]) => [k, String(v)]);
  return Object.entries(headers).map(([k, v]) => [k, String(v)]);
}

/**
 * Statuses whose responses are defined to have no body. The `Response`
 * constructor throws a `TypeError` if handed one anyway, so the body is dropped
 * rather than allowed to blow up a legitimate 204.
 */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

export type XhrRequestOptions = {
  onUploadProgress?: ProgressHandler;
};

/**
 * Perform a request over `XMLHttpRequest` and resolve with a `Response`.
 *
 * Rejects the way `fetch` does — a `TypeError` for network failure, an
 * `AbortError` `DOMException` for cancellation — so the client's existing error
 * normalization needs no special case for this path.
 */
export function xhrRequest(
  url: string,
  init: RequestInit,
  options: XhrRequestOptions = {},
): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const method = (init.method ?? "GET").toUpperCase();

    xhr.open(method, url, true);
    // arraybuffer round-trips every content type without corrupting binary,
    // which `responseText` would.
    xhr.responseType = "arraybuffer";

    // `fetch` defaults to same-origin credentials; XHR defaults to not sending
    // them cross-origin. Only "include" changes behavior here.
    xhr.withCredentials = init.credentials === "include";

    // `xhr.timeout` is deliberately left unset: the client already implements
    // `RequestOptions.timeout` with an `AbortController`, and that signal is
    // wired up below. Setting both would race, and a `TimeoutError` from XHR
    // would differ from the `AbortError` the fetch path produces for the same
    // configuration.

    const body = (init.body ?? null) as XMLHttpRequestBodyInit | null;
    const isFormData =
      typeof FormData !== "undefined" && body instanceof FormData;

    for (const [name, value] of headerEntries(init.headers)) {
      // Let the browser generate the multipart boundary. A Content-Type set by
      // hand here has no boundary parameter, and the server cannot parse it.
      if (isFormData && name.toLowerCase() === "content-type") continue;
      try {
        xhr.setRequestHeader(name, value);
      } catch {
        // Forbidden header names throw; fetch silently ignores them.
      }
    }

    const signal = init.signal ?? undefined;

    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };

    const onAbort = () => {
      xhr.abort();
    };

    if (signal) {
      if (signal.aborted) {
        reject(abortError());
        return;
      }
      signal.addEventListener("abort", onAbort, { once: true });
    }

    if (options.onUploadProgress) {
      // A zero tick up front so a retried attempt visibly restarts instead of
      // appearing frozen at the previous attempt's percentage.
      safeProgress(
        options.onUploadProgress,
        toProgress("upload", 0, undefined, false),
      );

      xhr.upload.addEventListener("progress", (event) => {
        safeProgress(
          options.onUploadProgress,
          toProgress(
            "upload",
            event.loaded,
            event.lengthComputable ? event.total : undefined,
            event.lengthComputable,
          ),
        );
      });
    }

    xhr.onload = () => {
      cleanup();

      const status = xhr.status;
      const responseBody = NULL_BODY_STATUS.has(status)
        ? null
        : (xhr.response as ArrayBuffer | null);

      try {
        resolve(
          new Response(responseBody, {
            status,
            // Browsers report "" for HTTP/2, where the reason phrase is gone.
            statusText: xhr.statusText || "",
            headers: parseHeaders(xhr.getAllResponseHeaders()),
          }),
        );
      } catch (err) {
        reject(err);
      }
    };

    xhr.onerror = () => {
      cleanup();
      // Matches what `fetch` throws for a failed request. The browser withholds
      // the cause for security reasons, so there is nothing more to report.
      reject(new TypeError("Network request failed"));
    };

    xhr.ontimeout = () => {
      cleanup();
      // Unreachable via this client (no `xhr.timeout` is set), but a stray
      // browser-level timeout must still settle the promise rather than hang.
      reject(new TypeError("Network request timed out"));
    };

    xhr.onabort = () => {
      cleanup();
      reject(abortError());
    };

    xhr.send(body as any);
  });
}

/** The rejection `fetch` produces for an aborted request. */
function abortError(): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException("The operation was aborted.", "AbortError");
  }
  const err = new Error("The operation was aborted.");
  err.name = "AbortError";
  return err;
}
