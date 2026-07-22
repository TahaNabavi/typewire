import type { Server, Socket } from "socket.io";
import type { z } from "zod";
import { listSocketEvents } from "@tahanabavi/typesocket";

import { chatContracts } from "../shared/contracts.js";

/**
 * Contract → server glue.
 *
 * Two helpers are all it takes to drive a socket.io server off the same
 * contract the client uses: one that binds an inbound handler with its request
 * schema, and one that pushes an outbound frame through its payload schema.
 * Neither repeats an event name or a shape.
 *
 * This is deliberately hand-rolled and small — it shows what the planned
 * `@tahanabavi/typewire-nestjs` WebSocket gateway will generate for you.
 */

/** `eventId` → the wire name the client actually emits on. */
const wire = new Map(
  listSocketEvents(chatContracts).map((e) => [e.eventId, e.event]),
);

function wireName(eventId: string): string {
  const name = wire.get(eventId);
  if (!name) throw new Error(`[server] "${eventId}" is not in the contract`);
  return name;
}

/**
 * Binds a `client->server` event. The handler receives the **parsed** input, so
 * it never sees a shape the contract forbids. Whatever it returns is validated
 * against the event's `ack` schema before being sent back — a server can't ship
 * an acknowledgement its own contract rejects.
 */
export function handle<TReq extends z.ZodTypeAny>(
  socket: Socket,
  eventId: string,
  def: { request: TReq; ack?: z.ZodTypeAny },
  handler: (input: z.infer<TReq>) => unknown | Promise<unknown>,
): void {
  socket.on(wireName(eventId), async (raw: unknown, ack?: (r: unknown) => void) => {
    const parsed = def.request.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[server] rejected ${eventId}:`, parsed.error.issues);
      return;
    }

    try {
      const result = await handler(parsed.data);
      if (!def.ack || !ack) return;

      const validated = def.ack.safeParse(result);
      if (!validated.success) {
        console.error(
          `[server] ${eventId} produced an ack that violates its own contract:`,
          validated.error.issues,
        );
        return;
      }
      ack(validated.data);
    } catch (error) {
      console.error(`[server] ${eventId} threw`, error);
    }
  });
}

/** Pushes a `server->client` event, validated on the way out. */
export function push<TPayload extends z.ZodTypeAny>(
  target: Server | Socket | ReturnType<Server["to"]>,
  eventId: string,
  def: { payload: TPayload },
  payload: z.infer<TPayload>,
): void {
  const parsed = def.payload.safeParse(payload);
  if (!parsed.success) {
    console.error(`[server] refused to push ${eventId}:`, parsed.error.issues);
    return;
  }
  target.emit(wireName(eventId), parsed.data);
}
