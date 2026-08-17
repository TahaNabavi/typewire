import { InternalServerErrorException, StreamableFile } from "@nestjs/common";
import type { EndpointDefZ, ResponseType } from "@tahanabavi/typefetch";
import type { Readable } from "stream";

/**
 * Serving a contract's `responseType`
 * ===================================
 * typefetch endpoints declare how a success body is decoded — `"json"` by
 * default, but also `"text"`, `"blob"`, `"arrayBuffer"`, `"formData"`, `"file"`,
 * `"stream"` and `"response"`. The client validates the *decoded* value against
 * `response`, which is why the type is on the contract rather than the call.
 *
 * The server side of that promise is this file, and it has two halves:
 *
 * 1. **What can still be validated.** `zBlob()` matches a `Blob`, `zFile()` a
 *    `{ blob, filename, … }` — values that exist in the *browser*, after
 *    decoding. A handler returns a `Buffer` or a `Readable`, so running
 *    `endpoint.response.safeParse()` over it would fail every time. Only
 *    `"json"` and `"text"` describe a value the server actually holds.
 * 2. **What has to be sent for the decode to work at all.** A `Buffer` handed
 *    to Nest is JSON-serialised into `{"type":"Buffer","data":[…]}`, and
 *    `responseType: "file"` reads its filename from `Content-Disposition` — a
 *    header nobody sets by accident, and one that is invisible cross-origin
 *    unless it is also listed in `Access-Control-Expose-Headers`.
 */

/** The response types whose value is a browser artifact, not a server one. */
const OPAQUE_RESPONSE_TYPES = new Set<ResponseType>([
  "blob",
  "arrayBuffer",
  "formData",
  "file",
  "stream",
  "response",
]);

/** Response types that must be sent as bytes rather than serialised. */
const BINARY_RESPONSE_TYPES = new Set<ResponseType>([
  "blob",
  "arrayBuffer",
  "formData",
  "file",
  "stream",
]);

/**
 * Headers a cross-origin client needs to see for a contract response to decode
 * fully. Both are readable same-origin and **hidden by default** cross-origin:
 * without `Content-Disposition` a `responseType: "file"` download loses its
 * `filename`, and without `Content-Length` a download-progress bar can never
 * report a percentage and has to fall back to an indeterminate spinner.
 *
 * Pass it to your CORS setup, which is the only place that can grant it:
 *
 * ```ts
 * app.enableCors({ exposedHeaders: [...CONTRACT_EXPOSED_HEADERS] });
 * ```
 */
export const CONTRACT_EXPOSED_HEADERS = [
  "Content-Disposition",
  "Content-Length",
] as const;

const CONTRACT_FILE = Symbol.for("typewire:contractFile");

/** What a handler may hand to {@link contractFile}. */
export type ContractFileBody = Buffer | Uint8Array | ArrayBuffer | Readable;

export type ContractFileOptions = {
  /**
   * The download name. Sent in both RFC 6266 spellings, so a client reading
   * either gets the same value and a non-ASCII name survives the trip.
   */
  filename?: string;
  /** Defaults to `application/octet-stream`. */
  contentType?: string;
  /**
   * Byte length, for streams. Buffers report their own, and sending it is what
   * makes the client's download progress `lengthComputable` instead of an
   * indeterminate spinner.
   */
  length?: number;
  /**
   * `"attachment"` (default) prompts a download; `"inline"` renders in place.
   * Only meaningful alongside `filename`.
   */
  disposition?: "attachment" | "inline";
};

/** The marker a handler returns for a non-JSON contract response. */
export type ContractFileResponse = {
  readonly [CONTRACT_FILE]: true;
  readonly body: ContractFileBody;
  readonly options: ContractFileOptions;
};

/**
 * Return bytes from a handler bound to a non-JSON `responseType`, together with
 * the metadata the client decodes from headers.
 *
 * ```ts
 * ⁣@TypeFetchEndpoint(contracts.report.download)  // responseType: "file"
 * download() {
 *   return contractFile(await render(), {
 *     filename: "report.pdf",
 *     contentType: "application/pdf",
 *   });
 * }
 * ```
 *
 * A bare `Buffer`/`Readable` works too and is sent with no filename — this
 * exists for the case where the name and type matter, which is every case where
 * the contract said `"file"` rather than `"blob"`.
 */
export function contractFile(
  body: ContractFileBody,
  options: ContractFileOptions = {},
): ContractFileResponse {
  return { [CONTRACT_FILE]: true, body, options };
}

export function isContractFile(value: unknown): value is ContractFileResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<symbol, unknown>)[CONTRACT_FILE] === true
  );
}

export function responseTypeOf(endpoint: EndpointDefZ): ResponseType {
  return endpoint.responseType ?? "json";
}

/**
 * Whether the handler's return value can meaningfully be checked against the
 * contract's `response` schema. See the file header: only `"json"` and `"text"`
 * describe a value that exists on this side of the wire.
 */
export function validatesResponse(endpoint: EndpointDefZ): boolean {
  return !OPAQUE_RESPONSE_TYPES.has(responseTypeOf(endpoint));
}

/**
 * Turn a handler's return value into what the platform must actually send for
 * the contract's `responseType` to decode on the other end.
 *
 * `undefined` always passes through untouched: that is what a handler returns
 * when it took over the response itself with `@Res()`, and second-guessing it
 * would break the escape hatch `responseType: "response"` exists to provide.
 */
export function shapeContractResponse(
  endpoint: EndpointDefZ,
  value: unknown,
  response: unknown,
): unknown {
  const responseType = responseTypeOf(endpoint);

  if (value === undefined) return value;

  if (responseType === "text") {
    // Express answers a string with `text/html`, which is both wrong and a
    // stored-XSS foot-gun the moment the string came from user input.
    setHeaderIfAbsent(response, "Content-Type", "text/plain; charset=utf-8");
    return value;
  }

  // `"response"` hands the whole `Response` to the caller: the contract has
  // deliberately said nothing about the body, so neither does this.
  if (!BINARY_RESPONSE_TYPES.has(responseType)) return value;

  const file = isContractFile(value)
    ? value
    : isBinary(value)
      ? contractFile(value as ContractFileBody)
      : undefined;

  if (!file) {
    throw new InternalServerErrorException({
      message:
        `Endpoint declares responseType: "${responseType}" but the handler ` +
        `returned ${describeValue(value)}. Return a Buffer, a Readable, or ` +
        `contractFile(body, { filename, contentType }).`,
      code: "RESPONSE_TYPE_MISMATCH",
    });
  }

  exposeContractHeaders(response);

  const body = normalizeBody(file.body);

  return new StreamableFile(body as Uint8Array & Readable, {
    type: file.options.contentType ?? defaultContentType(responseType),
    length: file.options.length ?? byteLengthOf(body),
    ...(file.options.filename
      ? {
          disposition: contentDisposition(
            file.options.filename,
            file.options.disposition ?? "attachment",
          ),
        }
      : {}),
  });
}

/** `StreamableFile` takes bytes or a stream; an `ArrayBuffer` is neither. */
function normalizeBody(body: ContractFileBody): Uint8Array | Readable {
  return body instanceof ArrayBuffer
    ? new Uint8Array(body)
    : (body as Uint8Array | Readable);
}

/**
 * Build a `Content-Disposition` carrying both RFC 6266 spellings.
 *
 * The plain `filename=` is the ASCII fallback; `filename*=UTF-8''…` is what
 * survives a non-ASCII name, and it is the one typefetch prefers when reading.
 * Quotes and control characters are stripped from the fallback rather than
 * escaped — a filename is attacker-influenced in any app where one user
 * downloads what another uploaded, and a stray `"` there would let it inject a
 * header parameter.
 */
export function contentDisposition(
  filename: string,
  type: "attachment" | "inline",
): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  // Keep printable ASCII only, minus the two characters that would let a
  // filename close the quoted parameter and inject one of its own. The
  // extended form below carries the real name, so nothing is lost.
  const ascii = Array.from(base)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code >= 0x20 && code <= 0x7e && code !== 0x22 && code !== 0x5c;
    })
    .join("")
    .trim();
  const fallback = ascii || "download";

  return (
    `${type}; filename="${fallback}"; ` +
    `filename*=UTF-8''${encodeURIComponent(base)}`
  );
}

/** `blob`/`file`/`stream` carry no declared media type; octet-stream is the honest default. */
function defaultContentType(responseType: ResponseType): string {
  return responseType === "formData"
    ? "multipart/form-data"
    : "application/octet-stream";
}

function isBinary(value: unknown): boolean {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return true;
  if (value instanceof Uint8Array) return true;
  return isReadable(value);
}

function isReadable(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { pipe?: unknown }).pipe === "function" &&
    typeof (value as { read?: unknown }).read === "function"
  );
}

function byteLengthOf(body: ContractFileBody): number | undefined {
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) return body.length;
  if (body instanceof Uint8Array) return body.byteLength;
  // A stream's length is unknowable here; the caller supplies it or the client
  // falls back to an indeterminate progress indicator.
  return undefined;
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  const type = typeof value;
  return type === "object"
    ? `a plain ${(value as object).constructor?.name ?? "object"}`
    : `a ${type}`;
}

function setHeaderIfAbsent(response: any, name: string, value: string): void {
  if (!response || typeof response.setHeader !== "function") return;
  if (typeof response.getHeader === "function" && response.getHeader(name)) {
    return;
  }
  try {
    response.setHeader(name, value);
  } catch {
    /* headers already sent — the handler owns the response */
  }
}

/**
 * Append this package's headers to `Access-Control-Expose-Headers` rather than
 * replacing it, so an app's own CORS configuration survives. Same-origin the
 * header is inert, which is why it is safe to set unconditionally.
 */
function exposeContractHeaders(response: any): void {
  if (!response || typeof response.setHeader !== "function") return;

  const header = "Access-Control-Expose-Headers";
  const current =
    typeof response.getHeader === "function" ? response.getHeader(header) : "";

  const existing = String(current ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  const merged = [...existing];
  for (const name of CONTRACT_EXPOSED_HEADERS) {
    if (!merged.some((value) => value.toLowerCase() === name.toLowerCase())) {
      merged.push(name);
    }
  }

  try {
    response.setHeader(header, merged.join(", "));
  } catch {
    /* headers already sent — the handler owns the response */
  }
}
