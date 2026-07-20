import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  Inject,
  Logger,
  Optional,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { TYPEFETCH_MODULE_OPTIONS } from "../constants";
import type { EnvelopeError, TypeFetchModuleOptions } from "../types";
import { resolveEnvelope } from "./resolve";

/**
 * Catch-all filter that formats every error into the shared envelope's error
 * branch (default `{ success: false, message, code?, errors? }`), so the
 * client's wrapper schema parses failures the same way it parses successes.
 *
 * Registered globally by `TypeFetchModule.forRoot({ envelope })`. The
 * original HTTP status is preserved unless `errorStatus: 200` is configured.
 * `RichError`-relevant fields (`code`, `errors`) are carried through from
 * `ContractValidationException` and any `HttpException` that provides them.
 */
@Catch()
export class ContractEnvelopeExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("TypeFetchEnvelope");

  constructor(
    @Inject(HttpAdapterHost) private readonly adapterHost: HttpAdapterHost,
    @Optional()
    @Inject(TYPEFETCH_MODULE_OPTIONS)
    private readonly options?: TypeFetchModuleOptions,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // `?? resolveEnvelope(true)!` guards the case where the filter is applied
    // manually with `envelope: false` — it still needs *some* error shape.
    const envelope =
      resolveEnvelope(this.options?.envelope) ?? resolveEnvelope(true)!;

    const info = this.extractError(exception);
    const status = envelope.errorStatus === 200 ? 200 : info.status;
    const body = envelope.error(info);

    const { httpAdapter } = this.adapterHost;
    httpAdapter.reply(host.switchToHttp().getResponse(), body, status);
  }

  private extractError(exception: unknown): EnvelopeError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      if (typeof response === "string") {
        return { status, message: response };
      }

      const r = response as Record<string, any>;
      const message = Array.isArray(r.message)
        ? r.message.join(", ")
        : (r.message ?? exception.message);

      return {
        status,
        message,
        ...(r.code !== undefined ? { code: r.code } : {}),
        ...(r.errors !== undefined ? { errors: r.errors } : {}),
      };
    }

    this.logger.error(
      exception instanceof Error
        ? (exception.stack ?? exception.message)
        : String(exception),
    );
    return { status: 500, message: "Internal server error" };
  }
}
