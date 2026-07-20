import type { z } from "zod";
import { getDef, getDefType, isRecord } from "./zod-utils";

/**
 * How the value travelled over the wire:
 *
 * - `"query"` — URL path/query params. Everything is a string, serialized by
 *   the typefetch client via `URLSearchParams`: primitives with `String()`,
 *   `Date` as ISO string, nested objects as `JSON.stringify`, arrays as
 *   repeated keys.
 * - `"json"` — JSON body. Types survive except what JSON cannot represent:
 *   `Date` (ISO string) and `bigint`.
 */
export type CoercionMode = "query" | "json";

/**
 * Best-effort coercion of a wire value toward the type its contract schema
 * declares, so contracts written for the typefetch client (`z.number()` in
 * `query`, `z.date()` in `body`, ...) validate unchanged on the server.
 *
 * Never throws and never invents data: when a value cannot be coerced it is
 * returned as-is and Zod reports the real validation error.
 */
export function coerceInput(
  schema: z.ZodTypeAny,
  value: unknown,
  mode: CoercionMode,
): unknown {
  try {
    return coerce(schema, value, mode);
  } catch {
    return value;
  }
}

function coerce(
  schema: z.ZodTypeAny,
  value: unknown,
  mode: CoercionMode,
): unknown {
  if (value === undefined || value === null) return value;

  const type = getDefType(schema);
  const def = getDef(schema);
  if (!type || !def) return value;

  switch (type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "catch":
    case "nonoptional":
      return coerce(def.innerType, value, mode);

    case "pipe":
    case "pipeline":
      return coerce(def.in, value, mode);

    case "effects": // zod v3 .transform()/.refine()
      return coerce(def.schema, value, mode);

    case "lazy":
      return coerce(def.getter(), value, mode);

    case "union": {
      for (const option of def.options ?? []) {
        const coerced = coerce(option, value, mode);
        if ((option as z.ZodTypeAny).safeParse(coerced).success) {
          return coerced;
        }
      }
      return value;
    }

    case "array": {
      // v4: def.element — v3: def.type
      const element = def.element ?? def.type;
      // A single query occurrence of a repeated key arrives as a lone value.
      const items = Array.isArray(value) ? value : [value];
      return items.map((item) => coerce(element, item, mode));
    }

    case "tuple": {
      const items: z.ZodTypeAny[] = def.items ?? [];
      const arr = Array.isArray(value) ? value : [value];
      return arr.map((item, i) =>
        items[i] ? coerce(items[i], item, mode) : item,
      );
    }

    case "object": {
      // Nested objects in a query string were JSON.stringify-ed by the
      // client; once parsed, their fields are JSON-typed.
      let childMode: CoercionMode = mode;
      let obj = value;
      if (mode === "query" && typeof value === "string") {
        obj = JSON.parse(value);
        childMode = "json";
      }
      if (!isRecord(obj)) return value;

      const rawShape = (schema as any).shape ?? def.shape;
      const shape: Record<string, z.ZodTypeAny> =
        typeof rawShape === "function" ? rawShape() : rawShape;
      const out: Record<string, unknown> = { ...obj };
      for (const [key, child] of Object.entries(shape ?? {})) {
        if (key in out) out[key] = coerce(child, out[key], childMode);
      }
      return out;
    }

    case "record": {
      let childMode: CoercionMode = mode;
      let obj = value;
      if (mode === "query" && typeof value === "string") {
        obj = JSON.parse(value);
        childMode = "json";
      }
      if (!isRecord(obj)) return value;

      const valueType = def.valueType;
      if (!valueType) return obj;
      const out: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(obj)) {
        out[key] = coerce(valueType, item, childMode);
      }
      return out;
    }

    case "number": {
      if (mode === "query" && typeof value === "string" && value.trim() !== "") {
        const n = Number(value);
        if (!Number.isNaN(n)) return n;
      }
      return value;
    }

    case "boolean": {
      if (mode === "query" && typeof value === "string") {
        if (value === "true") return true;
        if (value === "false") return false;
      }
      return value;
    }

    case "bigint": {
      // JSON.stringify(bigint) throws, so bigints only ever arrive via query.
      if (mode === "query" && typeof value === "string" && value.trim() !== "") {
        try {
          return BigInt(value);
        } catch {
          return value;
        }
      }
      return value;
    }

    case "date": {
      // Dates are ISO strings on the wire in both query and JSON bodies.
      if (typeof value === "string") {
        const date = new Date(value);
        if (!Number.isNaN(date.getTime())) return date;
      }
      return value;
    }

    case "literal": {
      // v4: def.values (array) — v3: def.value
      const literals: unknown[] = def.values ?? [def.value];
      if (mode === "query" && typeof value === "string") {
        for (const lit of literals) {
          if (typeof lit === "number") {
            const n = Number(value);
            if (!Number.isNaN(n) && n === lit) return n;
          } else if (typeof lit === "boolean") {
            if (value === "true" && lit === true) return true;
            if (value === "false" && lit === false) return false;
          } else if (typeof lit === "bigint") {
            try {
              if (BigInt(value) === lit) return lit;
            } catch {
              /* not a bigint string */
            }
          }
        }
      }
      return value;
    }

    default:
      // string, enum, stringbool, any, unknown, ... — nothing to coerce.
      return value;
  }
}
