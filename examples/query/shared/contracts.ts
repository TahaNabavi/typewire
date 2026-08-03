import { zFile } from "@tahanabavi/typefetch";
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

  /**
   * The only module here that touches the network. The user and chat endpoints
   * are answered locally by an override; a progress bar needs bytes actually
   * moving, so these two are served by a real HTTP handler — the Vite dev server
   * in the browser, a `node:http` server in the headless run.
   */
  media: {
    /** Multipart upload. The call site opts into progress, not the contract. */
    upload: {
      method: "POST",
      path: "/media",
      bodyType: "form-data",
      request: z.object({
        body: z.object({ file: z.instanceof(Blob), note: z.string().optional() }),
      }),
      response: z.object({ id: z.string(), bytes: z.number() }),
    },

    /**
     * `responseType: "file"` — the response is decoded as a Blob and paired with
     * the filename parsed out of `Content-Disposition`, which is the thing every
     * download call site otherwise re-derives by hand.
     */
    download: {
      method: "GET",
      path: "/media/:id",
      responseType: "file",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: zFile(),
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
