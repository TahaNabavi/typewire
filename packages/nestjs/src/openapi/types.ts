/**
 * Minimal structural OpenAPI 3.0 typings — enough to build and type the
 * document without depending on `@nestjs/swagger` (an optional peer). The
 * produced object is structurally assignable to `OpenAPIObject`, so it can
 * be handed straight to `SwaggerModule.setup()`.
 */

export type JsonSchema = Record<string, any>;

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema: JsonSchema;
  style?: string;
  explode?: boolean;
}

export interface OpenApiMediaType {
  schema: JsonSchema;
}

export interface OpenApiRequestBody {
  required?: boolean;
  content: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description: string;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
}

export type OpenApiPathItem = Partial<
  Record<
    "get" | "put" | "post" | "delete" | "patch",
    OpenApiOperation
  >
>;

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  servers?: Array<{ url: string; description?: string }>;
  tags?: Array<{ name: string; description?: string }>;
  paths: Record<string, OpenApiPathItem>;
  components?: {
    schemas?: Record<string, JsonSchema>;
    securitySchemes?: Record<string, JsonSchema>;
  };
}

export interface OpenApiInfo {
  title?: string;
  version?: string;
  description?: string;
}

export interface BuildOpenApiOptions {
  /** Document `info` block. Defaults to `{ title: "API", version: "1.0.0" }`. */
  info?: OpenApiInfo;
  /** Optional `servers` list (e.g. `[{ url: "https://api.example.com" }]`). */
  servers?: Array<{ url: string; description?: string }>;
  /**
   * Declare a `bearerAuth` HTTP security scheme and attach it to every
   * endpoint whose contract sets `auth: true`. Default `true`.
   */
  bearerAuth?: boolean;
  /**
   * Document a `400` validation-error response (matching
   * `ContractValidationException`) on every endpoint. Default `true`.
   */
  includeValidationError?: boolean;
  /**
   * Override the success status code documented for an endpoint. Defaults
   * to `201` for `POST`, `200` for everything else.
   */
  successStatus?: (endpoint: {
    method: string;
    path: string;
    module: string;
    name: string;
  }) => number;
}
