import { z } from 'zod'
import type { AnyEndpointDefZ, TransportContext } from '@tahanabavi/typefetch'
import { grpcTransport } from '../transport'
import { GrpcCode } from '../codes'
import { encodeFrame } from '../frames'
import type { GrpcCodec } from '../types'

const getUser = {
  transport: 'grpc',
  service: 'user.v1.UserService',
  rpc: 'GetUser',
  request: z.object({ id: z.string() }),
  response: z.object({ id: z.string(), name: z.string() }),
} as unknown as AnyEndpointDefZ

function contextFor(
  endpoint: AnyEndpointDefZ,
  input: unknown = { id: 'u_1' },
  extra: Partial<TransportContext> = {}
): TransportContext {
  return {
    endpoint,
    endpointId: 'user.getUser',
    input,
    baseUrl: 'https://api.example.com',
    ...extra,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('grpcTransport — Connect JSON', () => {
  const transport = grpcTransport()

  it('posts to /service/rpc with the message as the whole body', () => {
    const { url, init } = transport.build(contextFor(getUser))

    expect(url).toBe('https://api.example.com/user.v1.UserService/GetUser')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ id: 'u_1' }))
  })

  it('announces the Connect protocol version, which strict servers require', () => {
    const { init } = transport.build(contextFor(getUser))
    const headers = init.headers as Record<string, string>

    expect(headers['Connect-Protocol-Version']).toBe('1')
    expect(headers['Content-Type']).toBe('application/json')
  })

  it('does not double the slash when baseUrl has a trailing one', () => {
    const { url } = transport.build(
      contextFor(
        getUser,
        { id: 'u_1' },
        { baseUrl: 'https://api.example.com/' }
      )
    )

    expect(url).toBe('https://api.example.com/user.v1.UserService/GetUser')
  })

  it('sends the deadline in both spellings so proxies and servers both read it', () => {
    const endpoint = { ...getUser, deadlineMs: 5000 } as AnyEndpointDefZ
    const { init } = transport.build(contextFor(endpoint))
    const headers = init.headers as Record<string, string>

    expect(headers['Connect-Timeout-Ms']).toBe('5000')
    expect(headers['grpc-timeout']).toBe('5000m')
  })

  it('applies the token the client resolved', () => {
    const { init } = transport.build(
      contextFor(getUser, { id: 'u_1' }, { token: 'abc' })
    )

    expect((init.headers as Record<string, string>)['Authorization']).toBe(
      'Bearer abc'
    )
  })

  it('returns the 2xx body as the message, with nothing wrapped around it', async () => {
    const decoded = await transport.decode(
      jsonResponse({ id: 'u_1', name: 'Ada' }),
      contextFor(getUser)
    )

    expect(decoded).toEqual({
      value: { id: 'u_1', name: 'Ada' },
      enveloped: false,
    })
  })

  it('treats an empty 2xx body as an empty message', async () => {
    const decoded = await transport.decode(
      new Response('', { status: 200 }),
      contextFor(getUser)
    )

    expect(decoded.value).toEqual({})
  })

  it('maps a Connect error body onto the shared taxonomy', async () => {
    const failure = await transport.fail(
      jsonResponse({ code: 'not_found', message: 'no such user' }, 404),
      contextFor(getUser)
    )

    expect(failure.error.message).toBe('no such user')
    expect(failure.error.kind).toBe('not_found')
    expect((failure.error as any).grpcCode).toBe(GrpcCode.NotFound)
    expect(failure.error.status).toBe(404)
  })

  it('derives a code for a proxy failure that never reached the gRPC layer', async () => {
    const failure = await transport.fail(
      new Response('<html>Bad Gateway</html>', { status: 502 }),
      contextFor(getUser)
    )

    expect((failure.error as any).grpcCode).toBe(GrpcCode.Unavailable)
    expect(failure.error.kind).toBe('unavailable')
  })

  it('types the error body against the schema declared for that gRPC code', async () => {
    const endpoint = {
      ...getUser,
      errors: {
        [GrpcCode.NotFound]: z.object({
          code: z.string(),
          message: z.string(),
        }),
      },
    } as unknown as AnyEndpointDefZ

    const failure = await transport.fail(
      jsonResponse({ code: 'not_found', message: 'no such user' }, 404),
      contextFor(endpoint)
    )

    expect(failure.error.dataParsed).toBe(true)
    expect((failure.error as any).errorKey).toBe(GrpcCode.NotFound)
  })

  it('falls back to the raw body when it does not match the declared schema', async () => {
    const endpoint = {
      ...getUser,
      errors: { [GrpcCode.NotFound]: z.object({ requiredField: z.string() }) },
    } as unknown as AnyEndpointDefZ

    const failure = await transport.fail(
      jsonResponse({ code: 'not_found', message: 'gone' }, 404),
      contextFor(endpoint)
    )

    // Fail open: typing an error must never throw over the real error.
    expect(failure.error.dataParsed).toBe(false)
    expect((failure.error as any).errorKey).toBeUndefined()
    expect(failure.error.message).toBe('gone')
  })
})

describe('grpcTransport — validation at init()', () => {
  const transport = grpcTransport()

  it('names the endpoint when service is missing', () => {
    const broken = {
      ...getUser,
      service: undefined,
    } as unknown as AnyEndpointDefZ

    expect(() => transport.validate!(broken, 'user.getUser')).toThrow(
      /user\.getUser.*service/s
    )
  })

  it('names the endpoint when rpc is missing', () => {
    const broken = { ...getUser, rpc: undefined } as unknown as AnyEndpointDefZ

    expect(() => transport.validate!(broken, 'user.getUser')).toThrow(
      /user\.getUser.*rpc/s
    )
  })

  it('describes a route for tooling without the core reading a grpc field', () => {
    expect(transport.describe(getUser)).toEqual({
      protocol: 'gRPC',
      operation: 'unary',
      target: 'user.v1.UserService/GetUser',
    })
  })
})

describe('grpcTransport — binary grpc-web', () => {
  /** A stand-in for a generated protobuf codec: JSON bytes, no protobuf runtime. */
  const codec: GrpcCodec = {
    encode: (message) => new TextEncoder().encode(JSON.stringify(message)),
    decode: (bytes) => JSON.parse(new TextDecoder().decode(bytes)),
  }

  const transport = grpcTransport({ codec })

  function binaryResponse(
    parts: Uint8Array[],
    status = 200,
    headers: Record<string, string> = {}
  ) {
    const total = parts.reduce((sum, p) => sum + p.length, 0)
    const body = new Uint8Array(total)
    let offset = 0
    for (const part of parts) {
      body.set(part, offset)
      offset += part.length
    }
    return new Response(body, { status, headers })
  }

  function trailerFrame(text: string): Uint8Array {
    const payload = new TextEncoder().encode(text)
    const frame = new Uint8Array(5 + payload.length)
    new DataView(frame.buffer).setUint32(1, payload.length, false)
    frame[0] = 0x80
    frame.set(payload, 5)
    return frame
  }

  it('frames the request and switches the content type', () => {
    const { init } = transport.build(contextFor(getUser))
    const headers = init.headers as Record<string, string>

    expect(headers['Content-Type']).toBe('application/grpc-web+proto')
    expect((init.body as Uint8Array).length).toBeGreaterThan(5)
  })

  it('decodes the message frame and honours an OK trailer', async () => {
    const message = codec.encode({ id: 'u_1', name: 'Ada' })
    const res = binaryResponse([
      encodeFrame(message),
      trailerFrame('grpc-status: 0\r\n'),
    ])

    const decoded = await transport.decode(res, contextFor(getUser))

    expect(decoded.value).toEqual({ id: 'u_1', name: 'Ada' })
  })

  it('fails a 200 whose trailer reports a non-OK status', async () => {
    // The reason decode() has to be able to throw: grpc-web answers 200 for
    // every outcome and puts the real one in the trailer.
    const res = binaryResponse([
      trailerFrame('grpc-status: 5\r\ngrpc-message: gone\r\n'),
    ])

    await expect(
      transport.decode(res, contextFor(getUser))
    ).rejects.toMatchObject({
      kind: 'not_found',
      message: 'gone',
      status: 404,
    })
  })

  it('explains the CORS cause when the trailer never arrives', async () => {
    const res = binaryResponse([encodeFrame(codec.encode({ id: 'u_1' }))])

    await expect(transport.decode(res, contextFor(getUser))).rejects.toThrow(
      /Access-Control-Expose-Headers/
    )
  })

  it('reads a trailers-only rejection from the response headers', async () => {
    const res = binaryResponse([], 200, {
      'grpc-status': '16',
      'grpc-message': 'missing token',
    })

    await expect(
      transport.decode(res, contextFor(getUser))
    ).rejects.toMatchObject({
      kind: 'unauthenticated',
      message: 'missing token',
    })
  })
})
