/**
 * Metadata key under which the contract `EndpointDef` is stored on a handler.
 * Read by the validation interceptor and available to user-land guards
 * (e.g. an auth guard checking `endpoint.auth`).
 */
export const TYPEFETCH_ENDPOINT_METADATA = "typefetch:endpoint";

/**
 * Metadata key for per-endpoint validation options passed to
 * `@TypeFetchEndpoint()` / `@UseContract()`.
 */
export const TYPEFETCH_OPTIONS_METADATA = "typefetch:options";

/**
 * Injection token for global options provided via `TypeFetchModule.forRoot()`.
 */
export const TYPEFETCH_MODULE_OPTIONS = "TYPEFETCH_MODULE_OPTIONS";

/**
 * Metadata key for a permission requirement declared with `@RequirePermission()`
 * on a route that has no contract (or to override the contract's `permission`).
 * The permission guard reads this first, then falls back to the endpoint's
 * `permission` key.
 */
export const TYPEFETCH_PERMISSION_METADATA = "typefetch:permission";

/**
 * Key under which the parsed & validated request is stored on the platform
 * request object. `Symbol.for` so the value survives duplicated module
 * instances (cjs/esm interop).
 */
export const PARSED_REQUEST_KEY = Symbol.for("typefetch:parsedRequest");
