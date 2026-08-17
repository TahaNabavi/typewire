import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PARSED_REQUEST_KEY, TYPEFETCH_MODULE_OPTIONS } from "../constants";
import {
  ContractResponseViolationException,
  formatZodIssues,
} from "../exceptions";
import type { TypeFetchModuleOptions } from "../types";
import { validateRequest } from "../validation/request-validator";
import { GRAPHQL_MODULE_OPTIONS } from "./constants";
import { GraphqlException, toGraphqlError } from "./errors";
import { ContractGraphQLRegistry } from "./registry";
import type { ContractGraphQLOptions, GraphqlOperation } from "./types";

/** The `application/graphql-response+json` media type, per the spec. */
const GRAPHQL_MEDIA_TYPE = "application/graphql-response+json";

export type GraphqlHttpResult = {
  status: number;
  contentType: string;
  body: { data?: unknown; errors?: unknown[] };
};

/** What arrived, whichever way it arrived. */
type GraphqlRequestBody = {
  query?: string;
  variables: Record<string, unknown>;
  operationName?: string;
};

/**
 * One GraphQL request, start to finish
 * ====================================
 * Resolve the operation by name → validate the variables against `request` →
 * run the resolver through NestJS's pipeline → validate the result against
 * `response` → answer `{ data }` or `{ errors }`.
 *
 * **No document is executed.** Both ends generate their operation from the same
 * contract, so the selection set the client sent *is* the `response` schema —
 * returning what that schema describes is returning exactly what was asked for.
 * That is what makes a GraphQL server possible here with no GraphQL runtime,
 * and it is also the limit: see the README for when to reach for
 * `@nestjs/graphql` instead.
 */
@Injectable()
export class ContractGraphQLDispatcher {
  private readonly logger = new Logger("TypeWireGraphQL");

  constructor(
    @Inject(GRAPHQL_MODULE_OPTIONS)
    private readonly options: ContractGraphQLOptions,
    @Inject(ContractGraphQLRegistry)
    private readonly registry: ContractGraphQLRegistry,
    @Optional()
    @Inject(TYPEFETCH_MODULE_OPTIONS)
    private readonly moduleOptions?: TypeFetchModuleOptions,
  ) {}

  async execute(
    request: any,
    response: unknown,
    method: "POST" | "GET",
  ): Promise<GraphqlHttpResult> {
    // Negotiated once, up front: it decides whether a failure carries its real
    // status or has to hide inside a 200, and every exit below needs the answer.
    const modern = acceptsGraphqlMediaType(request);

    try {
      // Read once: parsing `variables` can itself fail, and doing it twice
      // would risk two different answers for one request.
      const body = readRequest(request, method);
      const operation = this.locate(body, method);
      const data = await this.run(operation, body, request, response);

      return {
        status: 200,
        contentType: modern ? GRAPHQL_MEDIA_TYPE : "application/json",
        body: { data: operation.root ? { [operation.root]: data } : data },
      };
    } catch (error) {
      const { error: payload, status } = toGraphqlError(error);

      if (status >= 500) {
        this.logger.error(
          error instanceof Error ? (error.stack ?? error.message) : String(error),
        );
      }

      return {
        // The legacy media type has no way to carry a status: a GraphQL error
        // inside a 200 is what `application/json` means, and typefetch's
        // transport reads `extensions.http.status` to recover the real one.
        status: modern ? status : 200,
        contentType: modern ? GRAPHQL_MEDIA_TYPE : "application/json",
        body: { errors: [payload] },
      };
    }
  }

  private locate(
    body: GraphqlRequestBody,
    method: "POST" | "GET",
  ): GraphqlOperation {
    const { query, operationName } = body;
    const operation = this.registry.resolve(operationName, query);

    if (!operation) {
      throw new GraphqlException(
        "OPERATION_RESOLUTION_FAILURE",
        operationName
          ? `No resolver for operation "${operationName}"`
          : "No operation name was sent, and the document does not name one",
      );
    }

    if (method === "GET" && operation.endpoint.operation !== "query") {
      // A mutation over GET is cacheable by everything between the client and
      // the server, which is a way to lose — or replay — a write.
      throw new GraphqlException(
        "BAD_REQUEST",
        `"${operation.operationName}" is a mutation and cannot be sent over GET`,
        {},
        405,
      );
    }

    return operation;
  }

  private async run(
    operation: GraphqlOperation,
    body: GraphqlRequestBody,
    request: any,
    response: unknown,
  ): Promise<unknown> {
    const { variables } = body;
    const validate = this.resolveValidation();

    if (validate.validateRequest) {
      const parsed = validateRequest(
        operation.endpoint,
        { params: {}, query: {}, body: variables, headers: request.headers ?? {} },
        { coerce: validate.coerce },
      );

      // The same key the HTTP interceptor writes, so `@ContractInput()` and the
      // granular `@Contract*()` decorators work in a resolver unchanged.
      try {
        request[PARSED_REQUEST_KEY] = parsed;
      } catch {
        /* frozen request — the resolver falls back to the raw variables */
      }
    }

    const result = await operation.invoke(request, response);

    if (!validate.validateResponse) return result;

    const parsed = operation.endpoint.response.safeParse(result);
    if (!parsed.success) {
      const errors = formatZodIssues(parsed.error);
      this.logger.error(
        `Response contract violation on ${operation.endpointId}: ${JSON.stringify(errors)}`,
      );
      throw new ContractResponseViolationException(
        errors,
        this.moduleOptions?.exposeResponseErrors ?? false,
      );
    }

    return parsed.data;
  }

  private resolveValidation() {
    return {
      validateRequest: true,
      validateResponse: true,
      coerce: true,
      ...this.moduleOptions,
    };
  }

  /** Everything this dispatcher serves, for a diagnostics route or a test. */
  operations(): GraphqlOperation[] {
    return this.registry.operations();
  }

  get path(): string {
    return this.options.path ?? "/graphql";
  }
}

/**
 * Pull `{ query, variables, operationName }` out of either shape.
 *
 * POST carries them as a JSON body; GET carries them as query parameters with
 * `variables` JSON-encoded, which is what makes a query CDN-cacheable and is
 * why typefetch's transport offers it.
 */
export function readRequest(
  request: any,
  method: string,
): GraphqlRequestBody {
  const source =
    method === "GET" ? (request?.query ?? {}) : (request?.body ?? {});

  const variables =
    typeof source.variables === "string"
      ? parseVariables(source.variables)
      : isRecord(source.variables)
        ? source.variables
        : {};

  return {
    ...(typeof source.query === "string" ? { query: source.query } : {}),
    ...(typeof source.operationName === "string" && source.operationName
      ? { operationName: source.operationName }
      : {}),
    variables,
  };
}

function parseVariables(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    throw new GraphqlException(
      "GRAPHQL_PARSE_FAILED",
      "`variables` is not valid JSON",
      {},
      400,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Whether the caller understands the media type that lets a failure carry a
 * real HTTP status. typefetch asks for it first; an older client asks only for
 * `application/json` and must be answered inside a 200.
 */
function acceptsGraphqlMediaType(request: any): boolean {
  const accept = request?.headers?.accept;
  return typeof accept === "string" && accept.includes(GRAPHQL_MEDIA_TYPE);
}
