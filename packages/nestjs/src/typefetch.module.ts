import { DynamicModule, Module, Provider } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";
import { TYPEFETCH_MODULE_OPTIONS } from "./constants";
import { ContractEnvelopeExceptionFilter } from "./envelope/contract-exception.filter";
import { ResponseEnvelopeInterceptor } from "./envelope/response-envelope.interceptor";
import type { TypeFetchModuleOptions } from "./types";

/**
 * Optional global configuration. The decorators work without importing this
 * module (all validation options default to on); import it to change
 * behavior app-wide or to enable the response envelope:
 *
 * @example
 * ⁣@Module({
 *   imports: [
 *     TypeFetchModule.forRoot({
 *       exposeResponseErrors: process.env.NODE_ENV !== "production",
 *       envelope: true, // { success: true, data } / { success: false, message }
 *     }),
 *   ],
 * })
 * export class AppModule {}
 */
@Module({})
export class TypeFetchModule {
  static forRoot(options: TypeFetchModuleOptions = {}): DynamicModule {
    const providers: Provider[] = [
      { provide: TYPEFETCH_MODULE_OPTIONS, useValue: options },
    ];

    // Enabling the envelope registers a global success interceptor + a
    // catch-all error filter so *every* response (contract-bound or not)
    // carries the same shape the client's response wrapper expects.
    if (options.envelope) {
      providers.push(
        { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
        { provide: APP_FILTER, useClass: ContractEnvelopeExceptionFilter },
      );
    }

    return {
      module: TypeFetchModule,
      global: true,
      providers,
      exports: [TYPEFETCH_MODULE_OPTIONS],
    };
  }
}
