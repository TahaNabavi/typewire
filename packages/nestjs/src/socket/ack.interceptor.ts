import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common'
import type { ClientToServerDef } from '@tahanabavi/typesocket'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { formatZodIssues } from '../exceptions'
import { SOCKET_EVENT_METADATA, SOCKET_OPTIONS_METADATA } from './constants'
import { SocketContractException } from './exceptions'
import type { BoundSocketEvent, SocketEventOptions } from './types'

/**
 * Validate what a gateway handler acknowledges with.
 *
 * The mirror of response validation on an HTTP route, and it matters more here:
 * typesocket **validates the ack on arrival**, so an acknowledgement that does
 * not match the contract does not merely surprise the caller — it rejects, and
 * the caller sees a malformed-ack error with no hint of which server sent it.
 * Failing here names the event and puts it in the server's log.
 *
 * Applied by `@SocketEvent()`. An event that declares no `ack` is left alone.
 */
@Injectable()
export class SocketAckInterceptor implements NestInterceptor {
  private readonly logger = new Logger('TypeWireSocket')

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const bound: BoundSocketEvent<ClientToServerDef> | undefined =
      Reflect.getMetadata(SOCKET_EVENT_METADATA, context.getHandler())

    const options: SocketEventOptions =
      Reflect.getMetadata(SOCKET_OPTIONS_METADATA, context.getHandler()) ?? {}

    const schema = bound?.def.ack
    if (!bound || !schema || options.validateAck === false) {
      return next.handle()
    }

    return next.handle().pipe(
      map((value) => {
        // A handler that returns nothing for an event that declares an ack has
        // already failed the contract, but `undefined` is also what a fire-and-
        // forget handler returns — so let the schema decide, since a contract
        // may legitimately declare `ack: z.void()`.
        const parsed = schema.safeParse(value)
        if (parsed.success) return parsed.data

        const errors = formatZodIssues(parsed.error)
        this.logger.error(
          `Ack contract violation on ${bound.eventId}: ${JSON.stringify(errors)}`
        )

        throw new SocketContractException(
          bound.eventId,
          'Acknowledgement contract violation',
          'ACK_CONTRACT_VIOLATION'
        )
      })
    )
  }
}
