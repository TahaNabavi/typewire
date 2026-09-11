import type { ErrorKind } from '@tahanabavi/typefetch'

/**
 * gRPC status codes
 * =================
 * The canonical numeric set, which is also the key space for a gRPC endpoint's
 * `errors` map. Keying on the code rather than the HTTP status is what makes a
 * contract's declared errors mean the same thing whether the call went over
 * Connect (which maps codes onto real statuses) or binary grpc-web (which
 * answers 200 and puts the code in a trailer).
 */
export enum GrpcCode {
  Ok = 0,
  Cancelled = 1,
  Unknown = 2,
  InvalidArgument = 3,
  DeadlineExceeded = 4,
  NotFound = 5,
  AlreadyExists = 6,
  PermissionDenied = 7,
  ResourceExhausted = 8,
  FailedPrecondition = 9,
  Aborted = 10,
  OutOfRange = 11,
  Unimplemented = 12,
  Internal = 13,
  Unavailable = 14,
  DataLoss = 15,
  Unauthenticated = 16,
}

/**
 * Connect's wire spelling of each code.
 *
 * Note `"canceled"` — Connect uses the single-L American spelling while gRPC's
 * own constant is `CANCELLED`. Both are accepted when reading; this table is
 * what is written.
 */
const NAME_BY_CODE: Record<number, string> = {
  [GrpcCode.Ok]: 'ok',
  [GrpcCode.Cancelled]: 'canceled',
  [GrpcCode.Unknown]: 'unknown',
  [GrpcCode.InvalidArgument]: 'invalid_argument',
  [GrpcCode.DeadlineExceeded]: 'deadline_exceeded',
  [GrpcCode.NotFound]: 'not_found',
  [GrpcCode.AlreadyExists]: 'already_exists',
  [GrpcCode.PermissionDenied]: 'permission_denied',
  [GrpcCode.ResourceExhausted]: 'resource_exhausted',
  [GrpcCode.FailedPrecondition]: 'failed_precondition',
  [GrpcCode.Aborted]: 'aborted',
  [GrpcCode.OutOfRange]: 'out_of_range',
  [GrpcCode.Unimplemented]: 'unimplemented',
  [GrpcCode.Internal]: 'internal',
  [GrpcCode.Unavailable]: 'unavailable',
  [GrpcCode.DataLoss]: 'data_loss',
  [GrpcCode.Unauthenticated]: 'unauthenticated',
}

const CODE_BY_NAME: Record<string, GrpcCode> = (() => {
  const table: Record<string, GrpcCode> = {}
  for (const [code, name] of Object.entries(NAME_BY_CODE)) {
    table[name] = Number(code) as GrpcCode
  }
  // gRPC's own spelling, so a server that writes either is understood.
  table['cancelled'] = GrpcCode.Cancelled
  return table
})()

export function codeName(code: GrpcCode | number): string {
  return NAME_BY_CODE[code] ?? 'unknown'
}

/** Parse a Connect error's `code`, which may be the name or the number. */
export function parseCode(value: unknown): GrpcCode {
  if (typeof value === 'number' && NAME_BY_CODE[value] !== undefined) {
    return value as GrpcCode
  }

  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase()
    const named = CODE_BY_NAME[trimmed]
    if (named !== undefined) return named

    // A trailer carries the code as a decimal string.
    const numeric = Number(trimmed)
    if (Number.isInteger(numeric) && NAME_BY_CODE[numeric] !== undefined) {
      return numeric as GrpcCode
    }
  }

  return GrpcCode.Unknown
}

/**
 * gRPC code → typefetch's normalised {@link ErrorKind}.
 *
 * Nearly the identity function, because the shared taxonomy *is* the gRPC set —
 * it is the best-designed of the three wires, so the other two map onto it
 * rather than the reverse.
 */
const KIND_BY_CODE: Record<number, ErrorKind> = {
  [GrpcCode.Cancelled]: 'cancelled',
  [GrpcCode.Unknown]: 'unknown',
  [GrpcCode.InvalidArgument]: 'invalid_argument',
  [GrpcCode.DeadlineExceeded]: 'deadline_exceeded',
  [GrpcCode.NotFound]: 'not_found',
  [GrpcCode.AlreadyExists]: 'already_exists',
  [GrpcCode.PermissionDenied]: 'permission_denied',
  [GrpcCode.ResourceExhausted]: 'resource_exhausted',
  [GrpcCode.FailedPrecondition]: 'failed_precondition',
  [GrpcCode.Aborted]: 'aborted',
  [GrpcCode.OutOfRange]: 'out_of_range',
  [GrpcCode.Unimplemented]: 'unimplemented',
  [GrpcCode.Internal]: 'internal',
  [GrpcCode.Unavailable]: 'unavailable',
  [GrpcCode.DataLoss]: 'data_loss',
  [GrpcCode.Unauthenticated]: 'unauthenticated',
}

export function kindFromGrpcCode(code: GrpcCode | number): ErrorKind {
  return KIND_BY_CODE[code] ?? 'unknown'
}

/**
 * gRPC code → HTTP status, per the Connect protocol.
 *
 * Used only when the transport has to synthesize a status: binary grpc-web
 * answers `200 OK` and reports the real outcome in a trailer, so without this a
 * failed call would carry a success status.
 */
const STATUS_BY_CODE: Record<number, number> = {
  [GrpcCode.Cancelled]: 499,
  [GrpcCode.Unknown]: 500,
  [GrpcCode.InvalidArgument]: 400,
  [GrpcCode.DeadlineExceeded]: 504,
  [GrpcCode.NotFound]: 404,
  [GrpcCode.AlreadyExists]: 409,
  [GrpcCode.PermissionDenied]: 403,
  [GrpcCode.ResourceExhausted]: 429,
  [GrpcCode.FailedPrecondition]: 400,
  [GrpcCode.Aborted]: 409,
  [GrpcCode.OutOfRange]: 400,
  [GrpcCode.Unimplemented]: 501,
  [GrpcCode.Internal]: 500,
  [GrpcCode.Unavailable]: 503,
  [GrpcCode.DataLoss]: 500,
  [GrpcCode.Unauthenticated]: 401,
}

export function statusFromGrpcCode(code: GrpcCode | number): number {
  return STATUS_BY_CODE[code] ?? 500
}

/**
 * HTTP status → gRPC code, for a failure that never reached the gRPC layer.
 *
 * A proxy's 502, a gateway's 401: there is no Connect error body to read, but
 * the contract's `errors` map is keyed by code, so one has to be derived.
 */
export function codeFromHttpStatus(status: number): GrpcCode {
  switch (status) {
    case 400:
      return GrpcCode.InvalidArgument
    case 401:
      return GrpcCode.Unauthenticated
    case 403:
      return GrpcCode.PermissionDenied
    case 404:
      return GrpcCode.Unimplemented
    case 408:
      return GrpcCode.DeadlineExceeded
    case 409:
      return GrpcCode.Aborted
    case 429:
      return GrpcCode.ResourceExhausted
    case 499:
      return GrpcCode.Cancelled
    case 501:
      return GrpcCode.Unimplemented
    case 502:
    case 503:
      return GrpcCode.Unavailable
    case 504:
      return GrpcCode.DeadlineExceeded
    default:
      return status >= 500 ? GrpcCode.Internal : GrpcCode.Unknown
  }
}
