import { buildQueryKey, hashKey } from "../hash-key";
import { resolveSourceId } from "../source";
import { makeEndpoint, makeEvent } from "./helpers";

describe("hashKey", () => {
  it("hashes objects that differ only in key order identically", () => {
    expect(hashKey({ a: 1, b: 2 })).toBe(hashKey({ b: 2, a: 1 }));
  });

  it("sorts nested object keys too", () => {
    expect(hashKey({ outer: { a: 1, b: 2 } })).toBe(
      hashKey({ outer: { b: 2, a: 1 } }),
    );
  });

  it("keeps array order significant", () => {
    expect(hashKey([1, 2])).not.toBe(hashKey([2, 1]));
  });

  it("distinguishes different values", () => {
    expect(hashKey({ id: "1" })).not.toBe(hashKey({ id: "2" }));
  });

  it("handles undefined and null input", () => {
    expect(hashKey(undefined)).toBe(hashKey(undefined));
    expect(hashKey(null)).not.toBe(hashKey(undefined));
  });
});

describe("buildQueryKey", () => {
  it("namespaces by endpoint id", () => {
    expect(buildQueryKey("user.getUser", { id: "1" })).not.toBe(
      buildQueryKey("user.listUsers", { id: "1" }),
    );
  });

  it("is stable for equivalent input", () => {
    expect(buildQueryKey("user.getUser", { a: 1, b: 2 })).toBe(
      buildQueryKey("user.getUser", { b: 2, a: 1 }),
    );
  });
});

describe("resolveSourceId", () => {
  it("reads typefetch's endpointId", () => {
    const endpoint = makeEndpoint("user.getUser", async () => 1);
    expect(resolveSourceId(endpoint)).toBe("user.getUser");
  });

  it("reads typesocket's eventId", () => {
    const event = makeEvent("chat.sendMessage", async () => 1);
    expect(resolveSourceId(event)).toBe("chat.sendMessage");
  });

  it("throws a useful error for a bare function", () => {
    const bare = (async () => 1) as never;
    expect(() => resolveSourceId(bare)).toThrow(/endpointId.*eventId/s);
  });
});
