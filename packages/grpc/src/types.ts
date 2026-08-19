/**
 * gRPC endpoint fields
 * ====================
 * Registered into typefetch's open `TransportRegistry` by the augmentation
 * below, so `transport: "grpc"` does not compile until this package is a
 * dependency — and once it is, a gRPC route is fully checked, including that it
 * may not carry `path`, `method`, `bodyType` or `responseType`. None of those
 * mean anything here: a unary RPC is one message in and one message out.
 */
export type GrpcEndpointFields = {
  /** Fully-qualified service name, e.g. `"user.v1.UserService"`. */
  service: string;

  /** The method name as declared in the service, e.g. `"GetUser"`. */
  rpc: string;

  /**
   * Server-side deadline in milliseconds, sent as `Connect-Timeout-Ms` /
   * `grpc-timeout`.
   *
   * Distinct from `RequestOptions.timeout`, which aborts locally: a deadline
   * asks the *server* to stop working, which is what stops an abandoned query
   * from holding a database connection. Setting both is normal — the local
   * timeout should be the more generous of the two.
   */
  deadlineMs?: number;

  /**
   * Send this RPC as binary protobuf rather than Connect JSON.
   *
   * The codec is supplied by whatever generator the team already runs, so no
   * protobuf runtime enters any package published here. The transport owns the
   * framing and the trailers; the codec owns only message bytes.
   */
  codec?: GrpcCodec;
};

/**
 * GrpcCodec
 * =========
 * The seam that keeps protobuf out of this package.
 *
 * Message bytes in, message bytes out — the length-prefixed framing, the trailer
 * frame and the status handling all stay on this side of the boundary, because
 * they are protocol rather than schema. Pair it with the endpoint's Zod
 * `response`, which still validates whatever `decode` returns.
 */
export type GrpcCodec<TIn = any, TOut = any> = {
  /** Defaults to `"application/grpc-web+proto"`. */
  contentType?: string;
  encode(message: TIn): Uint8Array;
  decode(bytes: Uint8Array): TOut;
};

declare module "@tahanabavi/typefetch" {
  interface TransportRegistry {
    grpc: GrpcEndpointFields;
  }
}

/** A Connect error body, as sent for any non-2xx on the JSON path. */
export type ConnectErrorBody = {
  code?: string | number;
  message?: string;
  details?: unknown[];
};

export type GrpcTransportConfig = {
  /**
   * Base URL for RPC paths. Defaults to the client's `baseUrl`.
   *
   * Worth setting when gRPC lives behind a different host than the REST API —
   * the usual shape, since binary grpc-web generally needs a proxy in front of
   * it.
   */
  baseUrl?: string;

  /**
   * Default codec for every RPC, overridable per endpoint. Leave unset for
   * Connect JSON, which is curl-able and needs no generated code.
   */
  codec?: GrpcCodec;

  /** Default deadline for endpoints that do not declare one. */
  deadlineMs?: number;

  /** Extra headers (gRPC metadata) on every RPC. */
  headers?: Record<string, string>;
};
