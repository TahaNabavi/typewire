// Import "zod" for schema-based runtime validation of request and response data
import { z } from "zod";

export type EncryptionMethod = "AES" | "DES" | "RSA" | "Base64" | "Custom";
export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

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
 * ErrorResponsesMap
 * =================
 * Optional map of declared error responses for an endpoint, keyed by HTTP
 * status code. Each value is a Zod schema describing that status's error body.
 *
 * Keying by status code maps 1:1 to OpenAPI `responses` and to
 * `RichError.status`. If a single status can carry multiple distinct bodies,
 * the schema value itself can be a `z.discriminatedUnion(...)`.
 */
export type ErrorResponsesMap = Record<number, z.ZodTypeAny>;

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
 * EndpointDef
 * ============
 * Defines the structure of a **single API endpoint**, including:
 * - HTTP method and path
 * - request/response validation schemas
 * - optional authentication requirement
 * - optional mock or static mock data
 * - optional custom headers and body format
 */
export type EndpointDef<
  TReq extends RequestSchema,
  TRes extends ResponseSchema,
  TErr extends ErrorResponsesMap = {},
> = {
  /** HTTP method used by this endpoint */
  method: Method;

  /** URL path for this endpoint, e.g. "/users/:id" */
  path: string;

  /** Whether this endpoint requires an Authorization token */
  auth?: boolean;

  /** Zod schema describing the expected request structure */
  request: TReq; // Typically { path?, query?, body? }

  /** Zod schema describing the expected (success / 2xx) response structure */
  response: TRes;

  /**
   * Optional map of error response schemas keyed by HTTP status code, e.g.
   * `{ 404: schema, 409: schema }`. Purely additive: endpoints without
   * `errors` behave exactly as before.
   *
   * Used by the client to parse and TYPE a failed request's body (see
   * `RichError.data` and `isContractError`), and by external tools (such as
   * `@tahanabavi/typefetch-nestjs`) to document/validate error responses.
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
   * Defines how the request body should be sent:
   * - `"json"` (default): serialized as JSON
   * - `"form-data"`: multipart form
   */
  bodyType?: "json" | "form-data";

  /**
   * Optional contract-driven tests used by the TypeFetch test runner.
   */
  test?: EndpointTestConfig<z.infer<TReq>, z.infer<TRes>>;
};

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
    [EndpointName: string]: EndpointDef<RequestSchema, ResponseSchema>;
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
 * InferErrors<E>
 * ==============
 * Infers `{ [status]: <body type> }` for an endpoint's declared error
 * responses. Resolves to `{}` when the endpoint declares no `errors`.
 */
export type InferErrors<E> = E extends {
  errors: infer M extends ErrorResponsesMap;
}
  ? { [S in keyof M]: z.infer<M[S]> }
  : {};

/**
 * InferError<E, S>
 * ================
 * Infers the error body type of a single status code `S` for an endpoint.
 * Resolves to `never` when the endpoint declares no `errors` for that status.
 */
export type InferError<E, S extends number> = E extends {
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

export interface MiddlewareContext<
  TReq extends RequestSchema = RequestSchema,
  TRes extends ResponseSchema = ResponseSchema,
> {
  url: string;
  init: RequestInit;
  endpoint: EndpointDef<TReq, TRes>;
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
  [key: string]: any; // Any additional arbitrary fields
};

/**
 * RequestOptions
 * ==============
 * Per-request options passed to the client execution:
 * - Optional AbortSignal (for cancellation)
 * - Optional timeout (in milliseconds)
 */
export type RequestOptions = {
  signal?: AbortSignal;
  timeout?: number;
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
export type EndpointMethod<E extends EndpointDefZ> = {
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
export type EndpointMethods<M extends Record<string, EndpointDefZ>> = {
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
      method: Method;
      /** Best-effort URL: `baseUrl + path` template (params not yet resolved). */
      url: string;
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
