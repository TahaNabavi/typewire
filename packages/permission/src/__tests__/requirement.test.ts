import { P } from "./fixture";

describe("authorize — the contract `permission` key", () => {
  const perms = P.from(["chat.VIEW_CHANNEL", "chat.SEND_MESSAGES"]);

  it("require: needs all listed flags", () => {
    expect(P.authorize(perms, { require: ["chat.VIEW_CHANNEL"] }).granted).toBe(true);
    const d = P.authorize(perms, {
      require: ["chat.VIEW_CHANNEL", "chat.ATTACH_FILES"],
    });
    expect(d.granted).toBe(false);
    expect(d.missing).toEqual(["chat.ATTACH_FILES"]);
  });

  it("any: needs at least one", () => {
    expect(
      P.authorize(perms, { any: ["chat.ATTACH_FILES", "chat.SEND_MESSAGES"] }).granted,
    ).toBe(true);
    const d = P.authorize(perms, { any: ["chat.ATTACH_FILES", "guild.KICK_MEMBERS"] });
    expect(d.granted).toBe(false);
    expect(d.missingAny).toEqual(["chat.ATTACH_FILES", "guild.KICK_MEMBERS"]);
  });

  it("require and any must both pass; reason is carried through", () => {
    const d = P.authorize(perms, {
      require: ["chat.VIEW_CHANNEL"],
      any: ["guild.KICK_MEMBERS"],
      reason: "mods only",
    });
    expect(d.granted).toBe(false);
    expect(d.reason).toBe("mods only");
  });

  it("an empty requirement grants", () => {
    expect(P.authorize(perms, {}).granted).toBe(true);
  });

  it("check() is boolean sugar over authorize()", () => {
    expect(P.check(perms, { require: ["chat.SEND_MESSAGES"] })).toBe(true);
    expect(P.check(perms, { require: ["guild.ADMINISTRATOR"] })).toBe(false);
  });
});
