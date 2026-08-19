import type { SocketContracts, SocketEventDef } from "@tahanabavi/typesocket";
import type { BoundSocketContracts, BoundSocketEvent } from "./types";

/**
 * Give every event in a contract map its identity.
 *
 * ```ts
 * export const events = bindSocketContracts(wsContracts);
 *
 * ⁣@SocketEvent(events.chat.sendMessage)   // knows it is "chat.sendMessage"
 * ```
 *
 * The wire event name defaults to the `"module.event"` id, so a definition
 * object handed around on its own cannot say what it is called. The client
 * resolves that from the map it walks; the server has to walk the same map to
 * get the same answer, and this is that walk — done once, at import time.
 *
 * It also catches the one contract mistake that is invisible at runtime: two
 * events colliding on a single wire name, where both handlers would fire for
 * one frame and both would try to acknowledge it.
 */
export function bindSocketContracts<const C extends SocketContracts>(
  contracts: C,
): BoundSocketContracts<C> {
  const bound = {} as Record<string, Record<string, BoundSocketEvent>>;
  const claimed = new Map<string, string>();

  for (const [module, events] of Object.entries(contracts)) {
    bound[module] = {};

    for (const [name, def] of Object.entries(events)) {
      const eventId = `${module}.${name}`;
      // Mirrors typesocket's `resolveEventName`: the explicit `event` override,
      // else the id — defaulting to the id rather than the bare key is what
      // keeps names unique across modules on the wire. Restated rather than
      // imported because importing typesocket at runtime would put
      // `socket.io-client` on the server. @see ./types.ts
      const event = def.event ?? eventId;

      const owner = claimed.get(event);
      if (owner) {
        throw new Error(
          `[typewire-nestjs] "${eventId}" and "${owner}" both map to the wire ` +
            `event "${event}". One frame would reach both handlers, and both ` +
            `would try to acknowledge it.`,
        );
      }
      claimed.set(event, eventId);

      bound[module]![name] = { eventId, module, name, event, def };
    }
  }

  return bound as BoundSocketContracts<C>;
}

/** Narrows a bound event to the client→server direction. */
export function isInboundEvent(
  bound: BoundSocketEvent<SocketEventDef>,
): boolean {
  return bound.def.direction === "client->server";
}
