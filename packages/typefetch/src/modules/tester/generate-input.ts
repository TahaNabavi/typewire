import { z } from "zod";
import type { AutoInputOptions, SchemaLike } from "./types";

const DEFAULT_MAX_DEPTH = 5;

export function generateInput(
  schema: z.ZodTypeAny,
  options: AutoInputOptions = {},
): unknown {
  return generateValue(schema as SchemaLike, options, [], 0);
}

function generateValue(
  schema: SchemaLike,
  options: AutoInputOptions,
  path: string[],
  depth: number,
): unknown {
  const override = resolveOverride(options, path);
  if (override.exists) return override.value;

  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  if (depth > maxDepth) return null;

  const kind = getKind(schema);
  const def = getDef(schema);

  switch (kind) {
    case "optional":
      if (options.includeOptional === false) return undefined;
      return generateValue(getInnerType(schema, def), options, path, depth + 1);

    case "nullable":
      return generateValue(getInnerType(schema, def), options, path, depth + 1);

    case "default":
      return (
        getDefaultValue(def) ??
        generateValue(getInnerType(schema, def), options, path, depth + 1)
      );

    case "catch":
    case "readonly":
    case "branded":
    case "promise":
      return generateValue(getInnerType(schema, def), options, path, depth + 1);

    case "effects":
    case "pipeline":
    case "pipe":
      return generateValue(
        (def.schema ?? def.in ?? def.out) as SchemaLike,
        options,
        path,
        depth + 1,
      );

    case "object":
      return generateObject(schema, options, path, depth);

    case "array": {
      if (options.includeArrayItems === false) return [];
      const itemSchema = (def.type ?? def.element ?? def.innerType) as
        | SchemaLike
        | undefined;
      return itemSchema
        ? [generateValue(itemSchema, options, path.concat("0"), depth + 1)]
        : [];
    }

    case "tuple": {
      const items = (def.items ?? []) as SchemaLike[];
      return items.map((item, index) =>
        generateValue(item, options, path.concat(String(index)), depth + 1),
      );
    }

    case "record": {
      const valueType = (def.valueType ?? def.valueSchema ?? def.value) as
        | SchemaLike
        | undefined;
      return {
        key: valueType
          ? generateValue(valueType, options, path.concat("key"), depth + 1)
          : "value",
      };
    }

    case "union": {
      const optionsList = (def.options ?? []) as SchemaLike[];
      return optionsList.length
        ? generateValue(optionsList[0], options, path, depth + 1)
        : null;
    }

    case "discriminatedunion":
    case "discriminated_union": {
      const optionsMap = def.optionsMap as Map<string, SchemaLike> | undefined;
      const first =
        optionsMap?.values().next().value ??
        (def.options?.[0] as SchemaLike | undefined);
      return first ? generateValue(first, options, path, depth + 1) : null;
    }

    case "intersection": {
      const left = generateValue(def.left, options, path, depth + 1);
      const right = generateValue(def.right, options, path, depth + 1);
      if (isObject(left) && isObject(right)) return { ...left, ...right };
      return right ?? left;
    }

    case "literal": {
      const values = def.values ?? ("value" in def ? [def.value] : undefined);
      return Array.isArray(values)
        ? values[0]
        : values?.values?.().next?.().value;
    }

    case "enum":
    case "nativeenum":
    case "native_enum": {
      const values = getEnumValues(schema, def);
      return values[0] ?? "value";
    }

    case "string":
      return generateString(path, def, options);

    case "number":
      return generateNumber(def);

    case "bigint":
      return BigInt(1);

    case "boolean":
      return true;

    case "date":
      return new Date("2026-01-01T00:00:00.000Z");

    case "null":
      return null;

    case "undefined":
    case "void":
      return undefined;

    case "nan":
      return Number.NaN;

    case "any":
    case "unknown":
      return guessByPath(path, options);

    case "never":
      throw new Error(
        `Cannot generate input for never schema at ${path.join(".") || "root"}`,
      );

    default:
      return guessByPath(path, options);
  }
}

function generateObject(
  schema: SchemaLike,
  options: AutoInputOptions,
  path: string[],
  depth: number,
): Record<string, unknown> {
  const shape = getShape(schema);
  const output: Record<string, unknown> = {};

  for (const [key, childSchema] of Object.entries(shape)) {
    const value = generateValue(
      childSchema as SchemaLike,
      options,
      path.concat(key),
      depth + 1,
    );
    if (value !== undefined || options.includeOptional !== false)
      output[key] = value;
  }

  return output;
}

function generateString(
  path: string[],
  def: any,
  options: AutoInputOptions,
): string | unknown {
  const key = path[path.length - 1]?.toLowerCase() ?? "";
  const fullPath = path.join(".").toLowerCase();
  const minLength = getStringMinLength(def);
  const ensureMinLength = (value: string) =>
    minLength && value.length < minLength
      ? value.padEnd(minLength, "x")
      : value;

  if (isFileField(key, fullPath))
    return options.fileFactory?.() ?? defaultFileValue();

  if (key.includes("email")) {
    const base = "test@example.com";
    if (!minLength || base.length >= minLength) return base;

    return `test${"x".repeat(minLength - base.length)}@example.com`;
  }

  if (key.includes("url") || key.includes("website")) {
    const base = "https://example.com";
    if (!minLength || base.length >= minLength) return base;

    return `${base}/${"x".repeat(minLength - base.length)}`;
  }

  if (key === "uuid" || key.endsWith("uuid")) {
    return "550e8400-e29b-41d4-a716-446655440000";
  }

  if (key === "id" || key.endsWith("id") || fullPath.endsWith(".path.id")) {
    return ensureMinLength("1");
  }

  if (key.includes("phone")) return ensureMinLength("+10000000000");
  if (key.includes("name")) return ensureMinLength("Test Name");
  if (key.includes("password")) return ensureMinLength("StrongPass123!");
  if (key.includes("token")) return ensureMinLength("test-token");

  return ensureMinLength("test-string");
}

function generateNumber(def: any): number {
  const min = getNumberMin(def);
  if (typeof min === "number") return min;
  return 1;
}

function guessByPath(path: string[], options: AutoInputOptions): unknown {
  const key = path[path.length - 1]?.toLowerCase() ?? "";
  const fullPath = path.join(".").toLowerCase();

  if (isFileField(key, fullPath))
    return options.fileFactory?.() ?? defaultFileValue();
  if (key.includes("count") || key.includes("page") || key.includes("limit"))
    return 1;
  if (key.startsWith("is") || key.startsWith("has") || key.includes("active"))
    return true;
  return "test-value";
}

function resolveOverride(options: AutoInputOptions, path: string[]) {
  const values = options.values ?? {};
  const candidates = [
    path.join("."),
    path.slice(-2).join("."),
    path[path.length - 1] ?? "",
  ];

  for (const key of candidates) {
    if (key && Object.prototype.hasOwnProperty.call(values, key)) {
      const raw = values[key];
      return {
        exists: true,
        value: typeof raw === "function" ? raw(path.join(".")) : raw,
      };
    }
  }

  return { exists: false, value: undefined };
}

function getDef(schema: SchemaLike): any {
  return schema._def ?? schema.def ?? {};
}

function getKind(schema: SchemaLike): string {
  const def = getDef(schema);
  const raw = def.typeName ?? def.type ?? schema.constructor?.name ?? "unknown";
  return String(raw).replace(/^Zod/, "").replace(/-/g, "_").toLowerCase();
}

function getInnerType(schema: SchemaLike, def = getDef(schema)): SchemaLike {
  return (schema.unwrap?.() ??
    def.innerType ??
    def.schema ??
    def.type) as SchemaLike;
}

function getShape(schema: SchemaLike): Record<string, z.ZodTypeAny> {
  const def = getDef(schema);
  const shape = schema.shape ?? def.shape;
  return typeof shape === "function" ? shape() : (shape ?? {});
}

function getDefaultValue(def: any): unknown {
  const value = def.defaultValue;
  return typeof value === "function" ? value() : value;
}

function getEnumValues(schema: SchemaLike, def: any): unknown[] {
  if (Array.isArray((schema as any).options)) return (schema as any).options;
  if (Array.isArray(def.values)) return def.values;
  if (def.entries && typeof def.entries === "object")
    return Object.values(def.entries);
  if (def.values && typeof def.values === "object")
    return Object.values(def.values);
  return [];
}

function getStringMinLength(def: any): number | undefined {
  for (const check of def.checks ?? []) {
    const c = check?._zod?.def ?? check;
    if (
      (c.kind === "min" || c.check === "min_length" || c.type === "min") &&
      typeof c.value === "number"
    )
      return c.value;
    if (typeof c.minimum === "number") return c.minimum;
  }
  return undefined;
}

function getNumberMin(def: any): number | undefined {
  for (const check of def.checks ?? []) {
    const c = check?._zod?.def ?? check;
    if (
      (c.kind === "min" || c.check === "greater_than" || c.type === "min") &&
      typeof c.value === "number"
    )
      return c.value;
    if (typeof c.minimum === "number") return c.minimum;
  }
  return undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFileField(key: string, fullPath: string): boolean {
  return (
    key === "file" ||
    key.endsWith("file") ||
    key.includes("avatar") ||
    fullPath.includes("formdata")
  );
}

function defaultFileValue(): unknown {
  if (typeof Blob !== "undefined") {
    return new Blob(["typefetch-test-file"], { type: "text/plain" });
  }
  return "typefetch-test-file";
}
