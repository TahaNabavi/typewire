import { decodeFrames, encodeFrame, parseTrailer, trailerFromHeaders } from "../frames";

/** Build a trailer frame the way a grpc-web server does. */
function trailerFrame(text: string): Uint8Array {
  const payload = new TextEncoder().encode(text);
  const frame = new Uint8Array(5 + payload.length);
  const view = new DataView(frame.buffer);

  frame[0] = 0x80;
  view.setUint32(1, payload.length, false);
  frame.set(payload, 5);

  return frame;
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

describe("gRPC-web framing", () => {
  it("round-trips a message through a data frame", () => {
    const message = new Uint8Array([1, 2, 3, 4, 5]);
    const frames = decodeFrames(encodeFrame(message));

    expect(frames).toHaveLength(1);
    expect(frames[0]!.trailer).toBe(false);
    expect(Array.from(frames[0]!.payload)).toEqual([1, 2, 3, 4, 5]);
  });

  it("encodes the length as a big-endian u32", () => {
    const framed = encodeFrame(new Uint8Array(300));

    expect(framed[0]).toBe(0x00);
    // 300 = 0x0000012C
    expect(Array.from(framed.subarray(1, 5))).toEqual([0x00, 0x00, 0x01, 0x2c]);
  });

  it("separates a data frame from the trailer frame that follows it", () => {
    const body = concat(
      encodeFrame(new Uint8Array([9, 9])),
      trailerFrame("grpc-status: 0\r\n"),
    );

    const frames = decodeFrames(body);

    expect(frames).toHaveLength(2);
    expect(frames[0]!.trailer).toBe(false);
    expect(frames[1]!.trailer).toBe(true);
  });

  it("drops a truncated frame instead of reading out of bounds", () => {
    // A frame claiming 100 bytes but carrying 2: the caller reports the missing
    // trailer as data_loss, which names the problem better than a bounds error.
    const truncated = new Uint8Array([0x00, 0x00, 0x00, 0x00, 100, 1, 2]);

    expect(decodeFrames(truncated)).toEqual([]);
  });

  it("handles an empty body", () => {
    expect(decodeFrames(new Uint8Array(0))).toEqual([]);
  });

  it("parses a trailer block into lower-cased names", () => {
    const trailer = parseTrailer(
      new TextEncoder().encode("Grpc-Status: 5\r\nGrpc-Message: gone\r\n"),
    );

    expect(trailer["grpc-status"]).toBe("5");
    expect(trailer["grpc-message"]).toBe("gone");
  });

  it("percent-decodes grpc-message so a non-ASCII error is readable", () => {
    const trailer = parseTrailer(
      new TextEncoder().encode("grpc-status: 5\r\ngrpc-message: %DA%A9%D8%A7%D8%B1%D8%A8%D8%B1\r\n"),
    );

    expect(trailer["grpc-message"]).toBe("کاربر");
  });

  it("keeps a badly encoded message rather than losing it", () => {
    const trailer = parseTrailer(
      new TextEncoder().encode("grpc-status: 2\r\ngrpc-message: 100%\r\n"),
    );

    expect(trailer["grpc-message"]).toBe("100%");
  });

  it("reads a trailers-only response from the HTTP headers", () => {
    // The shape a request rejected by an auth interceptor takes: status in the
    // headers, empty body, no trailer frame ever sent.
    const headers = new Headers({
      "grpc-status": "16",
      "grpc-message": "missing token",
    });

    expect(trailerFromHeaders(headers)).toEqual({
      "grpc-status": "16",
      "grpc-message": "missing token",
    });
  });

  it("returns undefined when the headers carry no gRPC status", () => {
    expect(trailerFromHeaders(new Headers({ "content-type": "application/json" }))).toBeUndefined();
  });
});
