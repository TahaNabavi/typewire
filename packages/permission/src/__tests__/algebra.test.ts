import { P } from "./fixture";

describe("set algebra", () => {
  const a = P.pack(["chat.VIEW_CHANNEL", "chat.SEND_MESSAGES"]);
  const b = P.pack(["chat.SEND_MESSAGES", "chat.ATTACH_FILES"]);

  it("union / intersect / subtract", () => {
    expect(P.list(P.union(a, b))).toEqual([
      "chat.VIEW_CHANNEL",
      "chat.SEND_MESSAGES",
      "chat.ATTACH_FILES",
    ]);
    expect(P.list(P.intersect(a, b))).toEqual(["chat.SEND_MESSAGES"]);
    expect(P.list(P.subtract(a, b))).toEqual(["chat.VIEW_CHANNEL"]);
  });

  it("equals / isSuperset", () => {
    expect(P.equals(a, a)).toBe(true);
    expect(P.equals(a, b)).toBe(false);
    expect(P.isSuperset(P.union(a, b), a)).toBe(true);
    expect(P.isSuperset(a, b)).toBe(false);
  });

  it("canGrant blocks privilege escalation", () => {
    const mod = P.pack(["chat.MANAGE_MESSAGES"]);
    const adminRole = P.pack(["guild.ADMINISTRATOR"]);
    // a mod cannot mint/assign an admin role they don't themselves hold
    expect(P.canGrant(mod, adminRole)).toBe(false);
    // an admin (full mask) can grant anything
    expect(P.canGrant(P.full, adminRole)).toBe(true);
    // you can always grant a subset of what you hold
    expect(P.canGrant(mod, P.pack(["chat.MANAGE_MESSAGES"]))).toBe(true);
  });
});
