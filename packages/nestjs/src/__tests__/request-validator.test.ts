import { makeRequestSchema } from "@tahanabavi/typefetch";
import type { EndpointDefZ } from "@tahanabavi/typefetch";
import { z } from "zod";
import { ContractValidationException } from "../exceptions";
import { validateRequest } from "../validation/request-validator";

const emptyRaw = { params: {}, query: {}, body: undefined, headers: {} };

describe("validateRequest — structured contracts", () => {
  const getUser: EndpointDefZ = {
    method: "GET",
    path: "/users/:id",
    request: makeRequestSchema<
      { id: z.ZodString },
      { verbose: z.ZodOptional<z.ZodBoolean> }
    >()({
      path: z.object({ id: z.string() }),
      query: z.object({ verbose: z.boolean().optional() }),
    }),
    response: z.object({ id: z.string(), name: z.string() }),
  };

  it("validates and coerces path/query built by makeRequestSchema", () => {
    const parsed = validateRequest(
      getUser,
      {
        ...emptyRaw,
        params: { id: "u1" },
        query: { verbose: "true" },
        headers: { host: "localhost" },
      },
      { coerce: true },
    );

    expect(parsed.isStructured).toBe(true);
    expect(parsed.path).toEqual({ id: "u1" });
    expect(parsed.query).toEqual({ verbose: true });
    expect((parsed.input as any).path).toEqual({ id: "u1" });
    expect((parsed.input as any).query).toEqual({ verbose: true });
  });

  it("accepts the platform's empty-object body when the contract has no body", () => {
    // express.json() sets req.body = {} when nothing was sent
    const parsed = validateRequest(
      getUser,
      { ...emptyRaw, params: { id: "u1" }, body: {} },
      { coerce: true },
    );
    expect(parsed.body).toBeUndefined();
  });

  it("collects issues from every part into one 400", () => {
    const createUser: EndpointDefZ = {
      method: "POST",
      path: "/users/:org",
      request: z.object({
        path: z.object({ org: z.string().min(3) }),
        body: z.object({ name: z.string().min(2), age: z.number().int() }),
      }),
      response: z.object({ id: z.string() }),
    };

    try {
      validateRequest(
        createUser,
        { ...emptyRaw, params: { org: "x" }, body: { name: "a", age: 1.5 } },
        { coerce: true },
      );
      fail("expected ContractValidationException");
    } catch (err) {
      expect(err).toBeInstanceOf(ContractValidationException);
      const errors = (err as ContractValidationException).errors;
      expect(Object.keys(errors).sort()).toEqual([
        "body.age",
        "body.name",
        "path.org",
      ]);
    }
  });

  it("strips body fields the contract does not declare", () => {
    const create: EndpointDefZ = {
      method: "POST",
      path: "/things",
      request: z.object({ body: z.object({ name: z.string() }) }),
      response: z.object({ id: z.string() }),
    };
    const parsed = validateRequest(
      create,
      { ...emptyRaw, body: { name: "ok", evil: "field" } },
      { coerce: true },
    );
    expect(parsed.body).toEqual({ name: "ok" });
  });

  it("matches declared header keys case-insensitively", () => {
    const withHeaders: EndpointDefZ = {
      method: "GET",
      path: "/tenant",
      request: z.object({
        headers: z.object({ "X-Tenant": z.string() }),
      }),
      response: z.object({ ok: z.boolean() }),
    };

    // Node lowercases incoming header names
    const parsed = validateRequest(
      withHeaders,
      { ...emptyRaw, headers: { "x-tenant": "main", host: "localhost" } },
      { coerce: true },
    );
    expect(parsed.headers).toEqual({ "X-Tenant": "main" });

    expect(() =>
      validateRequest(withHeaders, emptyRaw, { coerce: true }),
    ).toThrow(ContractValidationException);
  });

  it("respects coerce: false", () => {
    expect(() =>
      validateRequest(
        getUser,
        { ...emptyRaw, params: { id: "u1" }, query: { verbose: "true" } },
        { coerce: false },
      ),
    ).toThrow(ContractValidationException);
  });
});

describe("validateRequest — flat contracts", () => {
  const flat: EndpointDefZ = {
    method: "POST",
    path: "/notes",
    request: z.object({ title: z.string(), at: z.date().optional() }),
    response: z.object({ ok: z.literal(true) }),
  };

  it("validates the whole schema against the body (client sends flat input as body)", () => {
    const parsed = validateRequest(
      flat,
      { ...emptyRaw, body: { title: "hi", at: "2026-02-01T00:00:00.000Z" } },
      { coerce: true },
    );
    expect(parsed.isStructured).toBe(false);
    expect((parsed.input as any).title).toBe("hi");
    expect((parsed.input as any).at).toBeInstanceOf(Date);
  });

  it("prefixes flat issues with body.", () => {
    try {
      validateRequest(flat, { ...emptyRaw, body: {} }, { coerce: true });
      fail("expected ContractValidationException");
    } catch (err) {
      const errors = (err as ContractValidationException).errors;
      expect(Object.keys(errors)).toEqual(["body.title"]);
    }
  });
});
