import { Inject, Injectable, Logger, OnModuleInit } from "@nestjs/common";
import {
  DiscoveryService,
  ExternalContextCreator,
  MetadataScanner,
} from "@nestjs/core";
import type { ParamsFactory } from "@nestjs/core/helpers/external-context-creator";
import type { AnyEndpointDefZ } from "@tahanabavi/typefetch";
import { operationNameFrom, operationNameOf } from "@tahanabavi/typefetch-graphql";
import { transportOf } from "../transport";
import { rootFieldIn } from "./document";
import {
  CUSTOM_ROUTE_ARGS_METADATA,
  GRAPHQL_ENDPOINT_METADATA,
  GRAPHQL_MODULE_OPTIONS,
  ROUTE_ARGS_METADATA,
} from "./constants";
import type {
  ContractGraphQLOptions,
  GraphqlContractEndpoint,
  GraphqlOperation,
} from "./types";

/**
 * Only `@Req()` and `@Res()` mean anything in a resolver.
 *
 * The rest of Nest's built-in parameter decorators describe an HTTP request
 * that is not the one being served: `@Body()` here is the GraphQL envelope
 * (`{ query, variables }`), `@Param()` is empty because the route is
 * `/graphql`, and `@Query()` is the *URL* query string rather than the
 * operation. Each would return something plausible and wrong, so they are
 * refused at bootstrap instead. `@ContractInput()` is the one that answers what
 * they were reaching for.
 */
const ALLOWED_BUILTIN_PARAMS = new Set([0, 1]);

const PARAMS_FACTORY: ParamsFactory = {
  exchangeKeyForValue(type: number, _data: unknown, args: unknown[]) {
    return type === 0 ? args[0] : args[1];
  },
};

/**
 * The operation index
 * ===================
 * Built once, at bootstrap, by walking every provider and controller for
 * methods carrying `@GraphQLEndpoint()`.
 *
 * Discovery rather than registration because a resolver is an ordinary NestJS
 * provider: it is constructed by the container, it can inject anything, and it
 * carries guards and interceptors like any other handler. Asking for a second
 * list of them somewhere would be a list that goes stale.
 */
@Injectable()
export class ContractGraphQLRegistry implements OnModuleInit {
  private readonly logger = new Logger("TypeWireGraphQL");
  private readonly scanner = new MetadataScanner();

  private readonly byName = new Map<string, GraphqlOperation>();
  private readonly byRoot = new Map<string, GraphqlOperation>();

  // Explicit tokens: the published build does not emit `design:paramtypes`, so
  // by-type injection would resolve to `Object` there.
  constructor(
    @Inject(GRAPHQL_MODULE_OPTIONS)
    private readonly options: ContractGraphQLOptions,
    @Inject(DiscoveryService) private readonly discovery: DiscoveryService,
    @Inject(ExternalContextCreator)
    private readonly externalContextCreator: ExternalContextCreator,
  ) {}

  onModuleInit(): void {
    const declared = this.declaredOperations();

    for (const wrapper of [
      ...this.discovery.getProviders(),
      ...this.discovery.getControllers(),
    ]) {
      const instance = wrapper.instance as Record<string, unknown> | undefined;
      if (!instance || typeof instance !== "object") continue;

      const prototype = Object.getPrototypeOf(instance);
      if (!prototype) continue;

      for (const methodName of this.scanner.getAllMethodNames(prototype)) {
        const callback = prototype[methodName];
        const endpoint: GraphqlContractEndpoint | undefined =
          Reflect.getMetadata(GRAPHQL_ENDPOINT_METADATA, callback);
        if (!endpoint) continue;

        this.register(instance, callback, methodName, endpoint, declared);
      }
    }

    this.reportUnbound(declared);
  }

  /** Every GraphQL operation the contracts declare, keyed by endpoint object. */
  private declaredOperations(): Map<
    object,
    { endpointId: string; operationName: string }
  > {
    const declared = new Map<
      object,
      { endpointId: string; operationName: string }
    >();

    for (const [module, endpoints] of Object.entries(this.options.contracts)) {
      for (const [name, endpoint] of Object.entries(endpoints)) {
        if (transportOf(endpoint as AnyEndpointDefZ) !== "graphql") continue;

        const endpointId = `${module}.${name}`;
        const declaredName = (endpoint as GraphqlContractEndpoint)
          .operationName;

        declared.set(endpoint as object, {
          endpointId,
          // `operationNameFrom` is the client transport's own rule. Importing it
          // rather than restating it is what keeps the name the server routes on
          // identical to the name the client sends.
          operationName: declaredName ?? operationNameFrom(endpointId),
        });
      }
    }

    return declared;
  }

  private register(
    instance: Record<string, unknown>,
    callback: (...args: unknown[]) => unknown,
    methodName: string,
    endpoint: GraphqlContractEndpoint,
    declared: Map<object, { endpointId: string; operationName: string }>,
  ): void {
    const where = `${instance.constructor?.name ?? "resolver"}.${methodName}()`;
    const identity = declared.get(endpoint as object);

    if (!identity && !endpoint.operationName) {
      throw new Error(
        `[typewire-nestjs] ${where} resolves a GraphQL endpoint that is not in ` +
          `the \`contracts\` passed to ContractGraphQLModule.forRoot(), and the ` +
          `endpoint declares no \`operationName\`. The operation name the ` +
          `client sends is derived from the endpoint's "module.endpoint" id, ` +
          `which only the contracts object knows.`,
      );
    }

    this.assertResolverParams(instance.constructor as object, methodName, where);

    const operationName =
      identity?.operationName ?? endpoint.operationName ?? "";
    const endpointId = identity?.endpointId ?? operationName;

    const existing = this.byName.get(operationName);
    if (existing) {
      throw new Error(
        `[typewire-nestjs] Two resolvers claim the GraphQL operation ` +
          `"${operationName}": ${where} and the one already bound to ` +
          `"${existing.endpointId}". An operation name addresses exactly one ` +
          `endpoint, the way a method and path do over HTTP.`,
      );
    }

    const operation: GraphqlOperation = {
      operationName,
      endpointId,
      endpoint,
      ...(endpoint.root ? { root: endpoint.root } : {}),
      invoke: this.externalContextCreator.create(
        instance as never,
        callback as never,
        methodName,
        ROUTE_ARGS_METADATA,
        PARAMS_FACTORY,
        undefined,
        undefined,
        // Filters are off on purpose: a NestJS exception filter replies with an
        // HTTP body, and what has to come back here is a GraphQL `errors`
        // array. The dispatcher formats it — see graphql/errors.ts.
        { guards: true, interceptors: true, filters: false },
        // The underlying context genuinely *is* an HTTP request, and saying so
        // is what makes an existing auth guard — the kind that reads
        // `context.switchToHttp().getRequest().user` — work unchanged.
        "http",
      ) as GraphqlOperation["invoke"],
    };

    if (endpoint.encryption) {
      // Named rather than silently skipped: the client's `encryptionMiddleware`
      // *does* run for a GraphQL call, so an endpoint declaring `encryption`
      // would send ciphertext the resolver never decrypts, and the failure
      // would look like a validation error on a field nobody touched.
      this.logger.warn(
        `"${endpointId}" declares \`encryption\`, which is not applied on the ` +
          `GraphQL transport. Its variables reach the resolver as sent.`,
      );
    }

    this.byName.set(operationName, operation);

    if (operation.root && !this.byRoot.has(operation.root)) {
      this.byRoot.set(operation.root, operation);
    }
  }

  /**
   * Refuse the parameter decorators that would silently mislead. Done here, at
   * bootstrap, rather than by returning `undefined` at request time — a
   * resolver reading `@Body()` and getting the GraphQL envelope is a bug that
   * looks like a validation failure three layers away.
   */
  private assertResolverParams(
    target: object,
    methodName: string,
    where: string,
  ): void {
    const metadata = Reflect.getMetadata(
      ROUTE_ARGS_METADATA,
      target,
      methodName,
    ) as Record<string, unknown> | undefined;

    if (!metadata) return;

    for (const key of Object.keys(metadata)) {
      if (key.includes(CUSTOM_ROUTE_ARGS_METADATA)) continue;

      const type = Number(key.split(":")[0]);
      if (Number.isNaN(type) || ALLOWED_BUILTIN_PARAMS.has(type)) continue;

      throw new Error(
        `[typewire-nestjs] ${where} uses a NestJS route parameter decorator ` +
          `that has no meaning in a GraphQL resolver — the HTTP body is the ` +
          `GraphQL envelope, not the operation's variables. Use ` +
          `@ContractInput() for the validated variables; @Req() and @Res() ` +
          `still work.`,
      );
    }
  }

  private reportUnbound(
    declared: Map<object, { endpointId: string; operationName: string }>,
  ): void {
    const unbound = [...declared.values()]
      .filter(({ operationName }) => !this.byName.has(operationName))
      .map(({ endpointId }) => endpointId);

    if (!unbound.length) return;

    const message =
      `${unbound.length} GraphQL endpoint(s) have no resolver: ` +
      unbound.join(", ");

    if (this.options.requireAllResolvers) throw new Error(`[typewire-nestjs] ${message}`);
    this.logger.warn(message);
  }

  /**
   * Find the operation a request is asking for.
   *
   * `operationName` first, because that is what the typefetch transport always
   * sends and what uniquely identifies an endpoint. The document is only read
   * when a hand-written request omitted the name.
   */
  resolve(
    operationName: string | undefined,
    document: string | undefined,
  ): GraphqlOperation | undefined {
    if (operationName) return this.byName.get(operationName);
    if (!document) return undefined;

    const named = operationNameOf(document);
    if (named) return this.byName.get(named);

    const root = rootFieldIn(document);
    return root ? this.byRoot.get(root) : undefined;
  }

  /** Every bound operation, for diagnostics. */
  operations(): GraphqlOperation[] {
    return [...this.byName.values()];
  }
}
