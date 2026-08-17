/**
 * gRPC-web framing
 * ================
 * Only used on the binary path. Connect's JSON mode is a plain POST with a JSON
 * body and needs none of this — which is exactly why it is the default.
 *
 * A gRPC-web body is a sequence of length-prefixed frames:
 *
 * ```txt
 * ┌────────┬──────────────────┬──────────────┐
 * │ 1 byte │ 4 bytes (BE u32) │ payload      │
 * │ flags  │ length           │              │
 * └────────┴──────────────────┴──────────────┘
 * ```
 *
 * `flags & 0x80` marks the final **trailer** frame, whose payload is HTTP/1
 * style header text carrying `grpc-status` and `grpc-message`. The transport
 * owns this framing so that a codec only ever deals in message bytes — which is
 * what keeps protobuf out of every package published here.
 */

/** Set on the trailer frame's flag byte. */
const TRAILER_FLAG = 0x80;

const PREFIX_BYTES = 5;

export type GrpcFrame = {
  trailer: boolean;
  payload: Uint8Array;
};

/** Wrap message bytes in a data frame. */
export function encodeFrame(message: Uint8Array): Uint8Array {
  const framed = new Uint8Array(PREFIX_BYTES + message.length);
  const view = new DataView(framed.buffer);

  framed[0] = 0x00;
  view.setUint32(1, message.length, false);
  framed.set(message, PREFIX_BYTES);

  return framed;
}

/**
 * Split a response body into frames.
 *
 * A truncated final frame is dropped rather than throwing: the caller reports
 * "no trailer" (a `data_loss`), which names the actual problem better than a
 * bounds error would.
 */
export function decodeFrames(body: Uint8Array): GrpcFrame[] {
  const frames: GrpcFrame[] = [];
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  let offset = 0;

  while (offset + PREFIX_BYTES <= body.length) {
    const flags = body[offset]!;
    const length = view.getUint32(offset + 1, false);
    const start = offset + PREFIX_BYTES;
    const end = start + length;

    if (end > body.length) break;

    frames.push({
      trailer: (flags & TRAILER_FLAG) !== 0,
      payload: body.subarray(start, end),
    });

    offset = end;
  }

  return frames;
}

/**
 * Parse a trailer frame's header block.
 *
 * Names are lower-cased (HTTP header semantics) and `grpc-message` is
 * percent-decoded, since the spec requires servers to percent-encode anything
 * outside printable US-ASCII — without this a non-English error message arrives
 * as mojibake.
 */
export function parseTrailer(payload: Uint8Array): Record<string, string> {
  const text = new TextDecoder().decode(payload);
  const trailer: Record<string, string> = {};

  for (const line of text.split(/\r\n|\r|\n/)) {
    if (!line.trim()) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const name = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (!name) continue;

    trailer[name] = name === "grpc-message" ? safeDecode(value) : value;
  }

  return trailer;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // A server that percent-encoded badly should not cost us the message.
    return value;
  }
}

/**
 * Read the gRPC outcome from response headers.
 *
 * A "trailers-only" response — the common shape for a request rejected before
 * any message is produced, such as a failed auth interceptor — carries
 * `grpc-status` in the HTTP headers and has an empty body, so the trailer frame
 * never arrives.
 */
export function trailerFromHeaders(headers: Headers): Record<string, string> | undefined {
  const status = headers.get("grpc-status");
  if (status === null) return undefined;

  const trailer: Record<string, string> = { "grpc-status": status };
  const message = headers.get("grpc-message");
  if (message !== null) trailer["grpc-message"] = safeDecode(message);

  return trailer;
}
