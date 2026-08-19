/** Metadata key marking a method as a GraphQL resolver, used for discovery. */
export const GRAPHQL_ENDPOINT_METADATA = "typewire:graphqlEndpoint";

/** Injection token for the options passed to `ContractGraphQLModule.forRoot()`. */
export const GRAPHQL_MODULE_OPTIONS = "TYPEWIRE_GRAPHQL_OPTIONS";

/**
 * NestJS's own key for a handler's parameter metadata.
 *
 * Spelled out rather than imported because it lives in
 * `@nestjs/common/constants`, which is not part of the package's public entry —
 * `@nestjs/graphql` declares the same literal for the same reason. It is stable:
 * every `createParamDecorator` in the ecosystem writes to it.
 */
export const ROUTE_ARGS_METADATA = "__routeArguments__";

/** The marker `createParamDecorator` puts in a custom parameter's metadata key. */
export const CUSTOM_ROUTE_ARGS_METADATA = "__customRouteArgs__";
