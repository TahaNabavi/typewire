import type { EndpointDefZ } from "@tahanabavi/typefetch";
import type { z } from "zod";
import type { BackendEncryptionOptions } from "./encryption/types";

/**
 * Infer the full (structured) request input type of a contract endpoint —
 * the same type the typefetch client accepts for this endpoint.
 *
 * @example
 * type Input = InferRequest<typeof contracts.user.getUser>;
 * // { path?: { id: string }, query?: ..., body: ..., headers?: ... }
 */
export type InferRequest<E extends EndpointDefZ> = z.infer<E["request"]>;

/**
 * Infer the response type of a contract endpoint — the exact type the
 * handler must return so the frontend receives what the contract promises.
 */
export type InferResponse<E extends EndpointDefZ> = z.infer<E["response"]>;

/**
 * Signature a controller handler must satisfy for a given endpoint.
 * Useful with `satisfies` to keep handlers honest:
 *
 * @example
 * getUser = (async (input) => ({ id: input.path.id, name: "Taha" }))
 *   satisfies ContractHandler<typeof contracts.user.getUser>;
 */
export type ContractHandler<E extends EndpointDefZ> = (
  input: InferRequest<E>,
) => InferResponse<E> | Promise<InferResponse<E>>;

/**
 * The parsed & validated request stored on the platform request object
 * after the contract interceptor ran. Read by `@ContractInput()` and the
 * granular param decorators.
 */
export type ParsedContractRequest = {
  /** Validated path params (structured contracts only). */
  path?: Record<string, unknown>;
  /** Validated query params (structured contracts only). */
  query?: Record<string, unknown>;
  /** Validated body. For flat contracts this is the whole input. */
  body?: unknown;
  /** Validated headers part (structured contracts only). */
  headers?: Record<string, string>;
  /** Whether the contract uses the structured `{ path, query, body, headers }` shape. */
  isStructured: boolean;
  /**
   * The value shaped like the contract's `request` schema — what the
   * typefetch client would have passed as `input`. This is what
   * `@ContractInput()` returns.
   */
  input: unknown;
};

/** Validation switches shared by module-level and endpoint-level options. */
export interface ContractValidationOptions {
  /** Validate incoming path/query/body/headers against `endpoint.request`. Default `true`. */
  validateRequest?: boolean;
  /**
   * Validate (and strip) the handler's return value against
   * `endpoint.response`. Default `true`.
   */
  validateResponse?: boolean;
  /**
   * Coerce incoming path/query strings toward the types the contract
   * declares (`"25"` → 25, `"true"` → true, ISO strings → Date, repeated
   * keys → arrays, JSON strings → objects) before validating — mirroring how
   * the typefetch client serializes them. Default `true`.
   */
  coerce?: boolean;
}

/** Per-endpoint options accepted by `@TypeFetchEndpoint()` / `@UseContract()`. */
export interface ContractEndpointOptions extends ContractValidationOptions {
  /**
   * Override the HTTP status code for successful responses
   * (e.g. `200` instead of Nest's default `201` for POST).
   */
  httpCode?: number;
}

/**
 * Normalized error passed to the envelope's `error` builder. Fields mirror
 * what the typefetch client's `RichError` reads from an error body.
 */
export interface EnvelopeError {
  /** Human-readable message. */
  message: string;
  /** HTTP status the exception carried (or 500 for unknown errors). */
  status: number;
  /** Application error code, when the exception provided one. */
  code?: string;
  /** Field errors, when present (e.g. from `ContractValidationException`). */
  errors?: Record<string, string[]>;
}

/**
 * Mirror of the client's `setResponseWrapper` on the server: how successful
 * responses and errors are wrapped into a shared envelope so the client's
 * wrapper schema parses both branches.
 *
 * Defaults match the documented client example:
 * `{ success: true, data }` / `{ success: false, message, code?, errors? }`.
 */
export interface ResponseEnvelopeOptions {
  /** Build the success envelope. Default: `(data) => ({ success: true, data })`. */
  success?: (data: unknown) => unknown;
  /**
   * Build the error envelope. Default:
   * `(e) => ({ success: false, message: e.message, code?, errors? })`.
   */
  error?: (error: EnvelopeError) => unknown;
  /**
   * Whether error responses keep their real HTTP status or always return
   * `200` (some APIs signal failure only via `success: false`).
   * Default `"preserve"`.
   */
  errorStatus?: "preserve" | 200;
}

/** Global options provided via `TypeFetchModule.forRoot()`. */
export interface TypeFetchModuleOptions extends ContractValidationOptions {
  /**
   * Include the Zod issues of a response-contract violation in the 500
   * response body. Useful in development; keep `false` in production so
   * schema internals are not leaked. Default `false`.
   */
  exposeResponseErrors?: boolean;
  /**
   * Wrap every response (and error) in a shared envelope mirroring the
   * client's `setResponseWrapper`. `true` uses the default `{ success, data }`
   * shape; pass an object to customize. Registers a global interceptor +
   * exception filter. Default `false` (disabled).
   */
  envelope?: boolean | ResponseEnvelopeOptions;
  /**
   * Field-level encryption mirroring the client's `encryptionMiddleware`.
   * When set, endpoints with an `encryption` contract config have their
   * marked request fields **decrypted before validation** and response
   * fields **encrypted after validation**, using the same key material the
   * client's `keyProvider` supplies.
   */
  encryption?: BackendEncryptionOptions;
}

/** Fully resolved options after merging defaults ← module ← endpoint. */
export type ResolvedContractOptions = Required<ContractValidationOptions> &
  Pick<TypeFetchModuleOptions, "exposeResponseErrors">;
