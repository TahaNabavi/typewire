import { resolveEnvelope } from "../envelope/resolve";

describe("resolveEnvelope", () => {
  it("returns null when disabled", () => {
    expect(resolveEnvelope(false)).toBeNull();
  });

  it("returns defaults for true / undefined", () => {
    for (const setting of [true, undefined] as const) {
      const env = resolveEnvelope(setting)!;
      expect(env.success({ id: 1 })).toEqual({ success: true, data: { id: 1 } });
      expect(env.errorStatus).toBe("preserve");
      expect(
        env.error({ message: "nope", status: 400, code: "X", errors: { a: ["b"] } }),
      ).toEqual({ success: false, message: "nope", code: "X", errors: { a: ["b"] } });
    }
  });

  it("omits code/errors from the default error envelope when absent", () => {
    const env = resolveEnvelope(true)!;
    expect(env.error({ message: "boom", status: 500 })).toEqual({
      success: false,
      message: "boom",
    });
  });

  it("applies success/error/errorStatus overrides", () => {
    const env = resolveEnvelope({
      success: (data) => ({ ok: true, result: data }),
      error: (e) => ({ ok: false, reason: e.message }),
      errorStatus: 200,
    })!;
    expect(env.success(5)).toEqual({ ok: true, result: 5 });
    expect(env.error({ message: "x", status: 404 })).toEqual({
      ok: false,
      reason: "x",
    });
    expect(env.errorStatus).toBe(200);
  });
});
