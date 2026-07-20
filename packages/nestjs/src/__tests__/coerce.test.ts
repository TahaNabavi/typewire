import { z } from "zod";
import { coerceInput } from "../validation/coerce";

describe("coerceInput (query mode)", () => {
  it("coerces numeric strings for z.number()", () => {
    expect(coerceInput(z.number(), "25", "query")).toBe(25);
    expect(coerceInput(z.number(), "-1.5", "query")).toBe(-1.5);
  });

  it("leaves non-numeric strings for Zod to report", () => {
    expect(coerceInput(z.number(), "abc", "query")).toBe("abc");
    expect(coerceInput(z.number(), "", "query")).toBe("");
  });

  it('coerces "true"/"false" for z.boolean(), nothing else', () => {
    expect(coerceInput(z.boolean(), "true", "query")).toBe(true);
    expect(coerceInput(z.boolean(), "false", "query")).toBe(false);
    expect(coerceInput(z.boolean(), "1", "query")).toBe("1");
  });

  it("wraps single values for array schemas and coerces elements", () => {
    // one occurrence of a repeated query key arrives as a lone string
    expect(coerceInput(z.array(z.number()), "5", "query")).toEqual([5]);
    expect(coerceInput(z.array(z.number()), ["1", "2"], "query")).toEqual([1, 2]);
    expect(coerceInput(z.array(z.string()), "a", "query")).toEqual(["a"]);
  });

  it("parses ISO strings for z.date()", () => {
    const iso = "2026-01-15T10:30:00.000Z";
    const result = coerceInput(z.date(), iso, "query");
    expect(result).toBeInstanceOf(Date);
    expect((result as Date).toISOString()).toBe(iso);
  });

  it("JSON-parses nested objects (client JSON.stringify-s them) and revives dates inside", () => {
    const schema = z.object({ a: z.number(), when: z.date() });
    const wire = JSON.stringify({ a: 1, when: "2026-01-01T00:00:00.000Z" });
    const result = coerceInput(schema, wire, "query") as any;
    expect(result.a).toBe(1);
    expect(result.when).toBeInstanceOf(Date);
  });

  it("JSON-parses records and coerces values", () => {
    const schema = z.record(z.string(), z.date());
    const wire = JSON.stringify({ start: "2026-01-01T00:00:00.000Z" });
    const result = coerceInput(schema, wire, "query") as any;
    expect(result.start).toBeInstanceOf(Date);
  });

  it("unwraps optional/nullable/default wrappers", () => {
    expect(coerceInput(z.number().optional(), "3", "query")).toBe(3);
    expect(coerceInput(z.number().nullable(), "3", "query")).toBe(3);
    expect(coerceInput(z.number().default(1), "4", "query")).toBe(4);
  });

  it("tries union members until one validates", () => {
    const schema = z.union([z.number(), z.boolean()]);
    expect(coerceInput(schema, "5", "query")).toBe(5);
    expect(coerceInput(schema, "true", "query")).toBe(true);
  });

  it("coerces toward matching literals", () => {
    expect(coerceInput(z.literal(5), "5", "query")).toBe(5);
    expect(coerceInput(z.literal(true), "true", "query")).toBe(true);
    expect(coerceInput(z.literal("on"), "on", "query")).toBe("on");
  });

  it("coerces bigint strings", () => {
    expect(coerceInput(z.bigint(), "9007199254740993", "query")).toBe(
      9007199254740993n,
    );
  });

  it("coerces object fields of a top-level part record", () => {
    // path/query parts are records of raw strings
    const schema = z.object({ id: z.string(), page: z.number() });
    const result = coerceInput(schema, { id: "u1", page: "2" }, "query") as any;
    expect(result).toEqual({ id: "u1", page: 2 });
  });

  it("never throws on malformed input", () => {
    const schema = z.object({ a: z.number() });
    expect(coerceInput(schema, "{not json", "query")).toBe("{not json");
    expect(coerceInput(z.bigint(), "nope", "query")).toBe("nope");
  });
});

describe("coerceInput (json mode)", () => {
  it("does not touch numbers/booleans (JSON preserves them)", () => {
    expect(coerceInput(z.number(), "5", "json")).toBe("5");
    expect(coerceInput(z.boolean(), "true", "json")).toBe("true");
  });

  it("revives ISO strings for z.date() (JSON cannot carry dates)", () => {
    const schema = z.object({ createdAt: z.date() });
    const result = coerceInput(
      schema,
      { createdAt: "2026-06-30T12:00:00.000Z" },
      "json",
    ) as any;
    expect(result.createdAt).toBeInstanceOf(Date);
  });

  it("recurses through nested structures", () => {
    const schema = z.object({
      items: z.array(z.object({ at: z.date() })),
    });
    const result = coerceInput(
      schema,
      { items: [{ at: "2026-01-01T00:00:00.000Z" }] },
      "json",
    ) as any;
    expect(result.items[0].at).toBeInstanceOf(Date);
  });
});
