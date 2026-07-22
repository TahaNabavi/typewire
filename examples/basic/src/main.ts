import { runClient } from "./client.js";
import { startServer } from "./server.js";

const PORT = Number(process.env.PORT ?? 3101);

const stop = await startServer(PORT);
try {
  await runClient(PORT);
} finally {
  await stop();
}
