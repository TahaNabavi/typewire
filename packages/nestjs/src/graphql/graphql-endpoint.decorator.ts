import { SetMetadata, applyDecorators } from '@nestjs/common'
import {
  TYPEFETCH_ENDPOINT_METADATA,
  TYPEFETCH_OPTIONS_METADATA,
} from '../constants'
import { assertTransport } from '../transport'
import { GRAPHQL_ENDPOINT_METADATA } from './constants'
import type { GraphqlContractEndpoint, GraphqlEndpointOptions } from './types'

/**
 * Bind a resolver to a GraphQL contract endpoint.
 *
 * Unlike `@TypeFetchEndpoint()` this declares **no route**: every operation
 * arrives at the one endpoint `ContractGraphQLModule` mounts, which dispatches
 * on the operation name. So the decorated method can live on a controller or on
 * any provider — a `UserResolver` class registered as a provider is the natural
 * home.
 *
 * Everything else is the same as an HTTP route. Guards run (including the
 * contract permission guard, which reads `endpoint.permission` off the same
 * metadata this sets), interceptors run, `@ContractInput()` returns the
 * validated variables, and the return value is validated against `response`
 * before it is put on the wire.
 *
 * @example
 * ⁣@Injectable()
 * class UserResolver {
 *   ⁣@GraphQLEndpoint(contracts.user.getUser)   // transport: "graphql"
 *   getUser(
 *     ⁣@ContractInput() input: InferRequest<typeof contracts.user.getUser>,
 *   ) {
 *     return this.users.byId(input.id);
 *   }
 * }
 */
export function GraphQLEndpoint(
  endpoint: GraphqlContractEndpoint,
  options: GraphqlEndpointOptions = {}
): MethodDecorator {
  assertTransport(endpoint, 'graphql', '@GraphQLEndpoint()')

  if (endpoint.operation !== 'query' && endpoint.operation !== 'mutation') {
    throw new Error(
      `[typewire-nestjs] A GraphQL endpoint must declare ` +
        `operation: "query" | "mutation" (got ` +
        `${JSON.stringify(endpoint.operation)}). It is what decides whether ` +
        `the operation may be served over GET.`
    )
  }

  return applyDecorators(
    // The discovery marker. `TYPEFETCH_ENDPOINT_METADATA` is what guards read,
    // and is set to the same object so `getContractEndpoint()` works in a
    // resolver exactly as it does in a controller.
    SetMetadata(GRAPHQL_ENDPOINT_METADATA, endpoint),
    SetMetadata(TYPEFETCH_ENDPOINT_METADATA, endpoint),
    SetMetadata(TYPEFETCH_OPTIONS_METADATA, options)
  )
}
