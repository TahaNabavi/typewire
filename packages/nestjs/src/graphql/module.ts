import { DynamicModule, Module } from '@nestjs/common'
import { DiscoveryModule } from '@nestjs/core'
import { GRAPHQL_MODULE_OPTIONS } from './constants'
import { createGraphQLController } from './controller'
import { ContractGraphQLDispatcher } from './dispatcher'
import { ContractGraphQLRegistry } from './registry'
import type { ContractGraphQLOptions } from './types'

/**
 * Mount a contract-driven GraphQL endpoint.
 *
 * ```ts
 * ⁣@Module({
 *   imports: [ContractGraphQLModule.forRoot({ contracts })],
 *   providers: [UserResolver],
 * })
 * export class AppModule {}
 * ```
 *
 * Resolvers are ordinary providers carrying `@GraphQLEndpoint()`; the module
 * discovers them at bootstrap, so nothing has to be listed twice. `contracts`
 * is required — see {@link ContractGraphQLOptions.contracts} for why the module
 * cannot work out an operation's name without it.
 */
@Module({})
export class ContractGraphQLModule {
  static forRoot(options: ContractGraphQLOptions): DynamicModule {
    const path = options.path ?? '/graphql'
    const allowGet = options.allowGet ?? true

    return {
      module: ContractGraphQLModule,
      // `DiscoveryService` finds the resolvers; `ExternalContextCreator` — used
      // by the registry to run each one through guards and interceptors — is
      // provided by Nest's internal core module and needs no import.
      imports: [DiscoveryModule],
      controllers: [createGraphQLController(path, allowGet)],
      providers: [
        { provide: GRAPHQL_MODULE_OPTIONS, useValue: options },
        ContractGraphQLRegistry,
        ContractGraphQLDispatcher,
      ],
      exports: [ContractGraphQLDispatcher, ContractGraphQLRegistry],
    }
  }
}
