import { P, UNKNOWN_BIT } from "./fixture";

/**
 * §11.1 — no operation may mask a bitfield down to the known flag set. A service
 * on an older version reads a bitfield written by a newer one, and must carry the
 * bits it doesn't recognise through untouched, or it silently revokes
 * permissions a newer version granted. This is the invariant that makes one
 * permission set safe to share across projects that upgrade at different times.
 */
describe("unknown-bit preservation invariant", () => {
  const known = P.pack(["chat.VIEW_CHANNEL", "chat.MANAGE_MESSAGES"]);
  const withUnknown = known | UNKNOWN_BIT;

  it("has() reads known bits and is indifferent to unknown ones", () => {
    expect(P.has(withUnknown, "chat.VIEW_CHANNEL")).toBe(true);
  });

  it("list() skips unknown bits (no name to give them)", () => {
    expect(P.list(withUnknown)).toEqual([
      "chat.VIEW_CHANNEL",
      "chat.MANAGE_MESSAGES",
    ]);
  });

  it("set algebra carries unknown bits through", () => {
    expect(P.union(known, UNKNOWN_BIT) & UNKNOWN_BIT).not.toBe(0n);
    expect(P.subtract(withUnknown, known) & UNKNOWN_BIT).not.toBe(0n);
    expect(P.intersect(withUnknown, UNKNOWN_BIT)).toBe(UNKNOWN_BIT);
  });

  it("effective() preserves unknown bits, even through grantsAll", () => {
    const admin = P.pack(["guild.ADMINISTRATOR"]) | UNKNOWN_BIT;
    const eff = P.effective(admin);
    // grantsAll expanded to the full known mask...
    expect(eff & P.full).toBe(P.full);
    // ...without dropping the unknown bit the actor already held
    expect(eff & UNKNOWN_BIT).not.toBe(0n);
  });

  it("resolve() carries unknown bits set by a layer", () => {
    const eff = P.resolve([{ allow: withUnknown }]);
    expect(eff & UNKNOWN_BIT).not.toBe(0n);
  });
});
