import {
  BadRequestException,
  InternalServerErrorException,
} from "@nestjs/common";
import type { z } from "zod";

/**
 * Flatten a ZodError into `{ "part.field.path": ["message", ...] }`.
 *
 * The shape intentionally matches the `errors` field the typefetch client's
 * `RichError` picks up from error response bodies, so backend validation
 * failures surface on the frontend as first-class `RichError.errors`.
 */
export function formatZodIssues(
  error: z.ZodError,
  prefix?: string,
): Record<string, string[]> {
  const errors: Record<string, string[]> = {};

  for (const issue of error.issues) {
    const segments = [
      ...(prefix ? [prefix] : []),
      ...issue.path.map((p) => String(p)),
    ];
    const key = segments.length > 0 ? segments.join(".") : "_root";
    (errors[key] ??= []).push(issue.message);
  }

  return errors;
}

/**
 * 400 thrown when the incoming request does not satisfy the contract's
 * `request` schema. Body shape:
 *
 * ```json
 * {
 *   "statusCode": 400,
 *   "message": "Request validation failed",
 *   "code": "VALIDATION_ERROR",
 *   "errors": { "body.name": ["Too small: expected string to have >=2 characters"] }
 * }
 * ```
 */
export class ContractValidationException extends BadRequestException {
  constructor(public readonly errors: Record<string, string[]>) {
    super({
      statusCode: 400,
      message: "Request validation failed",
      code: "VALIDATION_ERROR",
      errors,
    });
  }
}

/**
 * 500 thrown when the handler's return value violates the contract's
 * `response` schema — the backend drifted from the contract. Issues are
 * only included in the body when `exposeResponseErrors` is enabled;
 * they are always available on the exception instance for logging.
 */
export class ContractResponseViolationException extends InternalServerErrorException {
  constructor(
    public readonly errors: Record<string, string[]>,
    expose = false,
  ) {
    super({
      statusCode: 500,
      message: "Response contract violation",
      code: "RESPONSE_CONTRACT_VIOLATION",
      ...(expose ? { errors } : {}),
    });
  }
}
