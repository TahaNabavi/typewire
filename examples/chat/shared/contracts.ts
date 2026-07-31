import { z } from "zod";
import { defineSocketContracts } from "@tahanabavi/typesocket";

export const messageSchema = z.object({
  id: z.string(),
  roomId: z.string(),
  user: z.string(),
  text: z.string(),
  sentAt: z.number(),
});

export type Message = z.infer<typeof messageSchema>;

/**
 * The single source of truth for the whole app.
 *
 * `server/index.ts` and `client/src/*` both import this file. Direction is
 * declared per event, so the server reads `client->server` as "handle this"
 * and `server->client` as "push this" — the exact reverse of the client — with
 * no mirrored declaration that can drift.
 */
export const chatContracts = defineSocketContracts({
  room: {
    /** Join a room; the ack carries the state needed to render it. */
    join: {
      direction: "client->server",
      description: "Join a room and receive its history and member list.",
      request: z.object({
        roomId: z.string().min(1),
        user: z.string().min(1).max(24),
      }),
      ack: z.object({
        roomId: z.string(),
        history: z.array(messageSchema),
        members: z.array(z.string()),
      }),
    },

    /** Leave the current room. Nothing to wait for. */
    leave: {
      direction: "client->server",
      request: z.object({ roomId: z.string() }),
    },

    /** Broadcast whenever a room's membership changes. */
    presence: {
      direction: "server->client",
      payload: z.object({
        roomId: z.string(),
        members: z.array(z.string()),
      }),
    },
  },

  chat: {
    /** Send a message; the ack confirms the id the server assigned. */
    send: {
      direction: "client->server",
      description: "Post a message to a room.",
      request: z.object({
        roomId: z.string(),
        text: z.string().min(1).max(500),
      }),
      ack: z.object({ id: z.string(), sentAt: z.number() }),
      ackTimeoutMs: 5_000,
    },

    /** A message arriving from anyone in the room, including yourself. */
    message: {
      direction: "server->client",
      payload: messageSchema,
    },

    /**
     * Delete a message. Gated by the contract's `permission` key — a moderator
     * capability from `shared/permissions.ts`. The server guard reads this key
     * to reject the frame; the client reads it to hide the button. Written once.
     */
    deleteMessage: {
      direction: "client->server",
      description: "Remove a message from the room (moderators only).",
      permission: { require: ["chat.MANAGE_MESSAGES"] },
      request: z.object({ roomId: z.string(), id: z.string() }),
      ack: z.object({ ok: z.boolean() }),
    },

    /** A message was removed; every client drops it from the room. */
    deleted: {
      direction: "server->client",
      payload: z.object({ roomId: z.string(), id: z.string() }),
    },

    /** Typing signal. High-frequency, so deliberately no ack. */
    setTyping: {
      direction: "client->server",
      request: z.object({ roomId: z.string(), isTyping: z.boolean() }),
    },

    /** Someone else's typing state changed. */
    typing: {
      direction: "server->client",
      payload: z.object({
        roomId: z.string(),
        user: z.string(),
        isTyping: z.boolean(),
      }),
    },
  },
});

export type ChatContracts = typeof chatContracts;
