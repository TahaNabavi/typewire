import type { EndpointDefZ } from "@tahanabavi/typefetch";
import type { z } from "zod";
import { ContractValidationException, formatZodIssues } from "../exceptions";
import type { ParsedContractRequest } from "../types";
import { coerceInput } from "./coerce";
import {
  getDefType,
  getObjectShape,
  isFileArraySchema,
  isFileSchema,
  isRecord,
  isStructuredRequestSchema,
  unwrapSchema,
} from "./zod-utils";

/** Raw parts as the HTTP platform (Express/Fastify) hands them to Nest. */
export type RawRequestParts = {
  params: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
  headers: Record<string, unknown>;
  /**
   * Uploaded files keyed by contract field name, normalized from Multer's
   * `req.file` / `req.files`. A single-file field holds the file; a
   * repeated field holds an array. Only relevant for `bodyType: "form-data"`.
   */
  files?: Record<string, unknown>;
};

type ValidateOptions = { coerce: boolean };

/**
 * Validate an incoming request against a contract endpoint's `request`
 * schema. Issues from every part are collected before throwing, so a single
 * 400 reports path, query, body and header problems together.
 */
export function validateRequest(
  endpoint: EndpointDefZ,
  raw: RawRequestParts,
  options: ValidateOptions,
): ParsedContractRequest {
  const formData = endpoint.bodyType === "form-data";
  if (isStructuredRequestSchema(endpoint.request)) {
    return validateStructured(endpoint.request, raw, options, formData);
  }
  return validateFlat(endpoint.request, raw, options, formData);
}

function validateStructured(
  requestSchema: z.ZodTypeAny,
  raw: RawRequestParts,
  options: ValidateOptions,
  formData: boolean,
): ParsedContractRequest {
  const shape = getObjectShape(requestSchema) ?? {};
  const errors: Record<string, string[]> = {};
  const parsed: ParsedContractRequest = { isStructured: true, input: {} };
  const input: Record<string, unknown> = {};

  for (const [part, schema] of Object.entries(shape)) {
    switch (part) {
      case "path": {
        const value = options.coerce
          ? coerceInput(schema, raw.params, "query")
          : raw.params;
        const result = schema.safeParse(value);
        if (result.success) {
          parsed.path = result.data as Record<string, unknown>;
          input.path = result.data;
        } else {
          Object.assign(errors, formatZodIssues(result.error, "path"));
        }
        break;
      }

      case "query": {
        const value = options.coerce
          ? coerceInput(schema, raw.query, "query")
          : raw.query;
        const result = schema.safeParse(value);
        if (result.success) {
          parsed.query = result.data as Record<string, unknown>;
          input.query = result.data;
        } else {
          Object.assign(errors, formatZodIssues(result.error, "query"));
        }
        break;
      }

      case "body": {
        if (formData) {
          const { data, errors: bodyErrors } = validateFormDataBody(
            schema,
            raw.body,
            raw.files ?? {},
            options,
          );
          if (Object.keys(bodyErrors).length > 0) {
            Object.assign(errors, bodyErrors);
          } else if (data !== undefined) {
            parsed.body = data;
            input.body = data;
          }
          break;
        }

        const value = options.coerce
          ? coerceInput(schema, raw.body, "json")
          : raw.body;
        const result = parseWithEmptyBodyFallback(schema, value);
        if (result.success) {
          if (result.data !== undefined) {
            parsed.body = result.data;
            input.body = result.data;
          }
        } else {
          Object.assign(errors, formatZodIssues(result.error, "body"));
        }
        break;
      }

      case "headers":
      case "header": {
        const { value, validated } = pickHeaders(schema, raw.headers);
        if (!validated) {
          parsed.headers = value as Record<string, string>;
          break;
        }
        const result = schema.safeParse(value);
        if (result.success) {
          parsed.headers = (result.data ?? {}) as Record<string, string>;
          input[part] = result.data;
        } else {
          Object.assign(errors, formatZodIssues(result.error, part));
        }
        break;
      }
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ContractValidationException(errors);
  }

  parsed.input = input;
  return parsed;
}

function validateFlat(
  requestSchema: z.ZodTypeAny,
  raw: RawRequestParts,
  options: ValidateOptions,
  formData: boolean,
): ParsedContractRequest {
  if (formData) {
    const { data, errors } = validateFormDataBody(
      requestSchema,
      raw.body,
      raw.files ?? {},
      options,
    );
    if (Object.keys(errors).length > 0) {
      throw new ContractValidationException(errors);
    }
    return { isStructured: false, body: data, input: data };
  }

  // Flat inputs are sent by the client as the JSON body.
  const value = options.coerce
    ? coerceInput(requestSchema, raw.body, "json")
    : raw.body;

  const result = parseWithEmptyBodyFallback(requestSchema, value);
  if (!result.success) {
    throw new ContractValidationException(formatZodIssues(result.error, "body"));
  }

  return {
    isStructured: false,
    body: result.data,
    input: result.data,
  };
}

/**
 * Validate a `bodyType: "form-data"` body. Multipart splits a request into
 * text fields (strings, in `req.body`) and file parts (Multer file objects,
 * merged into `files` by field name). Each contract field is validated
 * according to its kind:
 *
 * - **File fields** (`z.instanceof(File)` / `z.file()` / arrays of them) —
 *   the browser `File` check can't hold server-side, so the uploaded file is
 *   passed through after a presence check honoring the schema's optionality.
 * - **Text fields** — behave like query params (everything arrives as a
 *   string), so they're coerced toward the declared type and validated.
 *
 * Fields not declared by the contract are dropped. Issues from every field
 * are collected rather than thrown one at a time.
 */
function validateFormDataBody(
  bodySchema: z.ZodTypeAny,
  rawBody: unknown,
  files: Record<string, unknown>,
  options: ValidateOptions,
): { data?: unknown; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};
  const fields = isRecord(rawBody) ? rawBody : {};
  const shape = getObjectShape(bodySchema);

  // Non-object body (rare): merge fields + files and validate as a whole.
  if (!shape) {
    const merged = { ...fields, ...files };
    const value = options.coerce
      ? coerceInput(bodySchema, merged, "query")
      : merged;
    const result = bodySchema.safeParse(value);
    if (result.success) return { data: result.data, errors };
    Object.assign(errors, formatZodIssues(result.error, "body"));
    return { errors };
  }

  const out: Record<string, unknown> = {};

  for (const [key, fieldSchema] of Object.entries(shape)) {
    const optional = fieldSchema.safeParse(undefined).success;

    if (isFileArraySchema(fieldSchema) || isFileSchema(fieldSchema)) {
      const provided = files[key];
      if (provided === undefined) {
        if (!optional) errors[`body.${key}`] = ["Expected an uploaded file"];
        continue;
      }
      out[key] = isFileArraySchema(fieldSchema)
        ? Array.isArray(provided)
          ? provided
          : [provided]
        : Array.isArray(provided)
          ? provided[0]
          : provided;
      continue;
    }

    // text field — string on the wire, same shape as a query param
    const rawValue = fields[key];
    const value = options.coerce
      ? coerceInput(fieldSchema, rawValue, "query")
      : rawValue;
    const result = fieldSchema.safeParse(value);
    if (result.success) {
      if (result.data !== undefined) out[key] = result.data;
    } else {
      Object.assign(errors, formatZodIssues(result.error, `body.${key}`));
    }
  }

  return { data: out, errors };
}

function isEmptyBody(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return isRecord(value) && Object.keys(value).length === 0;
}

/**
 * "No body" reaches Nest as `undefined` (Express 5) or `{}` (Express 4 /
 * client sending an empty flat input). A contract may model it as either
 * `z.undefined()` or `z.object({})` — accept whichever the schema allows.
 */
function parseWithEmptyBodyFallback(
  schema: z.ZodTypeAny,
  value: unknown,
): z.ZodSafeParseResult<unknown> {
  const result = schema.safeParse(value);
  if (result.success || !isEmptyBody(value)) return result;

  for (const candidate of [undefined, {}]) {
    const fallback = schema.safeParse(candidate);
    if (fallback.success) return fallback;
  }
  return result;
}

/**
 * Incoming requests carry far more headers than a contract declares
 * (host, user-agent, ...). When the contract pins explicit header keys
 * (a ZodObject), validate only those — matched case-insensitively, since
 * Node lowercases incoming header names. For open schemas (the
 * `z.record(...)` default from `makeRequestSchema`) the normalized header
 * map is passed through without validation.
 */
function pickHeaders(
  schema: z.ZodTypeAny,
  rawHeaders: Record<string, unknown>,
): { value: Record<string, string>; validated: boolean } {
  const normalized: Record<string, string> = {};
  for (const [key, val] of Object.entries(rawHeaders)) {
    if (val === undefined || val === null) continue;
    normalized[key.toLowerCase()] = Array.isArray(val)
      ? val.map(String).join(", ")
      : String(val);
  }

  const shape = getObjectShape(schema);
  if (!shape) {
    const type = getDefType(unwrapSchema(schema));
    // Only records of strings are meaningfully checkable; anything else
    // (or the permissive default) passes through unvalidated.
    return { value: normalized, validated: type === "record" };
  }

  const picked: Record<string, string> = {};
  for (const key of Object.keys(shape)) {
    const match = normalized[key.toLowerCase()];
    if (match !== undefined) picked[key] = match;
  }
  return { value: picked, validated: true };
}
