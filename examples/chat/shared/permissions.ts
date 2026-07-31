import { definePermissions } from "@tahanabavi/type-permission";

/**
 * The one bit map both ends import.
 *
 * `server/index.ts` uses it to *enforce* who may delete a message; the client
 * uses the exact same map to *hide* the delete button. There is no second copy
 * to drift — the same reason `shared/contracts.ts` is shared.
 *
 * This is Discord's model in miniature: `MANAGE_MESSAGES` is the moderator
 * capability, `ADMINISTRATOR` short-circuits to everything.
 */
export const P = definePermissions({
  chat: {
    VIEW_ROOM: { bit: 0, label: "View room" },
    SEND_MESSAGES: { bit: 1, label: "Send messages", requires: ["chat.VIEW_ROOM"] },
    // A moderator can delete; deleting implies you could also send.
    MANAGE_MESSAGES: {
      bit: 2,
      label: "Delete messages",
      implies: ["chat.SEND_MESSAGES"],
    },
  },
  server: {
    ADMINISTRATOR: { bit: 8, label: "Administrator", grantsAll: true },
  },
});

/** A role is just a named set of flag names. */
const ROLE_FLAGS = {
  admin: ["server.ADMINISTRATOR"],
  moderator: ["chat.VIEW_ROOM", "chat.MANAGE_MESSAGES"],
  member: ["chat.VIEW_ROOM", "chat.SEND_MESSAGES"],
} as const;

export type Role = keyof typeof ROLE_FLAGS;

/**
 * A deliberately silly demo heuristic: your role comes from your name. Join as
 * `admin`, `mod-taha`, or anything else to feel the difference — in a real app
 * this is a database lookup, not a string match.
 */
export function roleForUser(user: string): Role {
  const u = user.toLowerCase();
  if (u.includes("admin")) return "admin";
  if (u.startsWith("mod")) return "moderator";
  return "member";
}

/**
 * The actor's **effective** bitfield. `P.from` runs the post-passes, so
 * `admin` (via `grantsAll`) resolves to every capability and `moderator`
 * (via `implies`) also gains `SEND_MESSAGES` — without listing them.
 */
export function permsForUser(user: string): bigint {
  return P.from(ROLE_FLAGS[roleForUser(user)]);
}
