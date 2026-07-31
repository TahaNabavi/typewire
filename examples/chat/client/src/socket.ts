import { SocketClient, createPermissionMiddleware } from "@tahanabavi/typesocket";

import { chatContracts } from "../../shared/contracts.js";
import { P, permsForUser } from "../../shared/permissions.js";

/**
 * The actor's current bits. The client is module-scoped and outlives any one
 * identity, so the guard reads through this mutable holder — `setPerms` is called
 * on join. In a real app these come from the verified session, not the name.
 */
let currentPerms = 0n;
export function setPerms(user: string | null): void {
  currentPerms = user ? permsForUser(user) : 0n;
}

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
  {
    // Defense in depth: the delete button is already hidden for non-mods, but
    // this blocks the emit itself — even a hand-called one throws before it
    // reaches the wire. The server still re-checks; this is UX only.
    authorizeOutbound: createPermissionMiddleware({
      getPermissions: () => currentPerms,
      authorize: P.authorize,
    }),
  },
);
