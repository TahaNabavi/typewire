/**
 * `@tahanabavi/typewire-nestjs/graphql`
 * ====================================
 * Serve GraphQL contracts from NestJS with **no GraphQL runtime**: no `graphql`
 * package, no schema file, no code generation.
 *
 * That is possible because of what `@tahanabavi/typefetch-graphql` does on the
 * other end — it generates the operation document *from the endpoint's Zod
 * `response` schema*. Both halves therefore agree on the selection set by
 * construction, so an operation can be addressed by name and answered from the
 * same schema that asked for it.
 *
 * What that buys, and what it costs, is in the README under "A contract server,
 * not a GraphQL server".
 */

export { GraphQLEndpoint } from "./graphql-endpoint.decorator";
export { ContractGraphQLModule } from "./module";
export { ContractGraphQLDispatcher } from "./dispatcher";
export type { GraphqlHttpResult } from "./dispatcher";
export { ContractGraphQLRegistry } from "./registry";
export { createGraphQLController } from "./controller";
export {
  GraphqlException,
  graphqlCodeFromStatus,
  statusFromGraphqlCode,
  toGraphqlError,
} from "./errors";
export type { GraphqlErrorPayload } from "./errors";
export { rootFieldIn } from "./document";
export {
  GRAPHQL_ENDPOINT_METADATA,
  GRAPHQL_MODULE_OPTIONS,
} from "./constants";
export type {
  ContractGraphQLOptions,
  GraphqlContractEndpoint,
  GraphqlEndpointOptions,
  GraphqlOperation,
} from "./types";
