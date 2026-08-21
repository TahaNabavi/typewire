import { HttpException } from "@nestjs/common";
import { ContractValidationException } from "../exceptions";

/**
 * Failures, in GraphQL's key space
 * ================================
 * A GraphQL endpoint's contract keys its `errors` map by `extensions.code`, and
 * `@tahanabavi/typefetch-graphql` maps those codes onto the shared `ErrorKind`
 * — so `UNAUTHENTICATED` here reaches an app's global handler as the same
 * `unauthenticated` an HTTP 401 does.
 *
 * Which makes the code the important half of a GraphQL error and the message
 * the cosmetic one. A `NestJS` app already signals intent through its exception
 * classes, so this translates them rather than asking anyone to restate it.
 */

/** One entry of a GraphQL `errors` array. */
export type GraphqlErrorPayload = {
  message: string;
  extensions: Record<string, unknown> & {
    code: string;
    /**
     * Apollo's convention for the status a response *would* have had. It is the
     * only way a failure can carry one on the legacy `application/json` media
     * type, which answers `200` whatever went wrong — and typefetch reads it.
     */
    http?: { status: number };
  };
};

/**
 * Throw a specific GraphQL error code from a resolver.
 *
 * The mapping below infers a code from a NestJS exception, which is right for
 * `NotFoundException` and friends. This is for the cases with no HTTP analogue,
 * or where the contract declares an `errors` schema for a code of its own.
 *
 * @example
 * throw new GraphqlException("PERSISTED_QUERY_NOT_FOUND", "Unknown hash");
 */
export class GraphqlException extends Error {
  readonly code: string;
  readonly extensions: Record<string, unknown>;
  readonly status: number;

  constructor(
    code: string,
    message?: string,
    extensions: Record<string, unknown> = {},
    /** Override the status the code maps to — for `405`, which no code names. */
    status?: number,
  ) {
    super(message ?? code);
    this.name = "GraphqlException";
    this.code = code;
    this.extensions = extensions;
    this.status = status ?? statusFromGraphqlCode(code);
  }
}

/** HTTP status a handler threw → the `extensions.code` that means it. */
const CODE_BY_STATUS: Record<number, string> = {
  400: "BAD_USER_INPUT",
  401: "UNAUTHENTICATED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  429: "TOO_MANY_REQUESTS",
  500: "INTERNAL_SERVER_ERROR",
  503: "SERVICE_UNAVAILABLE",
  504: "TIMEOUT",
};

/** The inverse, for an error that named a code but no status. */
const STATUS_BY_CODE: Record<string, number> = {
  BAD_USER_INPUT: 400,
  BAD_REQUEST: 400,
  GRAPHQL_PARSE_FAILED: 400,
  GRAPHQL_VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  OPERATION_RESOLUTION_FAILURE: 404,
  PERSISTED_QUERY_NOT_FOUND: 404,
  PERSISTED_QUERY_NOT_SUPPORTED: 404,
  CONFLICT: 409,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  TIMEOUT: 504,
};

export function graphqlCodeFromStatus(status: number): string {
  const mapped = CODE_BY_STATUS[status];
  if (mapped) return mapped;
  return status >= 500 ? "INTERNAL_SERVER_ERROR" : "BAD_REQUEST";
}

export function statusFromGraphqlCode(code: string): number {
  return STATUS_BY_CODE[code] ?? 500;
}

/**
 * Turn anything a resolver threw into a GraphQL error, plus the HTTP status to
 * send it under.
 *
 * An unrecognised throw becomes `INTERNAL_SERVER_ERROR` with a fixed message,
 * for the same reason it does on every other wire: the log has the real one and
 * the client should not.
 */
export function toGraphqlError(exception: unknown): {
  error: GraphqlErrorPayload;
  status: number;
} {
  if (exception instanceof GraphqlException) {
    return build(exception.code, exception.message, exception.status, {
      ...exception.extensions,
    });
  }

  if (exception instanceof ContractValidationException) {
    return build("BAD_USER_INPUT", "Request validation failed", 400, {
      errors: exception.errors,
    });
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();

    if (typeof body === "string") {
      return build(graphqlCodeFromStatus(status), body, status, {});
    }

    const record = body as Record<string, unknown>;
    const message = Array.isArray(record.message)
      ? record.message.join(", ")
      : ((record.message as string | undefined) ?? exception.message);

    // An app that already speaks GraphQL codes gets to keep its own; anything
    // else (`"USER_NOT_FOUND"`) is application vocabulary and stays out of the
    // slot the client switches on.
    const code =
      typeof record.code === "string" && STATUS_BY_CODE[record.code]
        ? record.code
        : graphqlCodeFromStatus(status);

    return build(code, message, status, {
      ...(record.errors !== undefined ? { errors: record.errors } : {}),
      ...(typeof record.code === "string" && !STATUS_BY_CODE[record.code]
        ? { appCode: record.code }
        : {}),
    });
  }

  return build(
    "INTERNAL_SERVER_ERROR",
    "Internal server error",
    500,
    {},
  );
}

function build(
  code: string,
  message: string,
  status: number,
  extensions: Record<string, unknown>,
): { error: GraphqlErrorPayload; status: number } {
  return {
    error: { message, extensions: { ...extensions, code, http: { status } } },
    status,
  };
}
