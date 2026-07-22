import { SocketClient } from "@tahanabavi/typesocket";

import { chatContracts } from "../../shared/contracts.js";

/**
 * One client for the whole app.
 *
 * `autoConnect: false` because the connection is opened from React once, in an
 * effect — creating the client at module scope keeps its identity stable across
 * Fast Refresh and StrictMode's double-mount.
 */
export const socket = new SocketClient(
  {
    url: import.meta.env.VITE_SOCKET_URL ?? "http://localhost:3102",
    autoConnect: false,
    ackTimeoutMs: 5_000,
    // Inbound frames that fail their schema never reach a handler. In a real
    // app this is where you'd report to Sentry rather than log.
    onValidationError: (error) => {
      console.warn(`[typesocket] dropped an invalid ${error.eventId}`, error.issues);
    },
  },
  chatContracts,
);
