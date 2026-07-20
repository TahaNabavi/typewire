import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { map } from "rxjs/operators";
import { TYPEFETCH_MODULE_OPTIONS } from "../constants";
import type { TypeFetchModuleOptions } from "../types";
import { resolveEnvelope } from "./resolve";

/**
 * Wraps successful responses in the shared envelope (default
 * `{ success: true, data }`), mirroring the client's `setResponseWrapper`.
 *
 * Registered globally by `TypeFetchModule.forRoot({ envelope })`. Being
 * global, it runs *outside* the method-scoped contract interceptor — so the
 * raw handler value is validated against `endpoint.response` first, then the
 * validated result is wrapped. `undefined` (a 204) is left untouched.
 *
 * When applied manually without module options, it wraps with the defaults;
 * `envelope: false` disables it.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(
    @Optional()
    @Inject(TYPEFETCH_MODULE_OPTIONS)
    private readonly options?: TypeFetchModuleOptions,
  ) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<any> {
    const envelope = resolveEnvelope(this.options?.envelope);
    if (!envelope) return next.handle();

    return next
      .handle()
      .pipe(map((data) => (data === undefined ? data : envelope.success(data))));
  }
}
