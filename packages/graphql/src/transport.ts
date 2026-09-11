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
  DocumentGenerationError,
  generateDocument,
  operationNameFrom,
  operationNameOf,
} from './document'
import { graphqlFailureFields } from './errors'
import type {
  GraphqlEndpointFields,
  GraphqlResponseBody,
  GraphqlTransportConfig,
} from './types'

type GraphqlEndpoint = AnyEndpointDefZ & GraphqlEndpointFields

/**
 * The two media types a GraphQL server may answer with.
 *
 * Both are asked for, most-preferred first. The newer one lets a failure carry a
 * real HTTP status, which is what puts it through the client's `fail` path; the
 * legacy one answers 200 with the errors inside the body, which is why `decode`
 * has to be able to fail too.
 */
const ACCEPT = 'application/graphql-response+json, application/json'

/**
 * Documents are generated once per endpoint, not once per request.
 *
 * Keyed on the contract object, which is stable for the client's lifetime, and
 * weak so a discarded contract does not pin its document.
 */
const documentCache = new WeakMap<object, { query: string; name: string }>()

function resolveDocument(
  endpoint: GraphqlEndpoint,
  endpointId: string
): { query: string; name: string } {
  const cached = documentCache.get(endpoint)
  if (cached) return cached

  const fallbackName =
    endpoint.operationName ?? operationNameFrom(endpointId || 'Anonymous')

  const resolved = endpoint.document
    ? {
        query: endpoint.document,
        name:
          endpoint.operationName ??
          operationNameOf(endpoint.document) ??
          fallbackName,
      }
    : {
        query: generateDocument({
          operation: endpoint.operation,
          request: endpoint.request,
          response: endpoint.response,
          root: endpoint.root,
          operationName: fallbackName,
          variableTypes: endpoint.variableTypes,
        }),
        name: fallbackName,
      }

  documentCache.set(endpoint, resolved)
  return resolved
}

/** `data`, or `data[root]` when the endpoint declared one. */
function unwrap(body: GraphqlResponseBody, root: string | undefined): unknown {
  if (!root) return body.data
  return (body.data as Record<string, unknown> | null | undefined)?.[root]
}

async function readBody(res: Response): Promise<GraphqlResponseBody> {
  try {
    const text = await res.text()
    if (!text.trim()) return {}
    return JSON.parse(text) as GraphqlResponseBody
  } catch {
    // A gateway's HTML error page is not a GraphQL response; report the status
    // rather than a SyntaxError over it.
    return {}
  }
}

export function graphqlTransport(
  config: GraphqlTransportConfig = {}
): TransportAdapter<'graphql'> {
  return {
    kind: 'graphql',
    apiVersion: TRANSPORT_API_VERSION,

    capabilities: {
      // A GraphQL operation is one JSON POST; there is no upload to observe, and
      // the response is consumed whole rather than streamed.
      uploadProgress: false,
      downloadProgress: false,
      responseTypes: ['json'],
    },

    /**
     * Generate the document at `init()` rather than on the first call.
     *
     * A schema the generator cannot express — a union, a `z.record`, a cycle —
     * is a permanent property of the contract, so it should stop the client
     * being built, with the endpoint named, rather than fail one request in
     * production much later.
     */
    validate(endpoint, endpointId) {
      const gql = endpoint as GraphqlEndpoint

      if (gql.operation !== 'query' && gql.operation !== 'mutation') {
        throw new Error(
          `[typefetch-graphql] Endpoint "${endpointId}" must declare ` +
            `operation: "query" | "mutation".`
        )
      }

      try {
        resolveDocument(gql, endpointId)
      } catch (error) {
        if (error instanceof DocumentGenerationError) {
          throw new Error(
            `[typefetch-graphql] Could not generate a document for ` +
              `"${endpointId}": ${error.message}`
          )
        }
        throw error
      }
    },

    describe(endpoint) {
      const gql = endpoint as GraphqlEndpoint
      return {
        protocol: 'GraphQL',
        operation: gql.operation,
        target: gql.root ?? gql.operationName ?? gql.operation,
      }
    },

    build(ctx: TransportContext): TransportRequest {
      const endpoint = ctx.endpoint as GraphqlEndpoint
      const { query, name } = resolveDocument(endpoint, ctx.endpointId)
      const variables = (ctx.input ?? {}) as Record<string, unknown>

      const url = config.url ?? `${ctx.baseUrl}/graphql`
      const headers: Record<string, string> = {
        Accept: ACCEPT,
        ...config.headers,
      }

      if (ctx.token) headers['Authorization'] = `Bearer ${ctx.token}`

      // Mutations always POST. A mutation over GET is cacheable by anything
      // between the client and the server, which is a way to lose a write.
      const useGet = config.method === 'GET' && endpoint.operation === 'query'

      if (useGet) {
        const params = new URLSearchParams({ query, operationName: name })
        if (Object.keys(variables).length) {
          params.set('variables', JSON.stringify(variables))
        }

        return {
          url: `${url}${url.includes('?') ? '&' : '?'}${params.toString()}`,
          init: { method: 'GET', headers },
          parts: { headers: {}, isStructured: false, body: variables },
        }
      }

      headers['Content-Type'] = 'application/json'

      return {
        url,
        init: {
          method: 'POST',
          headers,
          body: JSON.stringify({ query, variables, operationName: name }),
        },
        parts: { headers: {}, isStructured: false, body: variables },
      }
    },

    /**
     * Decode a 2xx.
     *
     * This can still fail: on the legacy `application/json` media type a server
     * reports errors *inside* a 200, so the only place they can be detected is
     * here. Throwing a `RichError` puts it on the client's normal failure path,
     * so `onError`, retries and instrumentation all behave as they would for any
     * other transport.
     */
    async decode(
      res: Response,
      ctx: TransportContext
    ): Promise<TransportDecoded> {
      const endpoint = ctx.endpoint as GraphqlEndpoint
      const body = await readBody(res)
      const errors = body.errors ?? []
      const policy = endpoint.errorPolicy ?? config.errorPolicy ?? 'none'

      if (errors.length) {
        const partial = body.data != null && policy === 'all'

        if (!partial) {
          throw new RichError(
            graphqlFailureFields(body, res.status, endpoint.errors) as never
          )
        }

        // Resolving half a result while dropping the reason for the other half
        // is how a null reaches a UI three screens from its cause.
        config.onPartialErrors?.(errors, {
          endpointId: ctx.endpointId,
          route: this.describe(endpoint),
        })
      }

      return {
        value: unwrap(body, endpoint.root),
        // GraphQL brings its own envelope; running the client's `responseWrapper`
        // over an already-unwrapped `data` would look for a second one.
        enveloped: false,
      }
    },

    async fail(
      res: Response,
      ctx: TransportContext
    ): Promise<TransportFailure> {
      const endpoint = ctx.endpoint as GraphqlEndpoint
      const body = await readBody(res)

      // A transport-level failure with no GraphQL error array at all — a 502
      // from a proxy, a 401 from a gateway that never reached the resolver.
      if (!body.errors?.length) {
        return {
          error: {
            message: res.statusText || `HTTP ${res.status}`,
            status: res.status,
            kind: res.status >= 500 ? 'internal' : 'invalid_argument',
            data: body,
            dataParsed: false,
          },
          body,
          wasJson: true,
          enveloped: false,
        }
      }

      return {
        error: graphqlFailureFields(body, res.status, endpoint.errors) as never,
        body,
        wasJson: true,
        enveloped: false,
      }
    },
  }
}
