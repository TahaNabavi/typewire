import type { AnyEndpointDefZ, TransportDescription } from '../types'
import type { TransportAdapter } from './adapter'
import { httpTransport } from './http'

/**
 * Describe an endpoint without a client.
 *
 * Tooling routinely holds contracts but no client — a CLI listing endpoints, a
 * lint rule, a doc generator. They still must not read `endpoint.method`
 * directly, because the transport registry is open and that field does not
 * exist on every variant.
 *
 * Unknown transports degrade rather than throw: a listing that omits one route
 * is a worse outcome than one that prints it with a `?` target, and a tool built
 * before a transport existed should still run against contracts that use it.
 */
export function describeEndpoint(
  endpoint: AnyEndpointDefZ,
  adapters: Iterable<TransportAdapter> = [httpTransport as TransportAdapter]
): TransportDescription {
  const kind = (endpoint as { transport?: string }).transport ?? 'http'

  for (const adapter of adapters) {
    if (adapter.kind === kind) return adapter.describe(endpoint)
  }

  return { protocol: kind, operation: '?', target: '?' }
}
