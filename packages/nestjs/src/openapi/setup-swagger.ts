import type { INestApplication } from "@nestjs/common";
import type { Contracts } from "@tahanabavi/typefetch";
import { buildOpenApiDocument } from "./build-openapi";
import type { BuildOpenApiOptions, OpenApiDocument } from "./types";

export interface SetupContractSwaggerOptions extends BuildOpenApiOptions {
  /** Route the Swagger UI + JSON are served at. Default `"api"`. */
  path?: string;
}

/**
 * Build the contract OpenAPI document and mount Swagger UI for it.
 *
 * `@nestjs/swagger` is an *optional* peer — it is required lazily here, so
 * apps that don't use Swagger never need it installed. The raw document is
 * returned (also served at `<path>-json`) for reuse (client codegen, tests).
 *
 * @example
 * const app = await NestFactory.create(AppModule);
 * setupContractSwagger(app, contracts, {
 *   path: "docs",
 *   info: { title: "My API", version: "1.0.0" },
 * });
 * await app.listen(3000); // UI at /docs, JSON at /docs-json
 */
export function setupContractSwagger(
  app: INestApplication,
  contracts: Contracts,
  options: SetupContractSwaggerOptions = {},
): OpenApiDocument {
  const { path = "api", ...buildOptions } = options;
  const document = buildOpenApiDocument(contracts, buildOptions);

  let SwaggerModule: { setup: (...args: any[]) => void };
  try {
    ({ SwaggerModule } = require("@nestjs/swagger"));
  } catch {
    throw new Error(
      "[typefetch-nestjs] setupContractSwagger() requires the optional peer " +
        "dependency '@nestjs/swagger'. Install it with `npm i @nestjs/swagger`, " +
        "or call buildOpenApiDocument() and serve the document yourself.",
    );
  }

  // A prebuilt document is passed directly; Nest serves UI at `path` and the
  // raw JSON at `${path}-json` without scanning controllers.
  SwaggerModule.setup(path, app, document as any);
  return document;
}
