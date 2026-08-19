import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  createParamDecorator,
} from "@nestjs/common";
import { GrpcCode } from "@tahanabavi/typefetch-grpc";
import { Observable, throwError } from "rxjs";
import { timeout } from "rxjs/operators";
import { GrpcException } from "./errors";
import type { GrpcDeadlineInfo } from "./types";

/** Where the resolved deadline is parked for `@GrpcDeadline()` to read. */
export const GRPC_DEADLINE_KEY = Symbol.for("typewire:grpcDeadline");

/**
 * `grpc-timeout` unit suffixes, in milliseconds.
 *
 * Case is load-bearing: `M` is minutes and `m` is milliseconds, and getting
 * them backwards is a 60000× error in the direction that hangs a server.
 */
const UNIT_MS: Record<string, number> = {
  H: 3_600_000,
  M: 60_000,
  S: 1_000,
  m: 1,
  u: 1e-3,
  n: 1e-6,
};

/**
 * Read the caller's deadline from either spelling.
 *
 * `Connect-Timeout-Ms` is preferred because it needs no unit parsing;
 * `grpc-timeout` is what a grpc-web proxy forwards. typefetch's transport sends
 * both, but anything else on the wire may send only one.
 */
export function parseDeadline(
  headers: Record<string, unknown> | undefined,
): number | undefined {
  if (!headers) return undefined;

  const connect = readHeader(headers, "connect-timeout-ms");
  if (connect !== undefined) {
    const ms = Number(connect);
    return Number.isFinite(ms) && ms > 0 ? ms : undefined;
  }

  const grpc = readHeader(headers, "grpc-timeout");
  if (grpc === undefined) return undefined;

  const match = /^(\d+)([HMSmun])$/.exec(grpc.trim());
  if (!match) return undefined;

  const ms = Number(match[1]) * UNIT_MS[match[2]!]!;
  return Number.isFinite(ms) && ms > 0 ? ms : undefined;
}

function readHeader(
  headers: Record<string, unknown>,
  name: string,
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? String(value[0]) : String(value);
}

/**
 * Enforce the caller's deadline.
 *
 * A deadline that only the client honours is a timeout: the caller gives up and
 * the server keeps the database connection. This is the half that makes it a
 * deadline — the handler is cut off, and anything it was given the
 * {@link GrpcDeadlineInfo} signal for is aborted with it.
 *
 * Applied by `@GrpcEndpoint()`. Requests without either timeout header run
 * untouched.
 */
@Injectable()
export class ConnectDeadlineInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== "http") return next.handle();

    const request = context.switchToHttp().getRequest();
    const timeoutMs = parseDeadline(request?.headers);
    if (timeoutMs === undefined) return next.handle();

    const controller = new AbortController();
    const expiresAt = Date.now() + timeoutMs;

    const deadline: GrpcDeadlineInfo = {
      timeoutMs,
      expiresAt,
      signal: controller.signal,
      remaining: () => Math.max(0, expiresAt - Date.now()),
    };

    try {
      request[GRPC_DEADLINE_KEY] = deadline;
    } catch {
      /* frozen request — the interceptor still enforces the deadline */
    }

    return next.handle().pipe(
      timeout({
        each: timeoutMs,
        with: () => {
          controller.abort();
          return throwError(
            () =>
              new GrpcException(
                GrpcCode.DeadlineExceeded,
                `Deadline of ${timeoutMs}ms exceeded`,
              ),
          );
        },
      }),
    );
  }
}

/**
 * The caller's deadline, for handlers that can act on it.
 *
 * `undefined` when the caller set none — which is the common case, and why the
 * signal is worth checking for rather than assuming.
 *
 * @example
 * ⁣@GrpcEndpoint(contracts.user.getUser)
 * getUser(⁣@ContractInput() input, ⁣@GrpcDeadline() deadline?: GrpcDeadlineInfo) {
 *   return this.db.query(sql, { signal: deadline?.signal });
 * }
 */
export const GrpcDeadline = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): GrpcDeadlineInfo | undefined =>
    ctx.switchToHttp().getRequest()?.[GRPC_DEADLINE_KEY],
);
