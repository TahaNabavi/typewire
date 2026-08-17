// Import "zod" for schema-based runtime validation of request and response data
import { z } from "zod";

export type EncryptionMethod = "AES" | "DES" | "RSA" | "Base64" | "Custom";
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * ResponseType
 * ============
 * How a successful (2xx) response body is decoded before it reaches the
 * endpoint's `response` schema. Declared on the contract rather than per call,
 * because the decoded value is what `response` validates — a per-call override
 * would silently invalidate the endpoint's inferred return type.
 *
 * - `"json"` (default) — `res.json()`. Unchanged legacy behavior.
 * - `"text"` — `res.text()`.
 * - `"blob"` — `res.blob()`.
 * - `"arrayBuffer"` — `res.arrayBuffer()`.
 * - `"formData"` — `res.formData()`.
 * - `"file"` — a {@link TypeFetchFile}: the blob plus the filename parsed from
 *   `Content-Disposition`, the content type, and the size.
 * - `"stream"` — the raw `res.body` (`ReadableStream | null`), undecoded.
 * - `"response"` — the whole `Response`, untouched. The escape hatch for SSE
 *   and anything else that needs the headers or manual stream handling.
 *
 * Only `"json"` and `"text"` pass through the client's `responseWrapper` and
 * `useResponseTransform` — an envelope wrapped around a `Blob` is meaningless.
 * Every type is still validated by the endpoint's `response` schema; see the
 * `zBlob()` / `zFile()` / `zStream()` helpers in `schemas.ts`.
 *
 * Error (non-2xx) responses ignore this entirely: they are always read as text
 * and parsed as JSON when possible, whatever the declared success type is.
 */
export type ResponseType =
  | "json"
  | "text"
  | "blob"
  | "arrayBuffer"
  | "formData"
  | "file"
  | "stream"
  | "response";

/**
 * TypeFetchFile
 * =============
 * What a `responseType: "file"` endpoint resolves to — the download plus the
 * metadata callers otherwise re-derive by hand from the response headers.
 *
 * `filename` is parsed from `Content-Disposition`, preferring the RFC 5987
 * `filename*` form over plain `filename`. It is `undefined` when the header is
 * absent — including the common cross-origin case where the server did not send
 * `Access-Control-Expose-Headers: Content-Disposition`, which makes the header
 * invisible to the client even though it was sent.
 */
export type TypeFetchFile = {
  blob: Blob;
  /** From `Content-Disposition`; `undefined` when absent or CORS-hidden. */
  filename?: string;
  /** From `Content-Type`; `undefined` when absent. */
  contentType?: string;
  /** `blob.size` — the decoded byte length. */
  size: number;
};

/**
 * TransferProgress
 * ================
 * One progress tick for a request body being uploaded or a response body being
 * downloaded.
 *
 * Deliberately *not* named `ProgressEvent`: that is a DOM global, and shadowing
 * it in a package consumers `export *` from would break unrelated code.
 *
 * `total` and `percent` are only present when the length is known
 * (`lengthComputable`). For downloads that means the server sent
 * `Content-Length` **and**, cross-origin, exposed it via
 * `Access-Control-Expose-Headers` — otherwise only `loaded` is meaningful and a
 * UI should fall back to an indeterminate indicator.
 */
export type TransferProgress = {
  /** Which half of the exchange this tick describes. */
  phase: "upload" | "download";
  /** Bytes transferred so far. */
  loaded: number;
  /** Total bytes, when known. */
  total?: number;
  /** `0`–`100`, rounded to two decimals, when known. */
  percent?: number;
  /** Whether `total`/`percent` are present. */
  lengthComputable: boolean;
};

/** Receives each {@link TransferProgress} tick. Never throws into the request. */
export type ProgressHandler = (progress: TransferProgress) => void;

/**
 * DeepEncryptionMap<T>
 * --------------------
 * Recursively describes which fields should be encrypted/decrypted.
 * Supports:
 *   - Primitive fields → boolean | method
 *   - Objects → recursively typed maps
 *   - Arrays → mapping applies to element type (U)
 *   - Array-map override (optional but supported)
 */
export type DeepEncryptionMap =
  | boolean
  | EncryptionMethod
  | {
      [key: string]: DeepEncryptionMap;
    }
  | DeepEncryptionMap[];

/**
 * EncryptionConfig
 * ================
 * Defines the encryption/decryption strategy for an endpoint.
 * Both request and response maps are strictly typed based on their respective Zod schemas.
 */

export type EncryptionConfig<TReq, TRes> = {
  method:
    | EncryptionMethod
    | {
        request?: EncryptionMethod;
        response?: EncryptionMethod;
      };
  /** Map of request fields to encrypt before sending to the server */
  request?: DeepEncryptionMap;
  /** Map of response fields to decrypt after receiving from the server */
  response?: DeepEncryptionMap;
};

/**
 * Base types for Zod schemas representing request and response structures.
 * These are abstract—each concrete endpoint will define its own Zod object for these.
 */
export type RequestSchema = z.ZodTypeAny;
export type ResponseSchema = z.ZodTypeAny;

/**
 * A permission requirement a contract endpoint may carry inline (the optional
 * `permission` key on {@link EndpointDef}).
 *
 * Redeclared structurally here — rather than imported from
 * `@tahanabavi/type-permission` — so typefetch stays dependency-free, exactly as
 * `type-devtools-core` redeclares the transport event types. It is structurally
 * identical to that package's `PermissionRequirement`, so
 * `P.authorize(perms, endpoint.permission)` type-checks with no adapter.
 */
export type PermissionRequirement = {
  /** All of these flags must be held (`hasAll`). */
  require?: readonly string[];
  /** At least one of these flags must be held (`hasAny`). */
  any?: readonly string[];
  /** Human reason, surfaced in the 403 body and the audit log. */
  reason?: string;
};

/**
 * ErrorResponsesMap
 * =================
 * Optional map of declared error responses for an endpoint. Each value is a Zod
 * schema describing that key's error body.
 *
 * **The key space belongs to the endpoint's transport**, which is unambiguous
 * because an endpoint has exactly one:
 *
 * - `http` — the HTTP status code (`404`). Maps 1:1 to OpenAPI `responses`.
 * - `grpc` — the gRPC status code (`5` for `NOT_FOUND`).
 * - `graphql` — the `extensions.code` string (`"UNAUTHENTICATED"`).
 *
 * String keys are why this is `number | string` rather than the `number` it was
 * before transports became pluggable; `Record<number, …>` remains assignable, so
 * every existing contract is unaffected.
 *
 * If a single key can carry multiple distinct bodies, the schema value itself
 * can be a `z.discriminatedUnion(...)`.
 */
export type ErrorResponsesMap = Record<number | string, z.ZodTypeAny>;

/**
 * ErrorKind
 * =========
 * The **normalized** failure taxonomy, shared by every transport.
 *
 * The whole point of one client over several wires is that application code
 * stops caring which wire it is on. That fails immediately if "not found" is
 * `404` here, `5` there and `"NOT_FOUND"` somewhere else — so every failure is
 * also classified into one of these, and a global handler ("redirect on
 * `unauthenticated`") works identically for all of them.
 *
 * The gRPC status set is the canonical taxonomy: it is the best-designed of the
 * three, and both HTTP status codes and GraphQL `extensions.code` map onto it
 * cleanly. `network` and `validation` are added for failures that never reached
 * a server or never left the client.
 *
 * `RichError.data` remains the transport-specific, contract-typed body — this
 * is the coarse classification above it, not a replacement for it.
 */
export type ErrorKind =
  | "cancelled"
  | "invalid_argument"
  | "deadline_exceeded"
  | "not_found"
  | "already_exists"
  | "permission_denied"
  | "unauthenticated"
  | "resource_exhausted"
  | "failed_precondition"
  | "aborted"
  | "out_of_range"
  | "unimplemented"
  | "internal"
  | "unavailable"
  | "data_loss"
  /** The request never reached a server (DNS, TLS, offline, CORS preflight). */
  | "network"
  /** Input or output failed its own contract schema. */
  | "validation"
  | "unknown";

/**
 * EndpointTestContext
 * ===================
 * Shared runtime state used by the API test runner.
 * It allows one endpoint test to store values that later tests can reuse.
 */
export type EndpointTestContext = {
  data: Record<string, unknown>;
  get<T = unknown>(key: string): T | undefined;
  set<T = unknown>(key: string, value: T): void;
  has(key: string): boolean;
};

export type EndpointTestInputFactory<TReq> = (
  ctx: EndpointTestContext,
) => TReq | Promise<TReq>;

export type EndpointTestAssertion<TReq, TRes> = (result: {
  input: TReq;
  response: TRes;
  ctx: EndpointTestContext;
}) => void | Promise<void>;

export type EndpointTestCase<TReq, TRes> = {
  /** Human-readable name shown in the generated report. */
  name?: string;
  /** Static input or a factory that can read/write shared test context. */
  input?: TReq | EndpointTestInputFactory<TReq>;
  /** Skip this specific case. A string is used as the skip reason. */
  skip?: boolean | string;
  /** Expected HTTP status. Defaults to any successful client response. */
  expectStatus?: number | number[];
  /** Optional user-defined assertion after a successful response. */
  expect?: EndpointTestAssertion<TReq, TRes>;
  /** Per-case timeout in milliseconds. */
  timeout?: number;
  /** Tags used by the runner for include/exclude filtering. */
  tags?: string[];
};

export type EndpointTestConfig<TReq, TRes> = {
  /** Disable all generated/manual tests for this endpoint. */
  enabled?: boolean;
  /** Tags used by the runner for include/exclude filtering. */
  tags?: string[];
  /** Mark endpoints such as DELETE/reset/payment as unsafe for default runs. */
  destructive?: boolean;
  /** Default input used when cases are not provided. */
  input?: TReq | EndpointTestInputFactory<TReq>;
  /** One or more test cases for this endpoint. */
  cases?: Array<EndpointTestCase<TReq, TRes>>;
  /** Runs before the endpoint cases. */
  setup?: (ctx: EndpointTestContext) => void | Promise<void>;
  /** Runs after the endpoint cases. */
  teardown?: (ctx: EndpointTestContext) => void | Promise<void>;
};

/**
 * EndpointBase
 * ============
 * Everything a **single API endpoint** declares that has nothing to do with the
 * wire it travels over: schemas, auth, permission, mocks, encryption, headers
 * and contract tests.
 *
 * Kept separate from the transport-specific fields so a capability added later
 * lands in one place for every transport at once, rather than being copied into
 * each variant and drifting.
 */
export type EndpointBase<
  TReq extends RequestSchema,
  TRes extends ResponseSchema,
  TErr extends ErrorResponsesMap = {},
> = {
  /** Whether this endpoint requires an Authorization token */
  auth?: boolean;

  /**
   * Optional permission requirement, written once on the contract. A server
   * guard (`@tahanabavi/typewire-nestjs`) reads it to enforce access and reject
   * with a 403; the client can read it to pre-block a call before it leaves.
   * Purely additive — endpoints without it behave exactly as before. Flag names
   * reference a `@tahanabavi/type-permission` bit map.
   */
  permission?: PermissionRequirement;

  /** Zod schema describing the expected request structure */
  request: TReq; // Typically { path?, query?, body? }

  /** Zod schema describing the expected (success / 2xx) response structure */
  response: TRes;

  /**
   * Optional map of error response schemas, keyed by this endpoint's transport
   * key space — HTTP status for `http`, gRPC code for `grpc`, `extensions.code`
   * for `graphql`, e.g. `{ 404: schema, 409: schema }`. Purely additive:
   * endpoints without `errors` behave exactly as before.
   *
   * Used by the client to parse and TYPE a failed request's body (see
   * `RichError.data` and `isContractError`), and by external tools (such as
   * `@tahanabavi/typefetch-nestjs`) to document/validate error responses.
   *
   * @see {@link ErrorResponsesMap}
   */
  errors?: TErr;

  /**
   * Mock data support — enables quick testing or local dev mode:
   * - Either a function returning a mock response object
   * - Or a static mock response object
   */
  mockData?: (() => z.infer<TRes>) | z.infer<TRes>;

  /**
   * Field-level encryption configuration.
   * Allows selecting specific fields in request/response to be encrypted/decrypted.
   */
  encryption?: EncryptionConfig<z.infer<TReq>, z.infer<TRes>>;

  /**
   * Optional custom headers. Can be:
   * - A fixed record of header key/values
   * - A function returning headers derived from the input data
   */
  headers?:
    | Record<string, string>
    | ((input: z.infer<TReq>) => Record<string, string>);

  /**
   * Optional contract-driven tests used by the TypeFetch test runner.
   */
  test?: EndpointTestConfig<z.infer<TReq>, z.infer<TRes>>;
};

/**
 * TransportRegistry
 * =================
 * The set of wires an endpoint may be declared for, and the addressing fields
 * each one requires. `http` is built in; every other transport is added by
 * **installing its package**, which augments this interface by declaration
 * merging:
 *
 * ```ts
 * // @tahanabavi/typefetch-grpc
 * declare module "@tahanabavi/typefetch" {
 *   interface TransportRegistry {
 *     grpc: { service: string; rpc: string; deadlineMs?: number };
 *   }
 * }
 * ```
 *
 * It is an open `interface` rather than a closed union on purpose. Transports
 * ship as separate packages so the core can stay dependency-free, and a closed
 * union would force this file to name fields that live in packages it must
 * never import. The consequence is the good one: `transport: "grpc"` does not
 * compile until `@tahanabavi/typefetch-grpc` is a dependency, and once it is,
 * the route is fully type-checked — including that it may not carry `path`.
 *
 * Because the registry is open, **the core never reads a transport-specific
 * field**. Anything that needs to describe a route asks its adapter.
 */
export interface TransportRegistry {
  http: HttpEndpointFields;
}

/**
 * The addressing and wire-format fields an `http` endpoint declares. These are
 * exactly the keys that stop making sense on another transport: a gRPC call has
 * no path template and no `form-data`, and a GraphQL response is never a `Blob`.
 */
export type HttpEndpointFields = {
  /** HTTP method used by this endpoint */
  method: Method;

  /** URL path for this endpoint, e.g. "/users/:id" */
  path: string;

  /**
   * How the success body is decoded before `response` validates it.
   * Defaults to `"json"` — omitting it preserves the original behavior exactly.
   *
   * Pair it with the matching schema helper so validation stays honest:
   * `responseType: "blob"` with `response: zBlob()`, `"file"` with `zFile()`.
   *
   * @see {@link ResponseType}
   */
  responseType?: ResponseType;

  /**
   * Defines how the request body should be sent:
   * - `"json"` (default): serialized as JSON
   * - `"form-data"`: multipart form
   */
  bodyType?: "json" | "form-data";

  /**
   * Which terminal sender carries this endpoint's requests.
   *
   * Declared on the contract rather than per call because it is a property of
   * the endpoint's environment, not of one invocation — an upload route that
   * needs XHR needs it every time.
   *
   * @see {@link HttpDriver}
   */
  driver?: HttpDriver;
};

/**
 * HttpDriver
 * ==========
 * How an http request reaches the network.
 *
 * - `"auto"` (default) — `fetch`, switching to `XMLHttpRequest` only for a
 *   request that asked for upload progress. Unchanged legacy behaviour.
 * - `"fetch"` — always `fetch`. Pins the modern path where a proxy or polyfill
 *   makes the XHR swap undesirable; upload progress then cannot be reported and
 *   the client warns rather than going quiet.
 * - `"xhr"` — always `XMLHttpRequest` where it exists. The escape hatch for
 *   environments whose `fetch` is broken or instrumented, and the way to get
 *   upload progress without threading a handler through every call site. Falls
 *   back to `fetch` with a warning where XHR does not exist (Node, most SSR).
 *
 * Note what `"xhr"` costs: XHR has no equivalent for `cache`, `mode`,
 * `redirect`, `referrerPolicy`, `integrity` or `duplex`, so those `RequestInit`
 * fields are dropped rather than silently misapplied.
 */
export type HttpDriver = "auto" | "fetch" | "xhr";

/** Every transport currently installed, as a string union. */
export type TransportKind = keyof TransportRegistry & string;

/**
 * The discriminant an endpoint carries for transport `K`.
 *
 * `http` is optional so that **omitting `transport` means HTTP** — which is what
 * keeps every contract written before transports existed compiling and behaving
 * byte-for-byte the same.
 */
export type TransportDiscriminant<K extends TransportKind> = K extends "http"
  ? { transport?: "http" }
  : { transport: K };

/**
 * EndpointFor
 * ===========
 * A single endpoint declared for one specific transport: the shared
 * {@link EndpointBase}, plus that transport's addressing fields, plus its
 * discriminant.
 */
export type EndpointFor<
  K extends TransportKind,
  TReq extends RequestSchema,
  TRes extends ResponseSchema,
  TErr extends ErrorResponsesMap = {},
> = EndpointBase<TReq, TRes, TErr> &
  TransportRegistry[K] &
  TransportDiscriminant<K>;

/**
 * EndpointDef
 * ============
 * An HTTP endpoint — unchanged in name and in meaning. Contracts written before
 * transports were pluggable resolve to exactly this type, so nothing about them
 * moves.
 *
 * Use {@link AnyEndpointDef} for code that must accept an endpoint on **any**
 * transport.
 */
export type EndpointDef<
  TReq extends RequestSchema,
  TRes extends ResponseSchema,
  TErr extends ErrorResponsesMap = {},
> = EndpointFor<"http", TReq, TRes, TErr>;

/**
 * AnyEndpointDef
 * ==============
 * An endpoint on any installed transport. This grows automatically as adapter
 * packages augment {@link TransportRegistry} — with only the built-in `http`
 * transport installed it is identical to {@link EndpointDef}.
 */
export type AnyEndpointDef<
  TReq extends RequestSchema,
  TRes extends ResponseSchema,
  TErr extends ErrorResponsesMap = {},
> = {
  [K in TransportKind]: EndpointFor<K, TReq, TRes, TErr>;
}[TransportKind];

/**
 * Contracts
 * =========
 * A collection of modules, each containing one or more endpoints.
 * This defines a **hierarchical API contract**.
 *
 * For example:
 * {
 *   users: {
 *     getUser: EndpointDef(...),
 *     updateUser: EndpointDef(...)
 *   },
 *   posts: {
 *     createPost: EndpointDef(...),
 *     listPosts: EndpointDef(...)
 *   }
 * }
 */
export type Contracts = {
  [ModuleName: string]: {
    [EndpointName: string]: AnyEndpointDef<RequestSchema, ResponseSchema>;
  };
};

/**
 * Convenience alias that pins the generic types
 * to `z.ZodTypeAny`, simplifying the contract declarations.
 *
 * Kept permissive (`errors` typed as the open `ErrorResponsesMap`) so
 * `Contracts` still accepts any endpoint, with or without declared `errors`.
 */
export type EndpointDefZ = EndpointDef<
  RequestSchema,
  ResponseSchema,
  ErrorResponsesMap
>;

/**
 * The {@link EndpointDefZ} equivalent for an endpoint on any installed
 * transport. This is what generic machinery — the client, tooling, adapters —
 * accepts, so it keeps working when a transport package is added.
 */
export type AnyEndpointDefZ = AnyEndpointDef<
  RequestSchema,
  ResponseSchema,
  ErrorResponsesMap
>;

/**
 * InferErrors<E>
 * ==============
 * Infers `{ [key]: <body type> }` for an endpoint's declared error responses.
 * Resolves to `{}` when the endpoint declares no `errors`. The key space is the
 * endpoint's transport's — see {@link ErrorResponsesMap}.
 */
export type InferErrors<E> = E extends {
  errors: infer M extends ErrorResponsesMap;
}
  ? { [S in keyof M]: z.infer<M[S]> }
  : {};

/**
 * InferError<E, S>
 * ================
 * Infers the error body type of a single error key `S` for an endpoint.
 * Resolves to `never` when the endpoint declares no `errors` for that key.
 *
 * `S` allows strings as well as numbers because a transport's key space may be
 * either — an HTTP status (`404`) or a GraphQL `extensions.code`
 * (`"UNAUTHENTICATED"`).
 */
export type InferError<E, S extends number | string> = E extends {
  errors: infer M extends ErrorResponsesMap;
}
  ? S extends keyof M
    ? z.infer<M[S]>
    : never
  : never;

/**
 * Context passed to all middleware functions.
 * Contains the current request URL, initialization object,
 * and the specific endpoint definition for metadata access.
 */
export type RequestParts = {
  path?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: unknown;
  headers: Record<string, string>;
  isStructured: boolean;
  rawInput?: unknown;
};

/**
 * How a route identifies itself, as its transport describes it.
 *
 * The transport registry is open, so the core can never read a
 * transport-specific field — `endpoint.method` does not exist on every variant.
 * Anything that needs to name a route (a CLI listing, a permission denial's
 * audit payload, a devtools row) reads this instead, and keeps working for
 * transports written after it shipped.
 */
export type TransportDescription = {
  /** Wire family, for display: `"HTTP"`, `"gRPC"`, `"GraphQL"`. */
  protocol: string;
  /** The operation within it: `"GET"`, `"unary"`, `"query"`. */
  operation: string;
  /** What it addresses: `"/users/:id"`, `"user.v1.UserService/GetUser"`. */
  target: string;
};

export interface MiddlewareContext<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
> {
  url: string;
  init: RequestInit;
  /**
   * The route as its transport describes it, plus which transport that was.
   *
   * Optional because middleware is routinely constructed by hand in tests, and
   * because a middleware that only needs the wire method or URL should read
   * `ctx.init.method` and `ctx.url` — both populated on every transport.
   */
  route?: TransportDescription & { transport: string };
  /**
   * The contract definition, on whatever transport it was declared for.
   *
   * Reading a transport-specific field (`endpoint.method`, `endpoint.path`)
   * requires narrowing on `endpoint.transport` once a non-HTTP transport package
   * is installed, because those fields do not exist on every variant. Middleware
   * that only needs the wire method or URL should read `ctx.init.method` and
   * `ctx.url`, which are populated for every transport.
   */
  endpoint: AnyEndpointDef<TReq, TRes>;
  request?: RequestParts;
}

/**
 * The `next()` function type signature used inside middleware.
 * When called, it executes the next function in the chain
 * or finally performs the fetch request.
 */
export type MiddlewareNext = () => Promise<Response>;

/**
 * Middleware
 * ==========
 * Defines the standard structure for a request middleware.
 * Middlewares can intercept, modify, or even short-circuit requests.
 *
 * @example Logging Example:
 * const logMiddleware: Middleware = async (ctx, next) => {
 *   console.log("Request:", ctx.url);
 *   const res = await next();
 *   console.log("Response:", res.status);
 *   return res;
 * };
 */
export type Middleware<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
  Options = any,
> = (
  ctx: MiddlewareContext<TReq, TRes>,
  next: MiddlewareNext,
  options?: Options,
) => Promise<Response>;

/**
 * ErrorLike
 * =========
 * Represents the normalized error shape used across the client.
 * Provides consistency for error handling modules such as RichError.
 */
export type ErrorLike = {
  message: string; // Human-readable error message
  status?: number; // HTTP status code (optional)
  code?: string; // Application-level error code (optional)
  /**
   * Transport-independent classification of the failure. Always populated by
   * the client, so a global handler can switch on it without knowing which wire
   * the request used.
   *
   * @see {@link ErrorKind}
   */
  kind?: ErrorKind;
  [key: string]: any; // Any additional arbitrary fields
};

/**
 * RequestOptions
 * ==============
 * Per-request options passed to the client execution:
 * - Optional AbortSignal (for cancellation)
 * - Optional timeout (in milliseconds)
 * - Optional upload/download progress handlers
 *
 * Progress lives here rather than on the contract because it is a call-site
 * concern — the same endpoint is worth a progress bar in a form and not worth
 * one in a background sync.
 */
export type RequestOptions = {
  signal?: AbortSignal;
  timeout?: number;

  /**
   * Called as the request body is uploaded.
   *
   * **`fetch` cannot report upload progress** — there is no such API. Passing
   * this handler switches the request's final transport to `XMLHttpRequest`,
   * which can. Middleware is unaffected: the chain still sees the same context
   * and is still handed a `Response`. Requests without this handler take the
   * byte-for-byte unchanged `fetch` path.
   *
   * Where `XMLHttpRequest` does not exist (Node, most SSR passes) the request
   * still runs over `fetch` and this handler is simply never called; the client
   * warns once so the silence is not mistaken for a stalled upload.
   *
   * On retry, progress restarts — each attempt re-sends the whole body and
   * begins with a `loaded: 0` tick.
   */
  onUploadProgress?: ProgressHandler;

  /**
   * Called as the response body is downloaded. Runs on the normal `fetch` path
   * by counting bytes off `res.body`.
   *
   * `total`/`percent` require a readable `Content-Length`; cross-origin that
   * also means the server must expose it via `Access-Control-Expose-Headers`.
   * Without it, ticks still arrive but report `lengthComputable: false`.
   *
   * Ignored for `responseType: "stream"` and `"response"`, which hand the
   * undrained body to the caller — counting bytes there would mean consuming
   * the stream the caller asked to own.
   */
  onDownloadProgress?: ProgressHandler;
};

/**
 * EndpointMethod
 * ==============
 * A single generated endpoint method. It is a callable that validates input
 * and returns the parsed response, plus stable runtime metadata attached to
 * the function itself:
 *
 * - `endpointId`: the stable `"module.endpoint"` identifier, used as the
 *   canonical cache key / event key by higher layers (query engines, devtools).
 * - `endpoint`: the original contract definition, so tooling can read the
 *   Zod `request`/`response` schemas, `mockData`, `errors`, etc. without a
 *   separate reference to the contracts object.
 *
 * The extra properties are purely additive — the value is still callable
 * exactly as before.
 */
export type EndpointMethod<E extends AnyEndpointDefZ> = {
  (
    input: z.infer<E["request"]>, // Auto‑derived input type from Zod schema
    options?: RequestOptions, // Optional timeout/cancel options
  ): Promise<z.infer<E["response"]>>; // Parsed, validated output type
  /** Stable `"module.endpoint"` identifier. */
  readonly endpointId: string;
  /** The original contract definition for this endpoint. */
  readonly endpoint: E;
};

/**
 * EndpointMethods
 * ================
 * Automatically generated method signatures for all endpoints
 * within a module, based on the Zod contract definitions.
 *
 * Each endpoint method:
 * - Validates input against its request schema
 * - Returns a Promise of the parsed and validated response type
 * - Carries `endpointId` / `endpoint` metadata for higher layers
 */
export type EndpointMethods<M extends Record<string, AnyEndpointDefZ>> = {
  [K in keyof M]: EndpointMethod<M[K]>;
};

/**
 * TokenProvider
 * =============
 * Specifies the contract for a function that supplies authentication tokens.
 * Can be synchronous or async, e.g. fetching from localStorage or refreshing with an API.
 */
export type TokenProvider = () => string | Promise<string>;

/**
 * RequestEvent
 * ============
 * Structured lifecycle events emitted by the client for every request when at
 * least one `Instrumentation` hook is registered. Unlike middleware (which only
 * sees the raw `Response`), these events expose the **parsed** input and the
 * **parsed/typed** output, plus timing and the endpoint identity — everything a
 * devtools/inspector layer needs to render a live request timeline.
 *
 * Events are purely observational: they never affect the value returned to the
 * caller and are only produced while instrumentation is attached (zero cost
 * otherwise).
 */
export type RequestEvent =
  | {
      type: "start";
      /** Unique id correlating this request's start/success/error events. */
      requestId: string;
      /** Stable `"module.endpoint"` identifier (may be empty for direct calls). */
      endpointId: string;
      /**
       * The operation, as the transport names it: an HTTP method, `"unary"` for
       * a gRPC call, `"query"` for GraphQL.
       */
      method: Method;
      /** Best-effort URL: `baseUrl + target` template (params not yet resolved). */
      url: string;
      /**
       * Which transport served this request (`"http"`, `"grpc"`, `"graphql"`).
       * Additive — a consumer that ignores it behaves exactly as before.
       */
      transport?: string;
      /** The validated request input. */
      input: unknown;
      /** High-resolution start timestamp (ms). */
      timestamp: number;
    }
  | {
      type: "success";
      requestId: string;
      endpointId: string;
      /** The parsed, typed response returned to the caller. */
      data: unknown;
      /** Elapsed time from start to success (ms). */
      durationMs: number;
      /** `true` when the result came from mock data (configured or forced). */
      fromMock: boolean;
    }
  | {
      type: "error";
      requestId: string;
      endpointId: string;
      status?: number;
      error: ErrorLike;
      durationMs: number;
    }
  | {
      type: "progress";
      requestId: string;
      endpointId: string;
      /** Which half of the exchange advanced. */
      phase: "upload" | "download";
      loaded: number;
      total?: number;
      percent?: number;
      lengthComputable: boolean;
      /** Elapsed time from the request's start to this tick (ms). */
      durationMs: number;
    };

/**
 * Override
 * ========
 * A runtime, per-request override resolved from an `Instrumentation` hook. It
 * lets tooling (a devtools panel) change what a single request does **without
 * mutating the original contract** — force a mock, simulate an error/latency,
 * or swap the request/response validation schema to test structural changes.
 *
 * Every field is optional and independent, so features compose: e.g. a swapped
 * `response` schema together with a forced `mock` validates the mock against
 * the new shape.
 */
export type Override = {
  /**
   * Force mock data for this request, bypassing the network regardless of the
   * client's mock mode. A function receives the parsed input. The result is
   * still validated against the (possibly overridden) response schema.
   */
  mock?: unknown | ((input: unknown) => unknown);
  /** Force an error response (simulate a failing endpoint). */
  error?: { status?: number; code?: string; message?: string; body?: unknown };
  /** Inject artificial latency (ms) before the request resolves. */
  latencyMs?: number;
  /** Swap the request validation schema at runtime (structure testing). */
  request?: z.ZodTypeAny;
  /** Swap the response validation schema at runtime (structure testing). */
  response?: z.ZodTypeAny;
};

/**
 * Instrumentation
 * ===============
 * An optional, additive hook registered via `client.instrument(...)`. Multiple
 * hooks can be attached; `on` receives every `RequestEvent`, and the first hook
 * to return an `Override` from `resolveOverride` wins for that request.
 *
 * This is the single extension point that higher-level packages (a
 * framework-agnostic query engine, a devtools bridge) build on. When no hook is
 * registered, request handling is byte-for-byte identical to the un-instrumented
 * path.
 */
export type Instrumentation = {
  /** Receives each lifecycle event. */
  on?: (event: RequestEvent) => void;
  /** Resolve a per-request override for the given endpoint/input, or `undefined`. */
  resolveOverride?: (
    endpointId: string,
    input: unknown,
  ) => Override | undefined;
};
