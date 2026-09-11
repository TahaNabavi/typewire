import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
  Optional,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { AnyEndpointDefZ } from '@tahanabavi/typefetch'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import {
  SKIP_ENVELOPE_KEY,
  TYPEFETCH_ENDPOINT_METADATA,
  TYPEFETCH_MODULE_OPTIONS,
  TYPEFETCH_SKIP_ENVELOPE_METADATA,
} from '../constants'
import { isHttpEndpoint } from '../transport'
import type { TypeFetchModuleOptions } from '../types'
import { resolveEnvelope } from './resolve'

/**
 * Wraps successful responses in the shared envelope (default
 * `{ success: true, data }`), mirroring the client's `setResponseWrapper`.
 *
 * Registered globally by `TypeFetchModule.forRoot({ envelope })`. Being
 * global, it runs *outside* the method-scoped contract interceptor — so the
 * raw handler value is validated against `endpoint.response` first, then the
 * validated result is wrapped. `undefined` (a 204) is left untouched.
 *
 * Three kinds of response are exempt, because their shape is not ours to
 * choose:
 *
 * - anything that is not an HTTP call — a WebSocket ack is validated against
 *   the contract's `ack` schema, and a wrapper would fail it;
 * - a route bound to a non-HTTP contract, which brings its own envelope
 *   (GraphQL's `{ data, errors }`, a Connect error body);
 * - a route marked `@SkipEnvelope()`.
 */
@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  constructor(
    @Optional() @Inject(Reflector) private readonly reflector?: Reflector,
    @Optional()
    @Inject(TYPEFETCH_MODULE_OPTIONS)
    private readonly options?: TypeFetchModuleOptions
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const envelope = resolveEnvelope(this.options?.envelope)
    if (!envelope) return next.handle()

    if (this.isExempt(context)) {
      this.markSkipped(context)
      return next.handle()
    }

    return next
      .handle()
      .pipe(map((data) => (data === undefined ? data : envelope.success(data))))
  }

  private isExempt(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true

    const reflector = this.reflector
    if (!reflector) return false

    const skip = reflector.getAllAndOverride<boolean | undefined>(
      TYPEFETCH_SKIP_ENVELOPE_METADATA,
      [context.getHandler(), context.getClass()]
    )
    if (skip) return true

    const endpoint = reflector.get<AnyEndpointDefZ | undefined>(
      TYPEFETCH_ENDPOINT_METADATA,
      context.getHandler()
    )

    return endpoint !== undefined && !isHttpEndpoint(endpoint)
  }

  /**
   * Carry the exemption to the exception filter, which sees an `ArgumentsHost`
   * and so cannot read the handler's metadata for itself.
   */
  private markSkipped(context: ExecutionContext): void {
    if (context.getType() !== 'http') return
    const request = context.switchToHttp().getRequest()
    if (request && typeof request === 'object') {
      try {
        ;(request as Record<symbol, unknown>)[SKIP_ENVELOPE_KEY] = true
      } catch {
        /* frozen request — the filter falls back to wrapping */
      }
    }
  }
}
