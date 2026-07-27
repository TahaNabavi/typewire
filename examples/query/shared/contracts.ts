import { defineSocketContracts } from "@tahanabavi/typesocket";
import { z } from "zod";

/**
 * One HTTP contract and one WS contract. Nothing in either mentions caching,
 * keys or devtools — the first design law: higher layers read the contract,
 * they never add to it.
 */
export const httpContracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string(), name: z.string(), version: z.number() }),
    },
    updateUser: {
      method: "POST",
      path: "/users/:id",
      request: z.object({
        path: z.object({ id: z.string() }),
        body: z.object({ name: z.string() }),
      }),
      response: z.object({ ok: z.boolean() }),
    },
  },
} as const;

export const wsContracts = defineSocketContracts({
  chat: {
    /** Acked, so it is request/response shaped — the query engine can cache it. */
    sendMessage: {
      direction: "client->server",
      request: z.object({ text: z.string() }),
      ack: z.object({ id: z.string(), text: z.string() }),
    },
  },
});
