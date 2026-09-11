import {
  GrpcCode,
  codeFromHttpStatus,
  codeName,
  kindFromGrpcCode,
  parseCode,
  statusFromGrpcCode,
} from '../codes'

describe('gRPC code table', () => {
  it('round-trips every code through its Connect name', () => {
    const codes = Object.values(GrpcCode).filter(
      (value): value is GrpcCode => typeof value === 'number'
    )

    for (const code of codes) {
      expect(parseCode(codeName(code))).toBe(code)
    }
  })

  it('accepts both spellings of cancelled', () => {
    // Connect writes the single-L American spelling; gRPC's own constant is
    // CANCELLED. A client that understood only one would misclassify the other.
    expect(parseCode('canceled')).toBe(GrpcCode.Cancelled)
    expect(parseCode('cancelled')).toBe(GrpcCode.Cancelled)
  })

  it('accepts a numeric code from a trailer, which is a decimal string', () => {
    expect(parseCode('5')).toBe(GrpcCode.NotFound)
    expect(parseCode(5)).toBe(GrpcCode.NotFound)
  })

  it('falls back to unknown rather than throwing on a code it cannot read', () => {
    expect(parseCode('not_a_real_code')).toBe(GrpcCode.Unknown)
    expect(parseCode(undefined)).toBe(GrpcCode.Unknown)
    expect(parseCode(999)).toBe(GrpcCode.Unknown)
  })

  it('maps codes onto the shared error taxonomy', () => {
    expect(kindFromGrpcCode(GrpcCode.NotFound)).toBe('not_found')
    expect(kindFromGrpcCode(GrpcCode.Unauthenticated)).toBe('unauthenticated')
    expect(kindFromGrpcCode(GrpcCode.PermissionDenied)).toBe(
      'permission_denied'
    )
  })

  it('maps codes onto HTTP statuses per the Connect spec', () => {
    expect(statusFromGrpcCode(GrpcCode.NotFound)).toBe(404)
    expect(statusFromGrpcCode(GrpcCode.Unauthenticated)).toBe(401)
    expect(statusFromGrpcCode(GrpcCode.ResourceExhausted)).toBe(429)
    expect(statusFromGrpcCode(GrpcCode.Unimplemented)).toBe(501)
  })

  it('derives a code for a failure that never reached the gRPC layer', () => {
    expect(codeFromHttpStatus(401)).toBe(GrpcCode.Unauthenticated)
    expect(codeFromHttpStatus(502)).toBe(GrpcCode.Unavailable)
    expect(codeFromHttpStatus(504)).toBe(GrpcCode.DeadlineExceeded)
  })
})
