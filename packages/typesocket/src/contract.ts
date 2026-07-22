import type {
  ClientToServerDef,
  ServerToClientDef,
  SocketContracts,
  SocketEventDef,
  SocketEventMeta,
} from "./types";

/**
 * Identity helper that preserves literal types without forcing `as const` at
 * every call site (via the `const` type parameter).
 *
 * @example
 * export const wsContracts = defineSocketContracts({
 *   chat: {
 *     sendMessage: {
 *       direction: "client->server",
 *       request: z.object({ text: z.string() }),
 *       ack: z.object({ id: z.string() }),
 *     },
 *     message: {
 *       direction: "server->client",
 *       payload: z.object({ id: z.string(), text: z.string() }),
 *     },
 *   },
 * });
 */
export function defineSocketContracts<const C extends SocketContracts>(
  contracts: C,
): C {
  return contracts;
}

/** Narrows an event definition to the client→server direction. */
export function isClientToServer(
  def: SocketEventDef,
): def is ClientToServerDef {
  return def.direction === "client->server";
}

/** Narrows an event definition to the server→client direction. */
export function isServerToClient(
  def: SocketEventDef,
): def is ServerToClientDef {
  return def.direction === "server->client";
}

/** Builds the stable cross-package identifier for an event. */
export function makeEventId(module: string, name: string): string {
  return `${module}.${name}`;
}

/**
 * Resolves the wire event name: the explicit `event` override, else the
 * `"module.name"` id. Defaulting to the id (rather than the bare key) keeps
 * event names unique across modules on the wire.
 */
export function resolveEventName(
  def: SocketEventDef,
  module: string,
  name: string,
): string {
  return def.event ?? makeEventId(module, name);
}

/**
 * Flattens a contract map into a list. Used by devtools to enumerate the
 * surface, and by server adapters to bind handlers.
 */
export function listSocketEvents(
  contracts: SocketContracts,
): SocketEventMeta[] {
  const out: SocketEventMeta[] = [];
  for (const [module, events] of Object.entries(contracts)) {
    for (const [name, def] of Object.entries(events)) {
      out.push({
        eventId: makeEventId(module, name),
        module,
        name,
        event: resolveEventName(def, module, name),
        direction: def.direction,
        description: def.description,
      });
    }
  }
  return out;
}

/**
 * Validates a contract map at startup, returning human-readable problems.
 *
 * Catches the two mistakes that would otherwise surface as confusing runtime
 * behaviour: a missing/unknown `direction`, and two events colliding on the
 * same wire name (where one would silently shadow the other).
 */
export function validateSocketContracts(contracts: SocketContracts): string[] {
  const problems: string[] = [];
  const seenWireNames = new Map<string, string>();

  for (const [module, events] of Object.entries(contracts)) {
    for (const [name, def] of Object.entries(events)) {
      const eventId = makeEventId(module, name);

      if (def.direction !== "client->server" && def.direction !== "server->client") {
        problems.push(
          `"${eventId}" has an invalid direction ${JSON.stringify(
            (def as SocketEventDef).direction,
          )} — expected "client->server" or "server->client".`,
        );
        continue;
      }

      if (isClientToServer(def) && !def.request) {
        problems.push(`"${eventId}" is client->server but declares no \`request\` schema.`);
      }
      if (isServerToClient(def) && !def.payload) {
        problems.push(`"${eventId}" is server->client but declares no \`payload\` schema.`);
      }

      const wire = resolveEventName(def, module, name);
      const owner = seenWireNames.get(wire);
      if (owner) {
        problems.push(
          `"${eventId}" and "${owner}" both map to wire event "${wire}".`,
        );
      } else {
        seenWireNames.set(wire, eventId);
      }
    }
  }

  return problems;
}
