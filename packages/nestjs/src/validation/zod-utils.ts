import type { z } from "zod";

/**
 * Internal-def access that works for Zod v4 (`schema._zod.def`, the primary
 * target — typefetch pins `zod@^4`) with a best-effort fallback to the v3
 * layout (`schema._def`).
 */
export type AnyZodDef = {
  type?: string;
  typeName?: string;
  [key: string]: any;
};

export function getDef(schema: unknown): AnyZodDef | undefined {
  const s = schema as any;
  return s?._zod?.def ?? s?._def;
}

/**
 * Normalized type tag of a schema: Zod v4 already uses lowercase tags
 * ("number", "optional", ...); v3 `typeName`s like "ZodNumber" are mapped
 * to the same convention ("number").
 */
export function getDefType(schema: unknown): string | undefined {
  const def = getDef(schema);
  if (!def) return undefined;
  if (typeof def.type === "string") return def.type;
  if (typeof def.typeName === "string") {
    const bare = def.typeName.replace(/^Zod/, "");
    return bare.charAt(0).toLowerCase() + bare.slice(1);
  }
  return undefined;
}

const WRAPPER_TYPES = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "readonly",
  "catch",
  "nonoptional",
]);

/** Unwrap one wrapper level; returns undefined when `schema` is not a wrapper. */
export function unwrapOnce(schema: z.ZodTypeAny): z.ZodTypeAny | undefined {
  const type = getDefType(schema);
  const def = getDef(schema);
  if (!type || !def) return undefined;

  if (WRAPPER_TYPES.has(type)) return def.innerType;
  // v4 pipes validate the input side first; v3 calls these "pipeline"
  if (type === "pipe" || type === "pipeline") return def.in;
  // v3 .transform()/.refine() wrapper
  if (type === "effects") return def.schema;
  if (type === "lazy") return def.getter?.();

  return undefined;
}

/** Fully unwrap optional/nullable/default/pipe/lazy/... down to the core schema. */
export function unwrapSchema(schema: z.ZodTypeAny): z.ZodTypeAny {
  let current = schema;
  for (let i = 0; i < 20; i++) {
    const inner = unwrapOnce(current);
    if (!inner) return current;
    current = inner;
  }
  return current;
}

/**
 * Shape of an object schema (after unwrapping), or undefined when the
 * schema is not an object. `.shape` is a public getter on ZodObject in
 * both v3 and v4.
 */
export function getObjectShape(
  schema: z.ZodTypeAny,
): Record<string, z.ZodTypeAny> | undefined {
  const unwrapped = unwrapSchema(schema);
  if (getDefType(unwrapped) !== "object") return undefined;
  const shape = (unwrapped as any).shape;
  return typeof shape === "function" ? shape() : shape;
}

/**
 * Mirrors the client's `REQUEST_PART_KEYS`: a request schema whose object
 * keys are a non-empty subset of these is "structured" — its parts map onto
 * path params / query string / body / headers. Anything else is a "flat"
 * schema, which the client sends as the JSON body.
 */
const REQUEST_PART_KEYS = new Set([
  "path",
  "query",
  "body",
  "headers",
  "header",
]);

export function isStructuredRequestSchema(schema: z.ZodTypeAny): boolean {
  const shape = getObjectShape(schema);
  if (!shape) return false;

  const keys = Object.keys(shape);
  if (keys.length === 0) return false;

  return keys.every((key) => REQUEST_PART_KEYS.has(key));
}

export function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A schema that models an uploaded file. In a contract shared with the
 * frontend this is `z.instanceof(File)` (→ `custom`) or `z.file()` (→
 * `file`). We can't re-run a browser `instanceof File` check on the server,
 * so these fields are detected and their value (a Multer file) is passed
 * through instead of validated against the browser type.
 */
export function isFileSchema(schema: z.ZodTypeAny): boolean {
  const type = getDefType(unwrapSchema(schema));
  return type === "custom" || type === "file";
}

/** A schema that models one-or-many uploaded files (`z.array(z.instanceof(File))`). */
export function isFileArraySchema(schema: z.ZodTypeAny): boolean {
  const unwrapped = unwrapSchema(schema);
  if (getDefType(unwrapped) !== "array") return false;
  const def = getDef(unwrapped);
  const element = def?.element ?? def?.type;
  return element ? isFileSchema(element) : false;
}
