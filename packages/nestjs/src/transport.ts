import type { AnyEndpointDefZ, EndpointDefZ } from '@tahanabavi/typefetch'

/**
 * Which wire an endpoint was declared for
 * =======================================
 * typefetch's `TransportRegistry` is an open interface: `http` is built in and
 * every other wire is added by installing its package. A server binding those
 * contracts therefore faces the same rule the client does — **it may never read
 * a transport-specific field without knowing the transport first**, because
 * `endpoint.method` does not exist on a gRPC route and `endpoint.service` does
 * not exist on an HTTP one.
 *
 * These two helpers are the whole of that discipline on this side.
 */

/**
 * The endpoint's transport. `transport` is optional on `http` endpoints, so
 * omitting it means HTTP — which is what keeps every contract written before
 * transports were pluggable meaning exactly what it did.
 */
export function transportOf(endpoint: AnyEndpointDefZ): string {
  return (endpoint as { transport?: string }).transport ?? 'http'
}

/** Narrows to the HTTP variant, the only one carrying `method` and `path`. */
export function isHttpEndpoint(
  endpoint: AnyEndpointDefZ
): endpoint is EndpointDefZ {
  return transportOf(endpoint) === 'http'
}

/**
 * Which decorator serves each transport, named so a mismatch says what to do
 * rather than only what went wrong.
 *
 * Every wire is bound by its own decorator from its own entry point — the
 * mirror of the client, where a transport is registered explicitly at the setup
 * site rather than inferred. That symmetry is the point: if the server could
 * silently serve a transport the client never registered, the two halves of one
 * contract could disagree about which wire they are on.
 */
const SERVED_BY: Record<string, string> = {
  http: '`@TypeFetchEndpoint()` from "@tahanabavi/typewire-nestjs"',
  grpc: '`@GrpcEndpoint()` from "@tahanabavi/typewire-nestjs/grpc"',
  graphql: '`@GraphQLEndpoint()` from "@tahanabavi/typewire-nestjs/graphql"',
}

/**
 * Reject an endpoint bound by the wrong decorator, **at class-definition time**
 * rather than on the first request.
 *
 * A decorator runs while the module is being loaded, so this throws during
 * bootstrap with the route named — the same guarantee the client gives by
 * calling every adapter's `validate()` in `init()`.
 */
export function assertTransport(
  endpoint: AnyEndpointDefZ,
  expected: string,
  decorator: string
): void {
  const actual = transportOf(endpoint)
  if (actual === expected) return

  const target = SERVED_BY[actual]
  const route = describeContractRoute(endpoint)

  throw new Error(
    `[typewire-nestjs] ${decorator} serves "${expected}" endpoints, but ` +
      `${route} is declared for "${actual}". ` +
      (target
        ? `Bind it with ${target} instead.`
        : `No decorator in this package serves "${actual}" — bind it yourself ` +
          `and use @UseContract() for validation.`)
  )
}

/**
 * Best-effort identification of a route for a log line or an error message,
 * without reading a field the transport may not have.
 *
 * Mirrors the client's `describe()` seam, but this package holds no adapters to
 * ask — so it reads the fields each transport is known to declare and degrades
 * to a generic phrase rather than throwing on one it has never heard of.
 */
export function describeContractRoute(endpoint: AnyEndpointDefZ): string {
  const any = endpoint as Record<string, unknown>

  if (typeof any.method === 'string' && typeof any.path === 'string') {
    return `${any.method} ${any.path}`
  }
  if (typeof any.service === 'string' && typeof any.rpc === 'string') {
    return `${any.service}/${any.rpc}`
  }
  if (typeof any.operation === 'string') {
    const name = any.operationName ?? any.root
    return typeof name === 'string'
      ? `${any.operation} ${name}`
      : String(any.operation)
  }

  return 'the endpoint'
}
