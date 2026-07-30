import { P } from "./fixture";

describe("resolve — the layered fold", () => {
  it("allow beats deny within a single tier", () => {
    const perms = P.resolve([
      { allow: [P.mask("chat.VIEW_CHANNEL")], deny: [P.mask("chat.VIEW_CHANNEL")] },
    ]);
    expect(P.has(perms, "chat.VIEW_CHANNEL")).toBe(true);
  });

  it("a later tier beats an earlier one", () => {
    const perms = P.resolve([
      { allow: P.mask("chat.VIEW_CHANNEL"), source: "@everyone" },
      { deny: P.mask("chat.VIEW_CHANNEL"), source: "channel" },
    ]);
    expect(P.has(perms, "chat.VIEW_CHANNEL")).toBe(false);
  });

  it("models Discord's overwrite chain end to end", () => {
    const everyone = P.pack(["chat.VIEW_CHANNEL", "chat.SEND_MESSAGES"]);
    const modRole = P.pack(["chat.MANAGE_MESSAGES"]);
    const perms = P.resolve([
      { allow: everyone, source: "@everyone" },
      { allow: [modRole], source: "roles" },
      { deny: P.mask("chat.SEND_MESSAGES"), source: "channel:@everyone" },
      { allow: P.mask("chat.SEND_MESSAGES"), source: "channel:member" },
    ]);
    // channel:member re-allows SEND after channel:@everyone denied it
    expect(P.has(perms, "chat.SEND_MESSAGES")).toBe(true);
    expect(P.has(perms, "chat.MANAGE_MESSAGES")).toBe(true);
  });
});

describe("resolve — post-passes", () => {
  it("grantsAll expands to the full mask", () => {
    const perms = P.resolve([{ allow: P.mask("guild.ADMINISTRATOR") }]);
    expect(P.has(perms, "guild.KICK_MEMBERS")).toBe(true);
    expect(P.has(perms, "chat.VIEW_CHANNEL")).toBe(true);
    expect(perms & P.full).toBe(P.full);
  });

  it("implies grants transitively but requires still gates", () => {
    // MANAGE_MESSAGES → SEND_MESSAGES, but SEND needs VIEW_CHANNEL.
    const noView = P.resolve([{ allow: P.mask("chat.MANAGE_MESSAGES") }]);
    expect(P.has(noView, "chat.SEND_MESSAGES")).toBe(false);

    const withView = P.resolve([
      { allow: P.pack(["chat.VIEW_CHANNEL", "chat.MANAGE_MESSAGES"]) },
    ]);
    expect(P.has(withView, "chat.SEND_MESSAGES")).toBe(true);
  });

  it("requires cascades to a fixpoint", () => {
    // ATTACH_FILES → needs SEND_MESSAGES → needs VIEW_CHANNEL.
    // Grant ATTACH + SEND but not VIEW: SEND is gated, so ATTACH falls too.
    const perms = P.resolve([
      { allow: P.pack(["chat.SEND_MESSAGES", "chat.ATTACH_FILES"]) },
    ]);
    expect(P.has(perms, "chat.SEND_MESSAGES")).toBe(false);
    expect(P.has(perms, "chat.ATTACH_FILES")).toBe(false);
  });

  it("an empty layer set resolves to the empty bitfield (guest path)", () => {
    expect(P.resolve([])).toBe(0n);
    expect(P.resolve([{}])).toBe(0n);
  });
});
