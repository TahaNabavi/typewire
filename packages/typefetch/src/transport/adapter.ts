import type {
  AnyEndpointDefZ,
  ErrorLike,
  HttpDriver,
  ProgressHandler,
  RequestOptions,
  RequestParts,
  ResponseType,
  TransportDescription,
  TransportKind,
} from '../types'

export type { TransportDescription }

/**
 * The transport seam
 * ==================
 * This is **public API**. Transports ship as separate packages so the core can
 * stay dependency-free, which means third-party code compiles against these
 * types — breaking them is a major, and `apiVersion` is the runtime half of that
 * promise.
 *
 * The seam sits *below* the middleware chain, not beside it. gRPC-for-the-web
 * and GraphQL-over-HTTP are both a POST with a body, so retry, auth, timeouts,
 * abort, mock mode, instrumentation and the middleware chain are all
 * transport-independent and stay in the client. Only four things vary, and they
 * are this interface.
 */

/** Seam version an adapter was compiled against. */
export const TRANSPORT_API_VERSION = 1

/**
 * What a wire can and cannot do.
 *
 * Declared rather than assumed so the client can *warn* when a request asks for
 * something the transport cannot deliver. Silently never calling a progress
 * handler reads as a hung upload — the same reasoning behind the existing
 * "no XMLHttpRequest here" warning.
 */
export type TransportCapabilities = {
  /** Can report request-body upload progress. */
  uploadProgress?: boolean
  /** Can report response-body download progress. */
  downloadProgress?: boolean
  /** Which `responseType` values mean anything. `undefined` means none do. */
  responseTypes?: readonly ResponseType[]
}

/** Everything an adapter is given about the request it is building. */
export type TransportContext = {
  endpoint: AnyEndpointDefZ
  /** Stable `"module.endpoint"` id; empty for a direct call. */
  endpointId: string
  /** The input, already validated against `endpoint.request`. */
  input: unknown
  /** The client's `baseUrl`. */
  baseUrl: string
  /**
   * The resolved auth token, present only when `endpoint.auth` is set. The
   * client resolves it (and fails the request when it is missing) so token
   * providers work identically everywhere; *applying* it is the transport's
   * job, because "an `Authorization` header" is not universal.
   */
  token?: string
  options?: RequestOptions
}

/** The wire request an adapter produced. */
export type TransportRequest = {
  url: string
  init: RequestInit
  /**
   * The request broken into parts for `MiddlewareContext.request`. Transports
   * without a path/query/body split report the whole message as `body` with
   * `isStructured: false`.
   */
  parts: RequestParts
}

/** A decoded success body. */
export type TransportDecoded = {
  /** The value the endpoint's `response` schema will validate. */
  value: unknown
  /**
   * Whether the client's `responseWrapper` / `useResponseTransform` pipeline
   * applies. False for anything that is not a JSON/text envelope — unwrapping a
   * `Blob`, or handing one to a transform written for records, would corrupt
   * exactly the payloads those response types exist for. Transports with their
   * own envelope (GraphQL's `data`/`errors`) also decline it.
   */
  enveloped: boolean
}

/** A wire failure, broken into the parts the client needs. */
export type TransportFailure = {
  /**
   * Fields for the `RichError`. Includes the transport's own key space:
   * `errorKey` is the key in the contract's `errors` map — an HTTP status, a
   * gRPC code, a GraphQL `extensions.code` — and `dataParsed` says whether the
   * body actually matched the schema declared for it.
   *
   * Returned as fields rather than a constructed error so the client stays the
   * one place that builds errors, and a `kind` cannot be forgotten.
   */
  error: Partial<ErrorLike> & { message: string }
  /** The raw parsed failure body, for the client's envelope check. */
  body: unknown
  /** Whether that body was JSON. */
  wasJson: boolean
  /** Whether the client's `responseWrapper` failure check applies. */
  enveloped: boolean
}

/** Options handed to a transport that provides its own terminal sender. */
export type TransportSendOptions = {
  onUploadProgress?: ProgressHandler
}

/**
 * TransportAdapter
 * ================
 * One wire. Registered explicitly at the setup site, so a REST-only app never
 * pays a byte for a transport it does not use.
 */
export interface TransportAdapter<K extends TransportKind = TransportKind> {
  /** The `transport` value this adapter serves. */
  readonly kind: K

  /**
   * The seam version this adapter was built against. The client refuses a
   * mismatch loudly at registration rather than failing strangely on the first
   * request.
   */
  readonly apiVersion: number

  readonly capabilities?: TransportCapabilities

  /**
   * Check one endpoint's contract, once, at `init()`. Throw with the endpoint id
   * in the message — a misconfigured route should fail at client construction,
   * never on the first call in production.
   */
  validate?(endpoint: AnyEndpointDefZ, endpointId: string): void

  /** Identify a route for tooling. @see {@link TransportDescription} */
  describe(endpoint: AnyEndpointDefZ): TransportDescription

  /**
   * Which terminal sender this endpoint wants, when the client is the one
   * sending. Ignored by a transport that supplies its own {@link send}.
   *
   * It exists so the client can honour a per-endpoint driver choice **without
   * reading a transport-specific field** — the same reason `describe` exists.
   * `driver` lives on the `http` registry entry, so only the http adapter has an
   * opinion; every other transport omits this and inherits `"auto"`.
   */
  resolveDriver?(endpoint: AnyEndpointDefZ): HttpDriver

  /** Parsed input → wire request. */
  build(ctx: TransportContext): TransportRequest

  /** 2xx response → the value `response` validates. */
  decode(res: Response, ctx: TransportContext): Promise<TransportDecoded>

  /** Failed response → the parts of a `RichError`. */
  fail(res: Response, ctx: TransportContext): Promise<TransportFailure>

  /**
   * Optional terminal sender, replacing the client's `fetch`/XHR. Only needed by
   * a wire that cannot be expressed as a single `fetch` call; everything that is
   * an HTTP POST should leave this alone and inherit abort, timeout and upload
   * progress for free.
   */
  send?(
    url: string,
    init: RequestInit,
    options: TransportSendOptions
  ): Promise<Response>
}
