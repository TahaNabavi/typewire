import type {
  AnyEndpointDefZ,
  ErrorKind,
  ErrorLike,
  InferError,
} from "./types";

/**
 * The client's error type, and the guard that types its body.
 *
 * Lives here rather than in `client.ts` because transport adapters construct
 * these too, and an adapter importing the client would close a cycle.
 */

export class RichError extends Error implements ErrorLike {
  status?: number;
  code?: string;
  /**
   * Transport-independent classification of this failure, always populated by
   * the client. `status` and `code` stay exactly as the server sent them; this
   * is the field a global handler switches on, so the same
   * `kind === "unauthenticated"` branch works whether the 401 arrived as an HTTP
   * status, a gRPC code, or a GraphQL `extensions.code`.
   *
   * @see {@link ErrorKind}
   */
  kind?: ErrorKind;
  title?: string;
  detail?: string;
  errors?: Record<string, string[]>;
  /**
   * Parsed error body. When the failed request's key matches a schema in the
   * endpoint's `errors` map, this holds the parsed/typed body; otherwise it
   * falls back to the raw JSON body.
   */
  data?: unknown;
  /**
   * Which key in the endpoint's `errors` map produced `data`.
   *
   * For an HTTP endpoint this is the status code, so it duplicates `status` —
   * but on other transports the key space is not the HTTP status (a gRPC code,
   * a GraphQL `extensions.code`), and `isContractError` must compare against the
   * key the contract was written with rather than the status the wire happened
   * to carry.
   */
  errorKey?: number | string;
  /**
   * Whether `data` was validated against the endpoint's declared schema for
   * this key. `true` only when a schema existed for `errorKey` and the body
   * passed it — i.e. `data` is guaranteed to match the declared error type.
   * Absent/`false` when no schema was declared or the body failed validation
   * (fail-open: `data` then holds the raw JSON). `isContractError` requires
   * this to be `true`, so it never narrows to a type the body doesn't match.
   */
  dataParsed?: boolean;

  constructor(error: Partial<ErrorLike> & { message: string }) {
    super(error.message);
    Object.assign(this, error);
  }
}

/**
 * isContractError
 * ===============
 * Typed guard that narrows a caught error to a `RichError` of a specific
 * declared error key, resolving the error body type from the endpoint's
 * `errors` map so `error.data` becomes fully typed at the point of use.
 *
 * TypeScript `catch` clauses are `unknown` and can't be narrowed by control
 * flow alone, so the guard references the endpoint to recover the body type
 * from the key literal.
 *
 * It narrows only when the error is a `RichError`, its key matches, AND the
 * body actually validated against the declared schema (`dataParsed`). The last
 * check keeps the narrowed type honest: if the server returns that key with a
 * body that doesn't match the contract, parsing fails open and this returns
 * `false` rather than claiming `data` has a shape it doesn't.
 *
 * The key space is the endpoint's transport's — an HTTP status, a gRPC code, or
 * a GraphQL `extensions.code`. It is matched against `errorKey` rather than
 * `status`, because on a non-HTTP transport those are different things.
 *
 * @example
 * try {
 *   await api.user.createUser({ body });
 * } catch (e) {
 *   if (isContractError(contracts.user.createUser, e, 409)) {
 *     e.data.conflictField; // fully typed from the 409 schema
 *   }
 * }
 */
export function isContractError<
  E extends AnyEndpointDefZ,
  S extends keyof NonNullable<E["errors"]> & (number | string),
>(
  endpoint: E,
  error: unknown,
  key: S,
): error is RichError & { data: InferError<E, S> } {
  return (
    error instanceof RichError &&
    (error.errorKey ?? error.status) === key &&
    error.dataParsed === true
  );
}
