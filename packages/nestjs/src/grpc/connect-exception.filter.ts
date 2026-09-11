import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  Inject,
  Logger,
  Optional,
} from '@nestjs/common'
import { HttpAdapterHost } from '@nestjs/core'
import { statusFromGrpcCode, parseCode } from '@tahanabavi/typefetch-grpc'
import { GrpcException, toConnectError } from './errors'

/**
 * Answer a failed RPC the way a Connect client expects: a JSON body naming a
 * gRPC status code, under the HTTP status that code maps to.
 *
 * Applied per-route by `@GrpcEndpoint()`, which matters: a route-scoped filter
 * runs before any global one, so an app that turned on the `{ success, data }`
 * envelope keeps it for its REST routes and never wraps an RPC in it. A Connect
 * client reading `{ success: false, message }` sees no `code` at all and
 * classifies every failure as `unknown`.
 */
@Catch()
export class ConnectExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('TypeWireGrpc')

  // Explicit token: the published build (esbuild) emits no `design:paramtypes`,
  // so by-type injection would resolve to `Object` there.
  constructor(
    @Optional()
    @Inject(HttpAdapterHost)
    private readonly adapterHost?: HttpAdapterHost
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception

    const payload = toConnectError(exception)
    const status = statusFromGrpcCode(parseCode(payload.code))

    // A `GrpcException` is a decision the handler made — a deadline, an
    // `unavailable` — so its message is the whole story. Anything else that
    // reaches a 5xx is a fault nobody chose, and the stack is the only place
    // the cause survives, because the client is told nothing but "internal".
    if (status >= 500) {
      if (exception instanceof GrpcException) {
        this.logger.warn(`${payload.code}: ${payload.message}`)
      } else {
        this.logger.error(
          exception instanceof Error
            ? (exception.stack ?? exception.message)
            : String(exception)
        )
      }
    }

    const response = host.switchToHttp().getResponse()
    const httpAdapter = this.adapterHost?.httpAdapter

    if (httpAdapter) {
      httpAdapter.reply(response, payload, status)
      return
    }

    // No adapter host (a hand-instantiated filter in a unit test): fall back to
    // the platform response, which both Express and Fastify satisfy.
    response.status(status).json(payload)
  }
}
