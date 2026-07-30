import { P } from "./fixture";

describe("explain", () => {
  it("granted-direct", () => {
    const r = P.explain(P.pack(["chat.VIEW_CHANNEL"]), "chat.VIEW_CHANNEL");
    expect(r).toMatchObject({ granted: true, reason: "granted-direct" });
  });

  it("granted-implied names the source flag", () => {
    const r = P.explain(
      P.pack(["chat.VIEW_CHANNEL", "chat.MANAGE_MESSAGES"]),
      "chat.SEND_MESSAGES",
    );
    expect(r.granted).toBe(true);
    expect(r.reason).toBe("granted-implied");
    expect(r.detail).toContain("chat.MANAGE_MESSAGES");
  });

  it("granted-admin points at the grantsAll flag", () => {
    const r = P.explain(P.pack(["guild.ADMINISTRATOR"]), "guild.KICK_MEMBERS");
    expect(r.granted).toBe(true);
    expect(r.reason).toBe("granted-admin");
    expect(r.detail).toContain("guild.ADMINISTRATOR");
  });

  it("denied-requires names the failed prerequisite", () => {
    const r = P.explain(P.pack(["chat.MANAGE_MESSAGES"]), "chat.SEND_MESSAGES");
    expect(r.granted).toBe(false);
    expect(r.reason).toBe("denied-requires");
    expect(r.detail).toContain("chat.VIEW_CHANNEL");
  });

  it("denied-missing when never granted", () => {
    const r = P.explain(P.empty, "guild.KICK_MEMBERS");
    expect(r).toMatchObject({ granted: false, reason: "denied-missing" });
  });

  it("denied-layer with a tier trace when given layers", () => {
    const r = P.explain(
      [
        { allow: P.mask("chat.VIEW_CHANNEL"), source: "@everyone" },
        { deny: P.mask("chat.VIEW_CHANNEL"), source: "channel" },
      ],
      "chat.VIEW_CHANNEL",
    );
    expect(r.granted).toBe(false);
    expect(r.reason).toBe("denied-layer");
    expect(r.trace).toEqual([
      { tier: 0, source: "@everyone", effect: "allow" },
      { tier: 1, source: "channel", effect: "deny" },
    ]);
  });

  it("throws on an unknown flag", () => {
    // @ts-expect-error — not in the tree
    expect(() => P.explain(0n, "chat.NOPE")).toThrow(/unknown flag/);
  });
});
