import {
  RichError,
  TRANSPORT_API_VERSION,
  type AnyEndpointDefZ,
  type TransportAdapter,
  type TransportContext,
  type TransportDecoded,
  type TransportFailure,
  type TransportRequest,
} from '@tahanabavi/typefetch'
import {
  GrpcCode,
  codeFromHttpStatus,
  codeName,
  kindFromGrpcCode,
  parseCode,
  statusFromGrpcCode,
} from './codes'
import {
  decodeFrames,
  encodeFrame,
  parseTrailer,
  trailerFromHeaders,
} from './frames'
import type {
  ConnectErrorBody,
  GrpcCodec,
  GrpcEndpointFields,
  GrpcTransportConfig,
} from './types'

type GrpcEndpoint = AnyEndpointDefZ & GrpcEndpointFields

const JSON_CONTENT_TYPE = 'application/json'
const DEFAULT_BINARY_CONTENT_TYPE = 'application/grpc-web+proto'

/**
 * Connect requires clients to announce the protocol version. Servers running in
 * strict mode reject a request without it, and the failure is opaque.
 */
const PROTOCOL_VERSION_HEADER = 'Connect-Protocol-Version'

/**
 * Build the `RichError` fields for a gRPC failure.
 *
 * `errorKey` is the numeric gRPC code — the key space for a gRPC endpoint's
 * `errors` map — while `status` stays the HTTP status, so a route's declared
 * errors mean the same thing whether the call went over Connect (real statuses)
 * or binary grpc-web (always 200 plus a trailer).
 *
 * Fail open on typing, as everywhere else: a body that does not match the
 * declared schema falls back to the raw one rather than throwing over the real
 * error.
 */
function grpcFailureFields(
  code: GrpcCode,
  message: string,
  body: unknown,
  httpStatus: number,
  endpoint: GrpcEndpoint
) {
  const schema = endpoint.errors?.[code]
  const parsed = schema?.safeParse(body)

  return {
    message: message || `gRPC ${codeName(code)}`,
    status: httpStatus,
    kind: kindFromGrpcCode(code),
    code: codeName(code).toUpperCase(),
    grpcCode: code,
    data: parsed?.success ? parsed.data : body,
    dataParsed: parsed?.success === true,
    errorKey: parsed?.success === true ? code : undefined,
  }
}

async function readJson(res: Response): Promise<unknown> {
  try {
    const text = await res.text()
    if (!text.trim()) return {}
    return JSON.parse(text)
  } catch {
    // A proxy's HTML error page is not a Connect body; report the status rather
    // than a SyntaxError over it.
    return {}
  }
}

export function grpcTransport(
  config: GrpcTransportConfig = {}
): TransportAdapter<'grpc'> {
  const codecFor = (endpoint: GrpcEndpoint): GrpcCodec | undefined =>
    endpoint.codec ?? config.codec

  return {
    kind: 'grpc',
    apiVersion: TRANSPORT_API_VERSION,

    capabilities: {
      // One message in, one message out. There is no upload to observe, and the
      // response is consumed whole rather than streamed.
      uploadProgress: false,
      downloadProgress: false,
      responseTypes: ['json'],
    },

    validate(endpoint, endpointId) {
      const grpc = endpoint as GrpcEndpoint

      if (!grpc.service || typeof grpc.service !== 'string') {
        throw new Error(
          `[typefetch-grpc] Endpoint "${endpointId}" is missing \`service\` ` +
            `(the fully-qualified name, e.g. "user.v1.UserService").`
        )
      }

      if (!grpc.rpc || typeof grpc.rpc !== 'string') {
        throw new Error(
          `[typefetch-grpc] Endpoint "${endpointId}" is missing \`rpc\` ` +
            `(the method name, e.g. "GetUser").`
        )
      }
    },

    describe(endpoint) {
      const grpc = endpoint as GrpcEndpoint
      return {
        protocol: 'gRPC',
        operation: 'unary',
        target: `${grpc.service}/${grpc.rpc}`,
      }
    },

    build(ctx: TransportContext): TransportRequest {
      const endpoint = ctx.endpoint as GrpcEndpoint
      const base = config.baseUrl ?? ctx.baseUrl
      const url = `${base.replace(/\/+$/, '')}/${endpoint.service}/${endpoint.rpc}`

      const codec = codecFor(endpoint)
      const deadline = endpoint.deadlineMs ?? config.deadlineMs

      const headers: Record<string, string> = {
        [PROTOCOL_VERSION_HEADER]: '1',
        ...config.headers,
      }

      if (ctx.token) headers['Authorization'] = `Bearer ${ctx.token}`

      if (deadline !== undefined) {
        // Both spellings: Connect servers read the first, grpc-web proxies the
        // second, and sending both costs nothing.
        headers['Connect-Timeout-Ms'] = String(deadline)
        headers['grpc-timeout'] = `${deadline}m`
      }

      if (codec) {
        headers['Content-Type'] =
          codec.contentType ?? DEFAULT_BINARY_CONTENT_TYPE
        headers['X-Grpc-Web'] = '1'

        const framed = encodeFrame(codec.encode(ctx.input))

        return {
          url,
          init: {
            method: 'POST',
            headers,
            body: framed as unknown as BodyInit,
          },
          parts: { headers: {}, isStructured: false, body: ctx.input },
        }
      }

      headers['Content-Type'] = JSON_CONTENT_TYPE

      return {
        url,
        init: {
          method: 'POST',
          headers,
          body: JSON.stringify(ctx.input ?? {}),
        },
        parts: { headers: {}, isStructured: false, body: ctx.input },
      }
    },

    /**
     * Decode a 2xx.
     *
     * On the binary path this can still fail: grpc-web answers `200 OK` for
     * *every* outcome and reports the real one in a trailer, so the only place a
     * `NOT_FOUND` can be detected is here. Throwing a `RichError` puts it on the
     * client's normal failure path, so `onError`, retries and instrumentation
     * behave exactly as they do for any other transport.
     */
    async decode(
      res: Response,
      ctx: TransportContext
    ): Promise<TransportDecoded> {
      const endpoint = ctx.endpoint as GrpcEndpoint
      const codec = codecFor(endpoint)

      if (!codec) {
        // Connect JSON: a 2xx body is the response message, nothing around it.
        return { value: await readJson(res), enveloped: false }
      }

      const buffer = new Uint8Array(await res.arrayBuffer())
      const frames = decodeFrames(buffer)

      const trailer =
        trailerFromHeaders(res.headers) ??
        (() => {
          const frame = frames.find((f) => f.trailer)
          return frame ? parseTrailer(frame.payload) : undefined
        })()

      if (!trailer) {
        throw new RichError(
          grpcFailureFields(
            GrpcCode.DataLoss,
            'gRPC response ended without a trailer. If this is a browser and ' +
              'the server is cross-origin, it most likely did not expose the ' +
              'trailer via `Access-Control-Expose-Headers: grpc-status, ' +
              'grpc-message`.',
            undefined,
            res.status,
            endpoint
          ) as never
        )
      }

      const code = parseCode(trailer['grpc-status'])

      if (code !== GrpcCode.Ok) {
        throw new RichError(
          grpcFailureFields(
            code,
            trailer['grpc-message'] ?? '',
            trailer,
            statusFromGrpcCode(code),
            endpoint
          ) as never
        )
      }

      const message = frames.find((f) => !f.trailer)

      return {
        value: message ? codec.decode(message.payload) : {},
        enveloped: false,
      }
    },

    async fail(
      res: Response,
      ctx: TransportContext
    ): Promise<TransportFailure> {
      const endpoint = ctx.endpoint as GrpcEndpoint

      // A trailers-only rejection can arrive with a non-2xx status too.
      const headerTrailer = trailerFromHeaders(res.headers)
      if (headerTrailer) {
        const code = parseCode(headerTrailer['grpc-status'])
        return {
          error: grpcFailureFields(
            code,
            headerTrailer['grpc-message'] ?? '',
            headerTrailer,
            res.status,
            endpoint
          ) as never,
          body: headerTrailer,
          wasJson: false,
          enveloped: false,
        }
      }

      const body = (await readJson(res)) as ConnectErrorBody

      // A Connect error body names its own code; anything else (a proxy's 502,
      // a gateway's 401) has to have one derived from the status.
      const code =
        body?.code !== undefined
          ? parseCode(body.code)
          : codeFromHttpStatus(res.status)

      return {
        error: grpcFailureFields(
          code,
          body?.message ?? res.statusText ?? '',
          body,
          res.status,
          endpoint
        ) as never,
        body,
        wasJson: true,
        enveloped: false,
      }
    },
  }
}
