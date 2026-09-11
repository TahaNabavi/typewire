import type { AnyEndpointDefZ, Contracts } from '@tahanabavi/typefetch'
import type { GraphqlEndpointFields } from '@tahanabavi/typefetch-graphql'
import type { ContractEndpointOptions } from '../types'

/**
 * A contract endpoint declared for the GraphQL transport.
 *
 * `GraphqlEndpointFields` comes from `@tahanabavi/typefetch-graphql`, the same
 * package that augments typefetch's `TransportRegistry` with
 * `transport: "graphql"` — so this entry point's peer dependency is not an
 * extra cost: without it, the contract could not have been written.
 */
export type GraphqlContractEndpoint = AnyEndpointDefZ & GraphqlEndpointFields

export type GraphqlEndpointOptions = ContractEndpointOptions

export interface ContractGraphQLOptions {
  /**
   * The contracts object both halves of the app import.
   *
   * Required, and not merely convenient: a GraphQL operation is addressed by
   * **name**, and the name typefetch sends is derived from the endpoint's
   * `"module.endpoint"` id (`user.getUser` → `UserGetUser`). An endpoint object
   * on its own does not know its own id, so the only way to reconstruct the
   * name the client will send is to look the object up in the map it came from.
   *
   * It is also what lets the module report, at bootstrap, which declared
   * operations no resolver claimed.
   */
  contracts: Contracts

  /** Where the endpoint is mounted. Defaults to `/graphql`. */
  path?: string

  /**
   * Also accept `GET` (`?query=…&variables=…`), which is what the client sends
   * when its transport is configured with `method: "GET"` to make queries
   * CDN-cacheable. Defaults to `true`; mutations are refused over GET either
   * way.
   */
  allowGet?: boolean

  /**
   * Fail bootstrap when a GraphQL endpoint in `contracts` has no resolver.
   *
   * Off by default, because a repo commonly serves one API surface from several
   * services. Turn it on in the service that owns the whole schema and an
   * unimplemented operation stops being a runtime 404.
   */
  requireAllResolvers?: boolean
}

/** One resolvable operation, as the registry holds it. */
export type GraphqlOperation = {
  /** The name the client sends — `endpoint.operationName`, else derived. */
  operationName: string
  /** Stable `"module.endpoint"` id. */
  endpointId: string
  endpoint: GraphqlContractEndpoint
  /** The field the result is nested under in `data`, when the contract declares one. */
  root?: string
  /** Runs the resolver through NestJS's guard/interceptor pipeline. */
  invoke: (request: unknown, response: unknown) => Promise<unknown>
}
