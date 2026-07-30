import { definePermissions } from "../define";
import { P } from "./fixture";

describe("definePermissions — validation", () => {
  it("throws on a duplicate bit, naming both flags", () => {
    expect(() =>
      definePermissions({ a: { X: { bit: 1 }, Y: { bit: 1 } } }),
    ).toThrow(/bit 1 is used by both "a.X" and "a.Y"/);
  });

  it("throws on a non-integer or negative bit", () => {
    expect(() => definePermissions({ a: { X: { bit: -1 } } })).toThrow(/invalid bit/);
    expect(() => definePermissions({ a: { X: { bit: 1.5 } } })).toThrow(/invalid bit/);
  });

  it("throws on a dangling implies / requires reference", () => {
    expect(() =>
      definePermissions({ a: { X: { bit: 0, implies: ["a.NOPE"] } } }),
    ).toThrow(/implies unknown flag "a.NOPE"/);
    expect(() =>
      definePermissions({ a: { X: { bit: 0, requires: ["a.NOPE"] } } }),
    ).toThrow(/requires unknown flag "a.NOPE"/);
  });

  it("throws on an implies cycle", () => {
    expect(() =>
      definePermissions({
        a: { X: { bit: 0, implies: ["a.Y"] }, Y: { bit: 1, implies: ["a.X"] } },
      }),
    ).toThrow(/implies cycle/);
  });

  it("rejects a malformed module/member name", () => {
    expect(() => definePermissions({ "a-b": { X: { bit: 0 } } })).toThrow(
      /invalid flag name/,
    );
  });
});

describe("checks", () => {
  it("has() is typo-proof and reads a single bit", () => {
    const perms = P.from(["chat.VIEW_CHANNEL"]);
    expect(P.has(perms, "chat.VIEW_CHANNEL")).toBe(true);
    expect(P.has(perms, "chat.SEND_MESSAGES")).toBe(false);
  });

  it("hasAll / hasAny with vacuous edges", () => {
    const perms = P.from(["chat.VIEW_CHANNEL", "chat.SEND_MESSAGES"]);
    expect(P.hasAll(perms, ["chat.VIEW_CHANNEL", "chat.SEND_MESSAGES"])).toBe(true);
    expect(P.hasAll(perms, ["chat.VIEW_CHANNEL", "chat.ATTACH_FILES"])).toBe(false);
    expect(P.hasAll(perms, [])).toBe(true); // vacuous truth
    expect(P.hasAny(perms, ["chat.ATTACH_FILES", "chat.VIEW_CHANNEL"])).toBe(true);
    expect(P.hasAny(perms, ["chat.ATTACH_FILES"])).toBe(false);
    expect(P.hasAny(perms, [])).toBe(false); // vacuous falsity
  });

  it("list() returns declaration order, missing() the gaps", () => {
    const perms = P.from(["chat.SEND_MESSAGES", "chat.VIEW_CHANNEL"]);
    expect(P.list(perms)).toEqual(["chat.VIEW_CHANNEL", "chat.SEND_MESSAGES"]);
    expect(P.missing(perms, ["chat.VIEW_CHANNEL", "chat.ATTACH_FILES"])).toEqual([
      "chat.ATTACH_FILES",
    ]);
  });

  it("throws on an unknown flag at a check", () => {
    // @ts-expect-error — not a member of the tree
    expect(() => P.has(0n, "chat.NOPE")).toThrow(/unknown flag/);
  });

  it("exposes bit, mask, names, full, empty", () => {
    expect(P.bit("guild.ADMINISTRATOR")).toBe(63);
    expect(P.mask("chat.VIEW_CHANNEL")).toBe(1n);
    expect(P.empty).toBe(0n);
    expect(P.names).toContain("chat.SEND_MESSAGES");
    expect(P.full & P.mask("guild.ADMINISTRATOR")).not.toBe(0n);
  });
});

describe("pack vs from", () => {
  it("pack() is raw — no post-passes", () => {
    // MANAGE_MESSAGES implies SEND_MESSAGES, but pack applies nothing.
    const raw = P.pack(["chat.MANAGE_MESSAGES"]);
    expect(P.has(raw, "chat.SEND_MESSAGES")).toBe(false);
  });

  it("from() is effective — implies applied, requires gates", () => {
    // implies adds SEND_MESSAGES, but requires gates it off (no VIEW_CHANNEL).
    const gated = P.from(["chat.MANAGE_MESSAGES"]);
    expect(P.has(gated, "chat.SEND_MESSAGES")).toBe(false);

    // with VIEW_CHANNEL present, the implied SEND_MESSAGES survives.
    const ok = P.from(["chat.VIEW_CHANNEL", "chat.MANAGE_MESSAGES"]);
    expect(P.has(ok, "chat.SEND_MESSAGES")).toBe(true);
  });
});
