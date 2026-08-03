import { z } from "zod";
import type { TypeFetchFile } from "./types";

/**
 * Schema helpers for non-JSON response types
 * ==========================================
 * A contract using `responseType: "blob"` still needs a `response` schema, and
 * the obvious spelling — `z.instanceof(Blob)` — is a trap: it dereferences the
 * global at *module evaluation* time, so merely importing such a contract
 * throws a `ReferenceError` anywhere `Blob` is absent. That includes older Node
 * runtimes and any server-side render that loads the shared contract file.
 * Since contracts in this project are imported by both halves of the app, that
 * failure mode is the default rather than the edge case.
 *
 * Each helper below defers the global lookup into the validator, so the schema
 * is always constructible and only *validation* depends on the environment.
 *
 * These are conveniences, not requirements — any Zod schema works. Use them so
 * a mismatched `responseType` fails as a readable validation error rather than
 * as `undefined` three layers downstream.
 */

/** True when `name` is a constructor on `globalThis` and `value` is one. */
function isGlobalInstance(value: unknown, name: string): boolean {
  const ctor = (globalThis as Record<string, any>)[name];
  return typeof ctor === "function" && value instanceof ctor;
}

/**
 * Matches a `Blob` (and therefore also a `File`, which extends it).
 * Pair with `responseType: "blob"`.
 */
export function zBlob() {
  return z.custom<Blob>((value) => isGlobalInstance(value, "Blob"), {
    message: "Expected a Blob",
  });
}

/**
 * Matches an `ArrayBuffer`. Pair with `responseType: "arrayBuffer"`.
 */
export function zArrayBuffer() {
  return z.custom<ArrayBuffer>(
    (value) => isGlobalInstance(value, "ArrayBuffer"),
    { message: "Expected an ArrayBuffer" },
  );
}

/**
 * Matches a `FormData`. Pair with `responseType: "formData"`.
 */
export function zFormData() {
  return z.custom<FormData>((value) => isGlobalInstance(value, "FormData"), {
    message: "Expected a FormData",
  });
}

/**
 * Matches the raw `res.body`. Pair with `responseType: "stream"`.
 *
 * `null` is accepted because that is what the Fetch spec hands back for a
 * bodyless response (204, or a HEAD); rejecting it would turn an ordinary empty
 * response into a validation error.
 */
export function zStream() {
  return z.custom<ReadableStream<Uint8Array> | null>(
    (value) => value === null || isGlobalInstance(value, "ReadableStream"),
    { message: "Expected a ReadableStream or null" },
  );
}

/**
 * Matches a whole `Response`. Pair with `responseType: "response"`.
 */
export function zResponse() {
  return z.custom<Response>((value) => isGlobalInstance(value, "Response"), {
    message: "Expected a Response",
  });
}

/**
 * Matches the {@link TypeFetchFile} that `responseType: "file"` produces.
 *
 * Only `blob` and `size` are guaranteed — `filename` and `contentType` come
 * from response headers that may be absent, or hidden by CORS when the server
 * does not list them in `Access-Control-Expose-Headers`.
 */
export function zFile() {
  return z.object({
    blob: zBlob(),
    filename: z.string().optional(),
    contentType: z.string().optional(),
    size: z.number(),
  }) as unknown as z.ZodType<TypeFetchFile>;
}
