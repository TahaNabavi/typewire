import type { Contracts, EndpointDefZ } from "@tahanabavi/typefetch";
import type { z } from "zod";
import {
  getObjectShape,
  getDefType,
  unwrapSchema,
} from "../validation/zod-utils";
import { toOpenApiSchema, toParameterSchemas } from "./schema";
import type {
  BuildOpenApiOptions,
  JsonSchema,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  OpenApiResponse,
} from "./types";

const VALIDATION_ERROR_SCHEMA = "ContractValidationError";

/**
 * Build an OpenAPI 3.0 document from the same typefetch contracts the
 * frontend client consumes. Method, path, parameters, request body and
 * responses are all derived from each endpoint's Zod `request`/`response`
 * schemas — the docs can never drift from what the client calls.
 *
 * The returned object is structurally an `OpenAPIObject`; hand it to
 * `SwaggerModule.setup()` (see {@link setupContractSwagger}) or serve it
 * yourself.
 */
export function buildOpenApiDocument(
  contracts: Contracts,
  options: BuildOpenApiOptions = {},
): OpenApiDocument {
  const bearerAuth = options.bearerAuth ?? true;
  const includeValidationError = options.includeValidationError ?? true;

  const doc: OpenApiDocument = {
    openapi: "3.0.3",
    info: {
      title: options.info?.title ?? "API",
      version: options.info?.version ?? "1.0.0",
      ...(options.info?.description
        ? { description: options.info.description }
        : {}),
    },
    paths: {},
  };

  if (options.servers?.length) doc.servers = options.servers;

  const tags = new Set<string>();
  let anyAuth = false;

  for (const [moduleName, module] of Object.entries(contracts)) {
    tags.add(moduleName);

    for (const [endpointName, endpoint] of Object.entries(module)) {
      const operation = buildOperation(
        endpoint as EndpointDefZ,
        moduleName,
        endpointName,
        { bearerAuth, includeValidationError, successStatus: options.successStatus },
      );

      if (endpoint.auth) anyAuth = true;

      const routePath = toOpenApiPath(endpoint.path);
      const httpMethod = endpoint.method.toLowerCase() as keyof (typeof doc.paths)[string];

      doc.paths[routePath] ??= {};
      doc.paths[routePath][httpMethod] = operation;
    }
  }

  doc.tags = [...tags].map((name) => ({ name }));

  // ---- components -------------------------------------------------------
  const schemas: Record<string, JsonSchema> = {};
  if (includeValidationError) {
    schemas[VALIDATION_ERROR_SCHEMA] = validationErrorSchema();
  }

  const components: OpenApiDocument["components"] = {};
  if (Object.keys(schemas).length) components.schemas = schemas;
  if (bearerAuth && anyAuth) {
    components.securitySchemes = {
      bearerAuth: { type: "http", scheme: "bearer" },
    };
  }
  if (Object.keys(components).length) doc.components = components;

  return doc;
}

function buildOperation(
  endpoint: EndpointDefZ,
  moduleName: string,
  endpointName: string,
  opts: {
    bearerAuth: boolean;
    includeValidationError: boolean;
    successStatus?: BuildOpenApiOptions["successStatus"];
  },
): OpenApiOperation {
  const structured = getObjectShape(endpoint.request);
  const isStructured = structured
    ? Object.keys(structured).every((k) =>
        ["path", "query", "body", "headers", "header"].includes(k),
      ) && Object.keys(structured).length > 0
    : false;

  const parameters: OpenApiParameter[] = [];
  let requestBody: OpenApiOperation["requestBody"];

  if (isStructured && structured) {
    if (structured.path) {
      parameters.push(...buildParameters(structured.path, "path"));
    }
    if (structured.query) {
      parameters.push(...buildParameters(structured.query, "query"));
    }
    const headerPart = structured.headers ?? structured.header;
    if (headerPart && getDefType(unwrapSchema(headerPart)) === "object") {
      parameters.push(...buildParameters(headerPart, "header"));
    }
    if (structured.body) {
      requestBody = buildRequestBody(structured.body, endpoint.bodyType);
    }
  } else if (endpoint.method !== "GET") {
    // flat contract: the whole request is sent as the body
    requestBody = buildRequestBody(endpoint.request, endpoint.bodyType);
  }

  const successCode = String(
    opts.successStatus?.({
      method: endpoint.method,
      path: endpoint.path,
      module: moduleName,
      name: endpointName,
    }) ?? (endpoint.method === "POST" ? 201 : 200),
  );

  const responses: Record<string, OpenApiResponse> = {
    [successCode]: {
      description: "Successful response",
      content: {
        "application/json": { schema: toOpenApiSchema(endpoint.response) },
      },
    },
  };

  if (opts.includeValidationError) {
    responses["400"] = {
      description: "Request validation failed",
      content: {
        "application/json": {
          schema: { $ref: `#/components/schemas/${VALIDATION_ERROR_SCHEMA}` },
        },
      },
    };
  }

  const operation: OpenApiOperation = {
    operationId: `${moduleName}_${endpointName}`,
    summary: `${moduleName}.${endpointName}`,
    tags: [moduleName],
    responses,
  };

  if (parameters.length) operation.parameters = parameters;
  if (requestBody) operation.requestBody = requestBody;

  if (endpoint.auth) {
    responses["401"] = { description: "Authentication required" };
    if (opts.bearerAuth) operation.security = [{ bearerAuth: [] }];
  }

  return operation;
}

function buildParameters(
  partSchema: z.ZodTypeAny,
  location: "path" | "query" | "header",
): OpenApiParameter[] {
  const { properties, required } = toParameterSchemas(unwrapSchema(partSchema));

  return Object.entries(properties).map(([name, schema]) => {
    const param: OpenApiParameter = {
      name,
      in: location,
      // path params are always required in OpenAPI
      required: location === "path" ? true : required.has(name),
      schema,
    };
    // arrays serialize as repeated keys (typefetch client uses URLSearchParams)
    if (location === "query" && schema.type === "array") {
      param.style = "form";
      param.explode = true;
    }
    return param;
  });
}

function buildRequestBody(
  bodySchema: z.ZodTypeAny,
  bodyType: EndpointDefZ["bodyType"],
): OpenApiOperation["requestBody"] {
  const unwrapped = unwrapSchema(bodySchema);
  const isOptional = unwrapped !== bodySchema; // an optional/default wrapper was peeled
  const mediaType =
    bodyType === "form-data" ? "multipart/form-data" : "application/json";

  return {
    required: !isOptional,
    content: {
      [mediaType]: { schema: toOpenApiSchema(unwrapped) },
    },
  };
}

/** `/users/:id/posts/:postId` → `/users/{id}/posts/{postId}` */
export function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function validationErrorSchema(): JsonSchema {
  return {
    type: "object",
    properties: {
      statusCode: { type: "integer", example: 400 },
      message: { type: "string", example: "Request validation failed" },
      code: { type: "string", example: "VALIDATION_ERROR" },
      errors: {
        type: "object",
        additionalProperties: { type: "array", items: { type: "string" } },
        description: "Field path → list of messages",
      },
    },
    required: ["statusCode", "message", "code", "errors"],
  };
}
