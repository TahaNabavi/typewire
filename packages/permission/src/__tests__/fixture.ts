import { definePermissions } from "../define";

/**
 * A Discord-shaped tree exercising every feature: gating (`requires`), upward
 * closure (`implies`), the admin escape hatch (`grantsAll`), a hidden flag, a
 * deprecated flag, and a high bit (63) to keep BigInt honest.
 */
export const P = definePermissions({
  chat: {
    VIEW_CHANNEL: { bit: 0, label: "View Channel" },
    SEND_MESSAGES: { bit: 1, requires: ["chat.VIEW_CHANNEL"] },
    MANAGE_MESSAGES: { bit: 2, implies: ["chat.SEND_MESSAGES"] },
    ATTACH_FILES: { bit: 3, requires: ["chat.SEND_MESSAGES"] },
    LEGACY_TTS: { bit: 4, deprecated: true },
  },
  guild: {
    MANAGE_ROLES: { bit: 8 },
    KICK_MEMBERS: { bit: 9 },
    SECRET_OPS: { bit: 10, hidden: true },
    ADMINISTRATOR: { bit: 63, grantsAll: true },
  },
});

/** A bit no flag in the tree owns — stands in for a newer version's flag. */
export const UNKNOWN_BIT = 1n << 100n;
