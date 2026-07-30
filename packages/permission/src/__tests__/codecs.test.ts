import { P, UNKNOWN_BIT } from "./fixture";

const sample = P.pack([
  "chat.VIEW_CHANNEL",
  "chat.MANAGE_MESSAGES",
  "guild.ADMINISTRATOR", // bit 63 — keeps BigInt honest across the 32-bit line
]);

describe("codecs — lossless roundtrips", () => {
  it.each(["decimal", "hex", "base64url", "chunks"] as const)(
    "%s roundtrips exactly",
    (codec) => {
      expect(P.decode(P.encode(sample, codec), codec)).toBe(sample);
    },
  );

  it("roundtrips the empty set", () => {
    expect(P.encode(0n, "base64url")).toBe("");
    expect(P.decode("", "base64url")).toBe(0n);
    expect(P.decode(P.encode(0n, "chunks"), "chunks")).toBe(0n);
    expect(P.decode(P.encode(0n, "decimal"), "decimal")).toBe(0n);
  });

  it("decimal / hex have the expected shape", () => {
    expect(P.encode(5n, "decimal")).toBe("5");
    expect(P.encode(255n, "hex")).toBe("0xff");
    expect(P.decode("0xff", "hex")).toBe(255n);
  });
});

describe("codecs — unknown-bit preservation (§11.1)", () => {
  const withUnknown = sample | UNKNOWN_BIT;

  it.each(["decimal", "hex", "base64url", "chunks"] as const)(
    "%s carries an unknown (newer-version) bit through",
    (codec) => {
      const back = P.decode(P.encode(withUnknown, codec), codec);
      expect(back).toBe(withUnknown);
      expect(back & UNKNOWN_BIT).not.toBe(0n);
    },
  );
});

describe("codecs — human-readable (lossy for unknown bits, by design)", () => {
  it("names lists known flags and drops unknown bits", () => {
    const encoded = P.encode(sample | UNKNOWN_BIT, "names");
    expect(encoded).toEqual([
      "chat.VIEW_CHANNEL",
      "chat.MANAGE_MESSAGES",
      "guild.ADMINISTRATOR",
    ]);
    // decode ignores unrecognised names rather than throwing
    expect(P.decode([...encoded, "chat.NOPE"], "names")).toBe(sample);
  });

  it("grouped nests members under their module", () => {
    const g = P.encode(sample, "grouped");
    expect(g).toEqual({
      chat: ["VIEW_CHANNEL", "MANAGE_MESSAGES"],
      guild: ["ADMINISTRATOR"],
    });
    expect(P.decode(g, "grouped")).toBe(sample);
  });
});

describe("codecs — errors", () => {
  it("rejects a negative bitfield on base64url", () => {
    expect(() => P.encode(-1n, "base64url")).toThrow(/negative/);
  });
});
