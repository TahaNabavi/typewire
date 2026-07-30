import { definePermissions } from "../define";
import { P } from "./fixture";

describe("buildLock", () => {
  it("emits a flat name→bit manifest, flagging deprecated entries", () => {
    const lock = P.buildLock(3);
    expect(lock.version).toBe(3);
    expect(lock.flags["chat.VIEW_CHANNEL"]).toEqual({ bit: 0 });
    expect(lock.flags["chat.LEGACY_TTS"]).toEqual({ bit: 4, deprecated: true });
    // hidden flags are still in the lock (they're enforced, just off the UI)
    expect(lock.flags["guild.SECRET_OPS"]).toEqual({ bit: 10 });
  });
});

describe("diffLock", () => {
  const base = P.buildLock();

  it("passes when nothing changed", () => {
    expect(P.diffLock(base)).toEqual([]);
  });

  it("flags a bit that changed meaning (reused)", () => {
    const next = definePermissions({
      chat: { PIN_MESSAGES: { bit: 2 } }, // bit 2 was chat.MANAGE_MESSAGES
    });
    expect(next.diffLock(base)).toContainEqual({
      kind: "bit-reused",
      bit: 2,
      was: "chat.MANAGE_MESSAGES",
      now: "chat.PIN_MESSAGES",
    });
  });

  it("flags a flag that moved bit (bit-changed)", () => {
    const next = definePermissions({
      chat: { VIEW_CHANNEL: { bit: 7 } }, // was bit 0
    });
    expect(next.diffLock(base)).toContainEqual({
      kind: "bit-changed",
      name: "chat.VIEW_CHANNEL",
      was: 0,
      now: 7,
    });
  });

  it("flags a flag that vanished and freed its bit (removed)", () => {
    const smaller = definePermissions({
      chat: { VIEW_CHANNEL: { bit: 0 } },
    });
    const removed = smaller.diffLock(base).filter((v) => v.kind === "removed");
    expect(removed).toContainEqual({
      kind: "removed",
      name: "chat.SEND_MESSAGES",
      bit: 1,
    });
  });
});
