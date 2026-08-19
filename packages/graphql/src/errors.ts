import type { ErrorKind } from "@tahanabavi/typefetch";
import type { GraphqlError, GraphqlResponseBody } from "./types";

/**
 * GraphQL failures, normalised
 * ============================
 * GraphQL's error vocabulary is `extensions.code`, a convention rather than a
 * spec — so this maps the codes the ecosystem actually emits (Apollo Server's
 * set, which everything else copied) onto typefetch's shared {@link ErrorKind}.
 *
 * That mapping is the whole point of the transport being part of typefetch: an
 * app's "redirect on `unauthenticated`" handler fires for an `UNAUTHENTICATED`
 * GraphQL error exactly as it does for an HTTP 401.
 */
const KIND_BY_CODE: Record<string, ErrorKind> = {
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "permission_denied",
  BAD_USER_INPUT: "invalid_argument",
  BAD_REQUEST: "invalid_argument",
  GRAPHQL_PARSE_FAILED: "invalid_argument",
  GRAPHQL_VALIDATION_FAILED: "invalid_argument",
  NOT_FOUND: "not_found",
  CONFLICT: "already_exists",
  TOO_MANY_REQUESTS: "resource_exhausted",
  PERSISTED_QUERY_NOT_FOUND: "unimplemented",
  PERSISTED_QUERY_NOT_SUPPORTED: "unimplemented",
  OPERATION_RESOLUTION_FAILURE: "unimplemented",
  INTERNAL_SERVER_ERROR: "internal",
  SERVICE_UNAVAILABLE: "unavailable",
  TIMEOUT: "deadline_exceeded",
};

export function kindFromGraphqlCode(
  code: string | undefined,
  httpStatus: number,
): ErrorKind {
  if (code && KIND_BY_CODE[code]) return KIND_BY_CODE[code]!;

  // A server that sends no code but a real status still deserves a useful
  // classification; the legacy 200-with-errors case falls through to `unknown`,
  // which is honest — nothing in the response says what went wrong.
  if (httpStatus >= 500) return "internal";
  if (httpStatus === 401) return "unauthenticated";
  if (httpStatus === 403) return "permission_denied";
  if (httpStatus === 404) return "not_found";
  if (httpStatus >= 400) return "invalid_argument";

  return "unknown";
}

/** The first error's code, which is the one a caller will act on. */
export function primaryCode(errors: readonly GraphqlError[]): string | undefined {
  for (const error of errors) {
    const code = error.extensions?.code;
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * A GraphQL response's status, when it carries one.
 *
 * Apollo and others put the intended HTTP status in `extensions.http.status`
 * even while answering 200, which is the only signal available on the legacy
 * media type.
 */
export function statusFromExtensions(
  errors: readonly GraphqlError[],
): number | undefined {
  for (const error of errors) {
    const http = error.extensions?.http as { status?: unknown } | undefined;
    if (typeof http?.status === "number") return http.status;
  }
  return undefined;
}

export function combinedMessage(errors: readonly GraphqlError[]): string {
  const messages = errors.map((e) => e.message).filter(Boolean);
  if (!messages.length) return "GraphQL request failed";
  return messages.join("; ");
}

/**
 * Turn a GraphQL error payload into the fields of a `RichError`.
 *
 * The contract's `errors` map is keyed by `extensions.code`, so that string is
 * the `errorKey` — and `data` is the parsed body for that code when the contract
 * declared one, falling back to the raw error array. Fail open on typing: an
 * error-shape mismatch must never throw over the real error.
 */
export function graphqlFailureFields(
  body: GraphqlResponseBody,
  httpStatus: number,
  errorSchemas: Record<number | string, { safeParse(v: unknown): any }> | undefined,
) {
  const errors = body.errors ?? [];
  const code = primaryCode(errors);
  const status = statusFromExtensions(errors) ?? httpStatus;

  const schema = code !== undefined ? errorSchemas?.[code] : undefined;
  const first = errors[0];
  const parsed = schema?.safeParse(first?.extensions ?? first);

  return {
    message: combinedMessage(errors),
    status,
    kind: kindFromGraphqlCode(code, status),
    code,
    data: parsed?.success ? parsed.data : errors,
    dataParsed: parsed?.success === true,
    errorKey: parsed?.success === true ? code : undefined,
    graphqlErrors: errors,
  };
}
