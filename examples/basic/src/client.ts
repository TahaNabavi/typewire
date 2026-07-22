import {
  SocketValidationError,
  createSocketClient,
} from "@tahanabavi/typesocket";

import { contracts } from "./contracts.js";

export async function runClient(port: number) {
  const client = createSocketClient(
    { url: `http://localhost:${port}`, ackTimeoutMs: 3_000 },
    contracts,
  );

  // ── Instrumentation ────────────────────────────────────────────────────────
  // The devtools seam. Every frame, with its parsed payload and a `frameId`
  // that pairs an outbound emit with its ack.
  client.instrument({
    on(event) {
      if (event.type === "outbound") {
        console.log(`  ↗ ${event.frameId} ${event.eventId}`, event.payload);
      } else if (event.type === "ack") {
        console.log(`  ↙ ${event.frameId} ack in ${event.durationMs}ms`, event.data);
      } else if (event.type === "inbound") {
        console.log(`  ↘ ${event.frameId} ${event.eventId}`, event.payload);
      }
    },
  });

  await new Promise<void>((resolve) => client.onConnect(() => resolve()));
  console.log(`[client] connected as ${client.id}\n`);

  // ── Listening (server -> client) ───────────────────────────────────────────
  // `tick` is fully typed from the contract. The returned function unsubscribes.
  const off = client.modules.echo.tick.on((t) => {
    console.log(`[client] tick #${t.seq}`);
  });

  // ── Emitting with an ack (client -> server) ────────────────────────────────
  // Declaring `ack` in the contract makes this return a Promise — and the
  // acknowledgement is validated before it resolves.
  const reply = await client.modules.echo.say({ text: "hello typewire" });
  console.log(`[client] server echoed: "${reply.echoed}"\n`);

  // ── Emitting without an ack ────────────────────────────────────────────────
  // No `ack` in the contract, so this returns void.
  client.modules.echo.ping({ seq: 1 });

  // ── Validation is enforced, not decorative ─────────────────────────────────
  try {
    // @ts-expect-error — `seq` must be a number; this fails at compile time too.
    client.modules.echo.ping({ seq: "one" });
  } catch (error) {
    if (error instanceof SocketValidationError) {
      console.log(`[client] blocked a bad emit: ${error.issues[0]?.message}\n`);
    }
  }

  // ── Waiting for one specific frame ─────────────────────────────────────────
  const third = await client.modules.echo.tick.wait({
    timeoutMs: 10_000,
    filter: (t) => t.seq >= 3,
  });
  console.log(`[client] waited for tick #${third.seq}\n`);

  off();
  client.destroy();
  console.log("[client] done");
}
