import { z } from "zod";
import type { JsonSchema } from "./types";

/**
 * Convert a Zod schema to an OpenAPI 3.0 schema object via Zod 4's native
 * `z.toJSONSchema`, with the accommodations contracts need:
 *
 * - `target: "openapi-3.0"` emits 3.0-compatible schemas (and drops the
 *   `$schema` key so the result embeds cleanly in an OpenAPI document).
 * - `unrepresentable: "any"` prevents a throw on `z.date()` / `z.bigint()` /
 *   `z.instanceof(...)`, which have no direct JSON Schema form.
 * - An `override` then gives those a sensible representation:
 *   `date` → `string`/`date-time`, `bigint` → `string`, custom (e.g.
 *   `z.instanceof(File)`) → `string`/`binary` for file-upload fields.
 */
export function toOpenApiSchema(schema: z.ZodTypeAny): JsonSchema {
  const json = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    unrepresentable: "any",
    override: (ctx: any) => {
      const type = ctx.zodSchema?._zod?.def?.type;
      const out = ctx.jsonSchema;
      if (type === "date") {
        out.type = "string";
        out.format = "date-time";
      } else if (type === "bigint") {
        out.type = "string";
        out.format = "int64";
      } else if (type === "custom" || type === "file") {
        // z.instanceof(File)/z.file() — treated as an upload payload.
        out.type = "string";
        out.format = "binary";
      }
    },
  }) as JsonSchema;

  // openapi-3.0 target already omits `$schema`; strip defensively in case a
  // future Zod build leaves it on nested output.
  delete (json as any).$schema;
  return json;
}

/**
 * Convert a Zod object schema into `{ properties, required }`, where
 * `required` is the set of non-optional keys. Used to derive individual
 * `path`/`query`/`header` parameters from a request-part object.
 */
export function toParameterSchemas(schema: z.ZodTypeAny): {
  properties: Record<string, JsonSchema>;
  required: Set<string>;
} {
  const json = toOpenApiSchema(schema);
  return {
    properties: (json.properties as Record<string, JsonSchema>) ?? {},
    required: new Set<string>(Array.isArray(json.required) ? json.required : []),
  };
}
