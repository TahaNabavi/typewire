import { HttpException } from "@nestjs/common";
import { GrpcCode, codeName, parseCode } from "@tahanabavi/typefetch-grpc";
import { ContractValidationException } from "../exceptions";

/**
 * Failures, in the gRPC key space
 * ===============================
 * A gRPC endpoint's contract keys its `errors` map by **status code**, not HTTP
 * status — that is what makes a declared error mean the same thing whether the
 * call went over Connect or over binary grpc-web. So the server's job on the way
 * out is to name a code, and let the HTTP status follow from it.
 */

/** A Connect error body: `{ code, message, details? }`. */
export type ConnectErrorPayload = {
  code: string;
  message: string;
  details?: unknown[];
  /**
   * Field errors from a contract violation. Not part of the Connect wire
   * format, which reserves `details` for typed protobuf messages — but the
   * typefetch client hands the whole body to `endpoint.errors[code]`, so a
   * contract that declares a schema for `invalid_argument` receives them typed.
   */
  errors?: Record<string, string[]>;
};

/**
 * Throw a specific gRPC status from a handler.
 *
 * The alternative is throwing a `NotFoundException` and letting the status
 * mapping below infer the code, which is right often enough to be the default
 * and never as precise as saying it.
 *
 * @example
 * throw new GrpcException(GrpcCode.NotFound, `No user ${id}`);
 */
export class GrpcException extends Error {
  readonly code: GrpcCode;
  readonly details?: unknown[];

  constructor(code: GrpcCode, message?: string, details?: unknown[]) {
    super(message ?? codeName(code));
    this.name = "GrpcException";
    this.code = code;
    if (details) this.details = details;
  }
}

/**
 * HTTP status a **handler threw** → gRPC code.
 *
 * Deliberately not `codeFromHttpStatus` from the client package. That table
 * reads a status produced by something that never reached the gRPC layer — a
 * proxy's 502, a gateway's 401 — where `404` means "no such route", so it maps
 * to `unimplemented`. Here `404` came from a handler that looked something up
 * and did not find it, which is `not_found`. Same input, different meaning,
 * because the thrower is different.
 */
const CODE_BY_THROWN_STATUS: Record<number, GrpcCode> = {
  400: GrpcCode.InvalidArgument,
  401: GrpcCode.Unauthenticated,
  403: GrpcCode.PermissionDenied,
  404: GrpcCode.NotFound,
  405: GrpcCode.Unimplemented,
  408: GrpcCode.DeadlineExceeded,
  409: GrpcCode.AlreadyExists,
  412: GrpcCode.FailedPrecondition,
  416: GrpcCode.OutOfRange,
  429: GrpcCode.ResourceExhausted,
  499: GrpcCode.Cancelled,
  500: GrpcCode.Internal,
  501: GrpcCode.Unimplemented,
  502: GrpcCode.Unavailable,
  503: GrpcCode.Unavailable,
  504: GrpcCode.DeadlineExceeded,
};

export function codeFromThrownStatus(status: number): GrpcCode {
  const mapped = CODE_BY_THROWN_STATUS[status];
  if (mapped !== undefined) return mapped;
  return status >= 500 ? GrpcCode.Internal : GrpcCode.Unknown;
}

/**
 * Turn anything a handler threw into the Connect error body to send.
 *
 * An unrecognised throw is reported as `internal` with a fixed message: a
 * stack trace or an ORM's "duplicate key on users_email_idx" reaching a client
 * is an information leak, and the log already has the real one.
 */
export function toConnectError(exception: unknown): ConnectErrorPayload {
  if (exception instanceof GrpcException) {
    return {
      code: codeName(exception.code),
      message: exception.message,
      ...(exception.details ? { details: exception.details } : {}),
    };
  }

  if (exception instanceof ContractValidationException) {
    return {
      code: codeName(GrpcCode.InvalidArgument),
      message: "Request validation failed",
      errors: exception.errors,
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const body = exception.getResponse();

    if (typeof body === "string") {
      return { code: codeName(codeFromThrownStatus(status)), message: body };
    }

    const record = body as Record<string, unknown>;

    // An exception may name its own gRPC code — either explicitly, or because
    // an app already uses Connect's spelling for `code`. Honour it over the
    // status, which is the coarser signal of the two.
    const declared =
      record.grpcCode !== undefined
        ? parseCode(record.grpcCode)
        : isConnectCodeName(record.code)
          ? parseCode(record.code)
          : undefined;

    const message = Array.isArray(record.message)
      ? record.message.join(", ")
      : ((record.message as string | undefined) ?? exception.message);

    return {
      code: codeName(declared ?? codeFromThrownStatus(status)),
      message,
      ...(Array.isArray(record.details) ? { details: record.details } : {}),
      ...(isFieldErrors(record.errors) ? { errors: record.errors } : {}),
    };
  }

  return { code: codeName(GrpcCode.Internal), message: "Internal server error" };
}

/**
 * Whether a `code` field is a gRPC status name rather than an application code.
 *
 * `parseCode` answers `unknown` (2) for anything it does not recognise, so
 * without this check an app-level `code: "EMAIL_TAKEN"` would silently become
 * `unknown` and lose the far more useful mapping from the HTTP status.
 */
function isConnectCodeName(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return parseCode(value) !== GrpcCode.Unknown || value.toLowerCase() === "unknown";
}

function isFieldErrors(value: unknown): value is Record<string, string[]> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
