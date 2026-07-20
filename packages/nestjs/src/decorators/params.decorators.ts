import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { PARSED_REQUEST_KEY } from "../constants";
import type { ParsedContractRequest } from "../types";

function getParsed(ctx: ExecutionContext): ParsedContractRequest | undefined {
  return ctx.switchToHttp().getRequest()[PARSED_REQUEST_KEY];
}

/**
 * The validated input shaped exactly like the contract's `request` schema —
 * the same value the typefetch client passed as `input`. Type it with
 * `InferRequest<typeof contracts.module.endpoint>`.
 *
 * Falls back to the raw request parts when validation is disabled.
 */
export const ContractInput = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const parsed = getParsed(ctx);
    if (parsed) return parsed.input;

    const req = ctx.switchToHttp().getRequest();
    return {
      path: req.params,
      query: req.query,
      body: req.body,
      headers: req.headers,
    };
  },
);

/** Validated (and coerced) path params — the contract's `request.path` part. */
export const ContractPath = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    getParsed(ctx)?.path ?? ctx.switchToHttp().getRequest().params,
);

/** Validated (and coerced) query params — the contract's `request.query` part. */
export const ContractQuery = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    getParsed(ctx)?.query ?? ctx.switchToHttp().getRequest().query,
);

/** Validated body — the contract's `request.body` part (or the whole flat input). */
export const ContractBody = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const parsed = getParsed(ctx);
    if (parsed) return parsed.body;
    return ctx.switchToHttp().getRequest().body;
  },
);

/** Validated headers — the contract's `request.headers` part. */
export const ContractHeaders = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) =>
    getParsed(ctx)?.headers ?? ctx.switchToHttp().getRequest().headers,
);
