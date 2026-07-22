import { z } from "zod";
import { defineSocketContracts } from "@tahanabavi/typesocket";

/**
 * The single source of truth.
 *
 * Both `server.ts` and `client.ts` import this file. Because each event
 * declares the direction it travels, the *same* object reads correctly from
 * both ends — the client emits `client->server` events and listens to
 * `server->client` ones, and the server does exactly the reverse.
 */
export const contracts = defineSocketContracts({
  echo: {
    /** Client asks; the ack carries the answer. */
    say: {
      direction: "client->server",
      request: z.object({ text: z.string().min(1) }),
      ack: z.object({ echoed: z.string(), at: z.number() }),
    },

    /** Client tells; nobody answers. */
    ping: {
      direction: "client->server",
      request: z.object({ seq: z.number().int() }),
    },

    /** Server pushes, unprompted. */
    tick: {
      direction: "server->client",
      payload: z.object({ seq: z.number().int(), at: z.number() }),
    },
  },
});
