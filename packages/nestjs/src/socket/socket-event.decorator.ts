import {
  SetMetadata,
  UseInterceptors,
  applyDecorators,
  createParamDecorator,
  type ExecutionContext,
} from '@nestjs/common'
import { SubscribeMessage } from '@nestjs/websockets'
import type { ClientToServerDef } from '@tahanabavi/typesocket'
import { formatZodIssues } from '../exceptions'
import { SOCKET_EVENT_METADATA, SOCKET_OPTIONS_METADATA } from './constants'
import { SocketContractException } from './exceptions'
import { SocketAckInterceptor } from './ack.interceptor'
import type { BoundSocketEvent, SocketEventOptions } from './types'

/**
 * Bind a gateway handler to a `client->server` contract event.
 *
 * The wire event name comes from the contract, so it can never drift from what
 * the client emits — the WebSocket half of what `@TypeFetchEndpoint()` does for
 * a route.
 *
 * One contract object serves both ends because typesocket events declare their
 * own `direction`: the client emits `client->server` and listens to
 * `server->client`; a gateway does exactly the reverse, from the same file.
 *
 * @example
 * ⁣@WebSocketGateway()
 * class ChatGateway {
 *   ⁣@SocketEvent(events.chat.sendMessage)
 *   async send(⁣@SocketPayload() input: InferSocketRequest<typeof events.chat.sendMessage>) {
 *     const message = await this.chat.post(input.text);
 *     return { id: message.id };   // validated against the contract's `ack`
 *   }
 * }
 */
export function SocketEvent<E extends ClientToServerDef>(
  bound: BoundSocketEvent<E>,
  options: SocketEventOptions = {}
): MethodDecorator {
  if (bound.def.direction !== 'client->server') {
    throw new Error(
      `[typewire-nestjs] "${bound.eventId}" is a ${JSON.stringify(
        bound.def.direction
      )} event, so a gateway pushes it rather than handling it. Send it with ` +
        `emitSocketEvent(target, event, payload); @SocketEvent() binds ` +
        `"client->server" events only.`
    )
  }

  return applyDecorators(
    SubscribeMessage(bound.event),
    SetMetadata(SOCKET_EVENT_METADATA, bound),
    SetMetadata(SOCKET_OPTIONS_METADATA, options),
    UseInterceptors(SocketAckInterceptor)
  )
}

/**
 * The validated inbound payload — the WebSocket analogue of `@ContractInput()`.
 *
 * This is where a frame is checked against its contract, so read it here rather
 * than with `@MessageBody()`: the raw frame is whatever the sender put on the
 * wire, and nothing else validates it.
 *
 * A validation failure throws {@link SocketContractException}, which NestJS
 * sends as socket.io's `exception` event. It does **not** acknowledge the
 * frame — see that class for why an ack cannot carry an error.
 */
export const SocketPayload = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext) => {
    const bound: BoundSocketEvent<ClientToServerDef> | undefined =
      Reflect.getMetadata(SOCKET_EVENT_METADATA, ctx.getHandler())

    const data = ctx.switchToWs().getData()
    if (!bound) return data

    const parsed = bound.def.request.safeParse(data)
    if (parsed.success) return parsed.data

    throw new SocketContractException(
      bound.eventId,
      'Frame validation failed',
      'VALIDATION_ERROR',
      formatZodIssues(parsed.error)
    )
  }
)

/**
 * The contract event this handler is bound to — for a guard, an audit log, or
 * anything that needs the identity rather than the payload.
 */
export const SocketEventInfo = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): BoundSocketEvent | undefined =>
    Reflect.getMetadata(SOCKET_EVENT_METADATA, ctx.getHandler())
)

/** Read the bound contract event off a handler, for guards and interceptors. */
export function getSocketEvent(
  context: ExecutionContext
): BoundSocketEvent | undefined {
  return Reflect.getMetadata(SOCKET_EVENT_METADATA, context.getHandler())
}
