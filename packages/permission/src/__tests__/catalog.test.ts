import { P } from "./fixture";

describe("catalog", () => {
  const rows = P.catalog();
  const byName = new Map(rows.map((r) => [r.name, r]));

  it("omits hidden flags but keeps everything else in declaration order", () => {
    expect(byName.has("guild.SECRET_OPS")).toBe(false);
    expect(rows[0]?.name).toBe("chat.VIEW_CHANNEL");
  });

  it("carries UI metadata and relationships", () => {
    expect(byName.get("chat.VIEW_CHANNEL")?.label).toBe("View Channel");
    expect(byName.get("chat.MANAGE_MESSAGES")?.implies).toEqual([
      "chat.SEND_MESSAGES",
    ]);
    expect(byName.get("chat.SEND_MESSAGES")?.requires).toEqual([
      "chat.VIEW_CHANNEL",
    ]);
    expect(byName.get("guild.ADMINISTRATOR")?.grantsAll).toBe(true);
    expect(byName.get("chat.LEGACY_TTS")?.deprecated).toBe(true);
  });

  it("is JSON-serializable", () => {
    expect(() => JSON.stringify(rows)).not.toThrow();
  });
});

describe("defineRoles", () => {
  it("produces raw bit bundles keyed by role name", () => {
    const roles = P.defineRoles({
      viewer: ["chat.VIEW_CHANNEL"],
      moderator: ["chat.VIEW_CHANNEL", "chat.MANAGE_MESSAGES"],
      admin: ["guild.ADMINISTRATOR"],
    });
    expect(typeof roles.viewer).toBe("bigint");
    expect(P.has(roles.moderator, "chat.MANAGE_MESSAGES")).toBe(true);
    // raw bundle — implies is NOT applied (that happens in resolve)
    expect(P.has(roles.moderator, "chat.SEND_MESSAGES")).toBe(false);
    // and it composes with resolve to gain the implied, gated flag
    const effective = P.resolve([{ allow: roles.moderator }]);
    expect(P.has(effective, "chat.SEND_MESSAGES")).toBe(true);
  });

  it("throws on an unknown flag in a role", () => {
    // @ts-expect-error — not in the tree
    expect(() => P.defineRoles({ bad: ["chat.NOPE"] })).toThrow(/unknown flag/);
  });
});
