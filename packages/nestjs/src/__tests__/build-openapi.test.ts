import type { Contracts } from "@tahanabavi/typefetch";
import { z } from "zod";
import { buildOpenApiDocument, toOpenApiPath } from "../openapi/build-openapi";

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({
        path: z.object({ id: z.string() }),
        query: z
          .object({
            verbose: z.boolean().optional(),
            tags: z.array(z.string()).optional(),
            from: z.date().optional(),
          })
          .optional(),
      }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    createUser: {
      method: "POST",
      path: "/users",
      auth: true,
      request: z.object({
        body: z.object({ name: z.string().min(2), age: z.number().int() }),
      }),
      response: z.object({ id: z.string(), name: z.string() }),
    },
    uploadAvatar: {
      method: "POST",
      path: "/users/:id/avatar",
      bodyType: "form-data",
      request: z.object({
        path: z.object({ id: z.string() }),
        body: z.object({ file: z.instanceof(Uint8Array) }),
      }),
      response: z.object({ uploaded: z.boolean() }),
    },
  },
  notes: {
    // flat request schema
    create: {
      method: "POST",
      path: "/notes",
      request: z.object({ title: z.string() }),
      response: z.object({ ok: z.literal(true) }),
    },
  },
} as const satisfies Contracts;

describe("toOpenApiPath", () => {
  it("converts :params to {params}", () => {
    expect(toOpenApiPath("/users/:id")).toBe("/users/{id}");
    expect(toOpenApiPath("/a/:x/b/:yId")).toBe("/a/{x}/b/{yId}");
    expect(toOpenApiPath("/static")).toBe("/static");
  });
});

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument(contracts, {
    info: { title: "Test API", version: "2.0.0" },
    servers: [{ url: "https://api.example.com" }],
  });

  it("emits document metadata", () => {
    expect(doc.openapi).toBe("3.0.3");
    expect(doc.info).toEqual({ title: "Test API", version: "2.0.0" });
    expect(doc.servers).toEqual([{ url: "https://api.example.com" }]);
    expect(doc.tags).toEqual(
      expect.arrayContaining([{ name: "user" }, { name: "notes" }]),
    );
  });

  it("maps method + path from the contract (with param templating)", () => {
    expect(doc.paths["/users/{id}"].get).toBeDefined();
    expect(doc.paths["/users"].post).toBeDefined();
    expect(doc.paths["/notes"].post).toBeDefined();
  });

  it("derives path + query parameters with correct requiredness", () => {
    const params = doc.paths["/users/{id}"].get!.parameters!;
    const id = params.find((p) => p.name === "id")!;
    expect(id.in).toBe("path");
    expect(id.required).toBe(true);
    expect(id.schema.type).toBe("string");

    const verbose = params.find((p) => p.name === "verbose")!;
    expect(verbose.in).toBe("query");
    expect(verbose.required).toBe(false);
    expect(verbose.schema.type).toBe("boolean");
  });

  it("marks array query params as explode/form (repeated keys)", () => {
    const tags = doc.paths["/users/{id}"].get!.parameters!.find(
      (p) => p.name === "tags",
    )!;
    expect(tags.schema.type).toBe("array");
    expect(tags.explode).toBe(true);
    expect(tags.style).toBe("form");
  });

  it("represents z.date() as string/date-time (no throw)", () => {
    const from = doc.paths["/users/{id}"].get!.parameters!.find(
      (p) => p.name === "from",
    )!;
    expect(from.schema).toMatchObject({ type: "string", format: "date-time" });
  });

  it("builds a JSON request body for structured POST", () => {
    const op = doc.paths["/users"].post!;
    const schema = op.requestBody!.content["application/json"].schema;
    expect(op.requestBody!.required).toBe(true);
    expect(schema.type).toBe("object");
    expect(Object.keys(schema.properties)).toEqual(["name", "age"]);
    expect(schema.required).toEqual(expect.arrayContaining(["name", "age"]));
  });

  it("uses multipart/form-data + binary for form-data endpoints", () => {
    const op = doc.paths["/users/{id}/avatar"].post!;
    const media = op.requestBody!.content["multipart/form-data"];
    expect(media).toBeDefined();
    expect(media.schema.properties.file).toMatchObject({
      type: "string",
      format: "binary",
    });
  });

  it("treats a flat request schema as the JSON body", () => {
    const op = doc.paths["/notes"].post!;
    expect(op.parameters).toBeUndefined();
    const schema = op.requestBody!.content["application/json"].schema;
    expect(schema.properties.title.type).toBe("string");
  });

  it("documents success status (201 POST, 200 GET) and response schema", () => {
    expect(doc.paths["/users/{id}"].get!.responses["200"]).toBeDefined();
    const created = doc.paths["/users"].post!.responses["201"];
    expect(
      created.content!["application/json"].schema.properties.id.type,
    ).toBe("string");
  });

  it("adds a 400 validation-error response referencing the shared schema", () => {
    const resp = doc.paths["/users/{id}"].get!.responses["400"];
    expect(resp.content!["application/json"].schema.$ref).toBe(
      "#/components/schemas/ContractValidationError",
    );
    expect(doc.components!.schemas!.ContractValidationError).toBeDefined();
  });

  it("wires bearer security + 401 for auth endpoints only", () => {
    const create = doc.paths["/users"].post!;
    expect(create.security).toEqual([{ bearerAuth: [] }]);
    expect(create.responses["401"]).toBeDefined();
    expect(doc.components!.securitySchemes!.bearerAuth).toEqual({
      type: "http",
      scheme: "bearer",
    });

    const getUser = doc.paths["/users/{id}"].get!;
    expect(getUser.security).toBeUndefined();
    expect(getUser.responses["401"]).toBeUndefined();
  });

  it("honors options: bearerAuth off, custom success status, no 400", () => {
    const bare = buildOpenApiDocument(contracts, {
      bearerAuth: false,
      includeValidationError: false,
      successStatus: () => 200,
    });
    expect(bare.paths["/users"].post!.security).toBeUndefined();
    expect(bare.paths["/users"].post!.responses["200"]).toBeDefined();
    expect(bare.paths["/users"].post!.responses["201"]).toBeUndefined();
    expect(bare.paths["/users/{id}"].get!.responses["400"]).toBeUndefined();
    expect(bare.components?.securitySchemes).toBeUndefined();
  });

  it("defaults info to API / 1.0.0", () => {
    const d = buildOpenApiDocument(contracts);
    expect(d.info).toEqual({ title: "API", version: "1.0.0" });
  });
});
