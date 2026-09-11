import type { ServerToClientDef } from '@tahanabavi/typesocket'
import { formatZodIssues } from '../exceptions'
import { SocketContractException } from './exceptions'
import type {
  BoundSocketEvent,
  InferSocketPayload,
  SocketEmitTarget,
} from './types'

/**
 * Push a `server->client` event, validated against its contract.
 *
 * The other half of the guarantee. `@SocketEvent()` makes sure an inbound frame
 * matches the contract; this makes sure an outbound one does — which is the
 * direction that actually breaks clients, because typesocket validates every
 * inbound payload and **drops** the ones that do not match. A field renamed on
 * the server without the contract turns into a listener that silently stops
 * firing, and this is what turns that into an error at the emit site.
 *
 * The target is anything socket.io can emit through — the `Server`, a
 * `Namespace`, one `Socket`, or the operator `.to(room)` returns:
 *
 * ```ts
 * ⁣@WebSocketServer() server: Server;
 *
 * broadcast(message: Message) {
 *   emitSocketEvent(this.server, events.chat.message, message);
 *   emitSocketEvent(this.server.to(roomId), events.chat.message, message);
 * }
 * ```
 */
export function emitSocketEvent<E extends ServerToClientDef>(
  target: SocketEmitTarget,
  event: BoundSocketEvent<E>,
  payload: InferSocketPayload<E>
): void {
  if (event.def.direction !== 'server->client') {
    throw new Error(
      `[typewire-nestjs] "${event.eventId}" is a ${JSON.stringify(
        event.def.direction
      )} event — a server does not emit it. Handle it with @SocketEvent() ` +
        `instead.`
    )
  }

  const parsed = event.def.payload.safeParse(payload)
  if (!parsed.success) {
    throw new SocketContractException(
      event.eventId,
      'Outbound payload contract violation',
      'PAYLOAD_CONTRACT_VIOLATION',
      formatZodIssues(parsed.error)
    )
  }

  target.emit(event.event, parsed.data)
}

/**
 * Bind an emitter to one target, for a gateway that pushes several events.
 *
 * ```ts
 * const emit = createSocketEmitter(() => this.server);
 * emit(events.chat.message, message);
 * ```
 *
 * The target is resolved per call rather than captured, because
 * `@WebSocketServer()` is assigned after the gateway is constructed — capturing
 * it in a constructor would capture `undefined`.
 */
export function createSocketEmitter(
  target: SocketEmitTarget | (() => SocketEmitTarget)
) {
  return <E extends ServerToClientDef>(
    event: BoundSocketEvent<E>,
    payload: InferSocketPayload<E>
  ): void => {
    const resolved = typeof target === 'function' ? target() : target
    emitSocketEvent(resolved, event, payload)
  }
}
