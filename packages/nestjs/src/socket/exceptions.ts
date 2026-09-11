import { WsException } from '@nestjs/websockets'

/**
 * A contract failure on a socket frame.
 *
 * Sent as socket.io's standard `exception` event, which is what NestJS does
 * with any `WsException` — so a raw socket.io listener sees it, and the body
 * carries the same `{ message, code, errors }` shape an HTTP contract failure
 * does.
 *
 * **A frame's acknowledgement is not an error channel.** typesocket validates
 * an ack against the contract's `ack` schema, so an error object sent there
 * would fail that schema on arrival and be reported as a malformed ack rather
 * than as the rejection it is. An event whose failures the caller must handle
 * should say so in its contract — `ack: z.discriminatedUnion("ok", [ … ])` —
 * which is the same rule that governs `errors` on an HTTP endpoint.
 */
export class SocketContractException extends WsException {
  constructor(
    readonly eventId: string,
    message: string,
    readonly code: string,
    readonly errors?: Record<string, string[]>
  ) {
    super({
      event: eventId,
      message,
      code,
      ...(errors ? { errors } : {}),
    })
  }
}
