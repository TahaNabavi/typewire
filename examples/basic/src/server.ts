import { createServer } from "node:http";
import { Server } from "socket.io";
import { listSocketEvents } from "@tahanabavi/typesocket";

import { contracts } from "./contracts.js";

/**
 * A plain socket.io server driven by the same contract the client uses.
 *
 * Note what is *not* here: no duplicated event-name strings, no mirrored
 * schemas. `listSocketEvents` reads the wire names off the contract, and the
 * schemas are the contract's own — so a change to `contracts.ts` reaches both
 * sides at once.
 *
 * (A first-class NestJS gateway that does this for you is on the roadmap; this
 * shows the moving parts underneath it.)
 */
export function startServer(port: number) {
  const events = Object.fromEntries(
    listSocketEvents(contracts).map((e) => [e.eventId, e.event]),
  );

  const http = createServer();
  const io = new Server(http, { cors: { origin: "*" } });

  io.on("connection", (socket) => {
    console.log(`[server] client connected: ${socket.id}`);

    // client -> server, with an acknowledgement.
    socket.on(events["echo.say"]!, (raw: unknown, ack?: (r: unknown) => void) => {
      const parsed = contracts.echo.say.request.safeParse(raw);
      if (!parsed.success) {
        console.error("[server] rejected malformed echo.say", parsed.error.issues);
        return;
      }
      console.log(`[server] echo.say -> "${parsed.data.text}"`);
      ack?.({ echoed: parsed.data.text.toUpperCase(), at: Date.now() });
    });

    // client -> server, fire-and-forget.
    socket.on(events["echo.ping"]!, (raw: unknown) => {
      const parsed = contracts.echo.ping.request.safeParse(raw);
      if (parsed.success) console.log(`[server] echo.ping #${parsed.data.seq}`);
    });

    // server -> client, unprompted.
    let seq = 0;
    const timer = setInterval(() => {
      socket.emit(events["echo.tick"]!, { seq: seq++, at: Date.now() });
    }, 1_000);

    socket.on("disconnect", () => {
      clearInterval(timer);
      console.log(`[server] client disconnected: ${socket.id}`);
    });
  });

  return new Promise<() => Promise<void>>((resolve) => {
    http.listen(port, () => {
      console.log(`[server] listening on http://localhost:${port}`);
      resolve(
        () =>
          new Promise<void>((done) => {
            io.close();
            http.close(() => done());
          }),
      );
    });
  });
}
