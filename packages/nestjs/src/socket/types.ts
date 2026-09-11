import type {
  ClientToServerDef,
  ServerToClientDef,
  SocketContracts,
  SocketEventDef,
} from '@tahanabavi/typesocket'
import type { z } from 'zod'

/**
 * typesocket is imported for **types only**, deliberately.
 *
 * Its package entry pulls in `socket.io-client` — a browser package that has no
 * business being installed on a server. A type-only import is erased at build
 * time, so this entry point can share typesocket's contract vocabulary exactly
 * without dragging its runtime along. The two one-line runtime rules it would
 * otherwise provide (`makeEventId`, `resolveEventName`) are restated in
 * `./contract.ts`, next to the reason.
 */

/**
 * A contract event, with the identity it only has in the context of the map it
 * was declared in.
 *
 * A definition object alone does not know its own name: the wire event name
 * defaults to `"module.event"`, which is a fact about *where* it sits, not
 * *what* it is. Both ends of the contract resolve it the same way, so the
 * server has to as well — which is what `bindSocketContracts()` does.
 */
export type BoundSocketEvent<E extends SocketEventDef = SocketEventDef> = {
  /** Stable `"module.event"` identifier — the cross-package key. */
  eventId: string
  module: string
  name: string
  /** The wire event name actually sent: `def.event`, else the id. */
  event: string
  def: E
}

/** The shape {@link bindSocketContracts} returns: the contract map, bound. */
export type BoundSocketContracts<C extends SocketContracts> = {
  [M in keyof C]: { [E in keyof C[M]]: BoundSocketEvent<C[M][E]> }
}

/**
 * Anything socket.io can emit through — a `Server`, a `Namespace`, a `Socket`,
 * or the `BroadcastOperator` that `.to(room)` returns.
 *
 * Declared structurally so this package needs no socket.io types, the same seam
 * the permission guard uses for `authorize`.
 */
export type SocketEmitTarget = {
  emit(event: string, ...args: unknown[]): unknown
}

/** The payload type of a `server->client` event. */
export type InferSocketPayload<E> = E extends ServerToClientDef
  ? z.infer<E['payload']>
  : E extends BoundSocketEvent<infer D>
    ? D extends ServerToClientDef
      ? z.infer<D['payload']>
      : never
    : never

/** The request (inbound payload) type of a `client->server` event. */
export type InferSocketRequest<E> = E extends ClientToServerDef
  ? z.infer<E['request']>
  : E extends BoundSocketEvent<infer D>
    ? D extends ClientToServerDef
      ? z.infer<D['request']>
      : never
    : never

/** The acknowledgement type of a `client->server` event, or `void`. */
export type InferSocketAck<E> =
  E extends BoundSocketEvent<infer D>
    ? D extends { ack: infer A extends z.ZodTypeAny }
      ? z.infer<A>
      : void
    : E extends { ack: infer A extends z.ZodTypeAny }
      ? z.infer<A>
      : void

export interface SocketEventOptions {
  /** Validate the handler's acknowledgement against `def.ack`. Default `true`. */
  validateAck?: boolean
}
