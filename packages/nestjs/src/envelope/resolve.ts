import type { EnvelopeError, ResponseEnvelopeOptions } from "../types";

export interface ResolvedEnvelope {
  success: (data: unknown) => unknown;
  error: (error: EnvelopeError) => unknown;
  errorStatus: "preserve" | 200;
}

const defaultSuccess = (data: unknown) => ({ success: true, data });

const defaultError = (e: EnvelopeError) => ({
  success: false,
  message: e.message,
  ...(e.code !== undefined ? { code: e.code } : {}),
  ...(e.errors !== undefined ? { errors: e.errors } : {}),
});

/**
 * Turn the `envelope` setting into concrete builders.
 * - `false` → `null` (envelope disabled; caller passes responses through).
 * - `true` / `undefined` → the default `{ success, data }` builders.
 * - object → defaults with the provided overrides.
 */
export function resolveEnvelope(
  setting: boolean | ResponseEnvelopeOptions | undefined,
): ResolvedEnvelope | null {
  if (setting === false) return null;
  const opts: ResponseEnvelopeOptions =
    setting && typeof setting === "object" ? setting : {};
  return {
    success: opts.success ?? defaultSuccess,
    error: opts.error ?? defaultError,
    errorStatus: opts.errorStatus ?? "preserve",
  };
}
