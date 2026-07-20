import type { EndpointDefZ } from "@tahanabavi/typefetch";
import { z } from "zod";
import { ContractValidationException } from "../exceptions";
import { validateRequest } from "../validation/request-validator";

const fakeFile = (name: string) => ({
  fieldname: name,
  originalname: `${name}.png`,
  mimetype: "image/png",
  size: 10,
  buffer: Buffer.from("x"),
});

const base = { params: {}, query: {}, headers: {} };

const uploadAvatar: EndpointDefZ = {
  method: "POST",
  path: "/users/:id/avatar",
  bodyType: "form-data",
  request: z.object({
    path: z.object({ id: z.string() }),
    body: z.object({
      file: z.instanceof(Uint8Array), // z.instanceof(File) equivalent on Node
      caption: z.string().optional(),
      priority: z.number().int(),
      published: z.boolean(),
    }),
  }),
  response: z.object({ ok: z.boolean() }),
};

describe("form-data body validation", () => {
  it("passes the uploaded file through and coerces text fields like query params", () => {
    const parsed = validateRequest(
      uploadAvatar,
      {
        ...base,
        params: { id: "u1" },
        // multipart text fields arrive as strings
        body: { caption: "hi", priority: "5", published: "true" },
        files: { file: fakeFile("file") },
      },
      { coerce: true },
    );

    const body = parsed.body as any;
    expect(body.file).toEqual(fakeFile("file")); // passed through untouched
    expect(body.caption).toBe("hi");
    expect(body.priority).toBe(5); // "5" -> 5
    expect(body.published).toBe(true); // "true" -> true
    expect((parsed.input as any).body.priority).toBe(5);
  });

  it("does not fail just because the file isn't a browser File", () => {
    // the Multer file object is not `instanceof File`; validation must not
    // run that browser-only check server-side
    expect(() =>
      validateRequest(
        uploadAvatar,
        {
          ...base,
          params: { id: "u1" },
          body: { priority: "1", published: "false" },
          files: { file: fakeFile("file") },
        },
        { coerce: true },
      ),
    ).not.toThrow();
  });

  it("reports a missing required file", () => {
    try {
      validateRequest(
        uploadAvatar,
        {
          ...base,
          params: { id: "u1" },
          body: { priority: "1", published: "true" },
          files: {},
        },
        { coerce: true },
      );
      fail("expected ContractValidationException");
    } catch (err) {
      expect(err).toBeInstanceOf(ContractValidationException);
      expect((err as ContractValidationException).errors["body.file"]).toEqual([
        "Expected an uploaded file",
      ]);
    }
  });

  it("collects text-field errors alongside file checks", () => {
    try {
      validateRequest(
        uploadAvatar,
        {
          ...base,
          params: { id: "u1" },
          body: { priority: "notint", published: "true" },
          files: {}, // missing file too
        },
        { coerce: true },
      );
      fail("expected ContractValidationException");
    } catch (err) {
      const errors = (err as ContractValidationException).errors;
      expect(Object.keys(errors).sort()).toEqual([
        "body.file",
        "body.priority",
      ]);
    }
  });

  it("strips form fields the contract does not declare", () => {
    const parsed = validateRequest(
      uploadAvatar,
      {
        ...base,
        params: { id: "u1" },
        body: { priority: "1", published: "true", sneaky: "nope" },
        files: { file: fakeFile("file") },
      },
      { coerce: true },
    );
    expect(parsed.body).not.toHaveProperty("sneaky");
  });

  it("supports array-of-files fields and wraps a single upload", () => {
    const gallery: EndpointDefZ = {
      method: "POST",
      path: "/gallery",
      bodyType: "form-data",
      request: z.object({
        body: z.object({ photos: z.array(z.instanceof(Uint8Array)) }),
      }),
      response: z.object({ count: z.number() }),
    };

    const one = validateRequest(
      gallery,
      { ...base, body: {}, files: { photos: fakeFile("photos") } },
      { coerce: true },
    );
    expect(Array.isArray((one.body as any).photos)).toBe(true);
    expect((one.body as any).photos).toHaveLength(1);

    const many = validateRequest(
      gallery,
      {
        ...base,
        body: {},
        files: { photos: [fakeFile("photos"), fakeFile("photos")] },
      },
      { coerce: true },
    );
    expect((many.body as any).photos).toHaveLength(2);
  });

  it("treats an optional file as not required", () => {
    const optional: EndpointDefZ = {
      method: "POST",
      path: "/opt",
      bodyType: "form-data",
      request: z.object({
        body: z.object({ file: z.instanceof(Uint8Array).optional() }),
      }),
      response: z.object({ ok: z.boolean() }),
    };
    const parsed = validateRequest(
      optional,
      { ...base, body: {}, files: {} },
      { coerce: true },
    );
    expect(parsed.body).toEqual({});
  });
});
