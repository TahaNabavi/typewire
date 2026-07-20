import { z } from "zod";
import { ApiClient } from "../client";
import type { Contracts } from "../types";
import { TypeFetchTestContext } from "../modules/tester/context";
import { generateInput } from "../modules/tester/generate-input";
import { createMarkdownReport, createHtmlReport } from "../modules/tester/reporter";
import { createApiTestRunner } from "../modules/tester/runner";

/**
 * Put this file next to the testing module, for example:
 *
 *   src/testing/testing-feature.test.ts
 *
 * Expected relative imports from that location:
 *   ./context
 *   ./generate-input
 *   ./reporter
 *   ./runner
 *   ../client
 *   ../types
 */

global.fetch = jest.fn();

const fetchMock = fetch as jest.MockedFunction<typeof fetch>;

function jsonResponse(body: unknown, init?: Partial<Response>): Response {
  return {
    ok: init?.ok ?? true,
    status: init?.status ?? 200,
    statusText: init?.statusText ?? "OK",
    json: async () => body,
  } as Response;
}

const userResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().optional(),
});

type UserResponse = z.infer<typeof userResponseSchema>;

const contracts = {
  user: {
    listUsers: {
      method: "GET",
      path: "/users",
      request: z.object({
        query: z
          .object({
            page: z.number().optional(),
            active: z.boolean().optional(),
          })
          .optional(),
      }),
      response: z.array(userResponseSchema),
      mockData: [{ id: "mock-user-1", name: "Mock User" }],
      test: {
        tags: ["user", "smoke"],
        input: {
          query: {
            page: 1,
            active: true,
          },
        },
      },
    },

    createUser: {
      method: "POST",
      path: "/users",
      request: z.object({
        body: z.object({
          name: z.string().min(3),
          email: z.string().email(),
        }),
      }),
      response: userResponseSchema,
      mockData: { id: "mock-created-user", name: "Created User", email: "created@example.com" },
      test: {
        tags: ["user", "write"],
        cases: [
          {
            name: "create valid user",
            input: {
              body: {
                name: "Taha Nabavi",
                email: "taha@example.com",
              },
            },
            expect: ({ response, ctx }) => {
              const createdUser = response as UserResponse;

              ctx.set("createdUserId", createdUser.id);
              expect(createdUser.name).toBeTruthy();
            },
          },
        ],
      },
    },

    getUserById: {
      method: "GET",
      path: "/users/:id",
      request: z.object({
        path: z.object({
          id: z.string(),
        }),
      }),
      response: userResponseSchema,
      test: {
        tags: ["user", "smoke"],
        input: (ctx) => ({
          path: {
            id: (ctx.get("createdUserId") as string | undefined) ?? "user-1",
          },
        }),
      },
    },

    uploadAvatar: {
      method: "POST",
      path: "/users/:id/avatar",
      bodyType: "form-data",
      request: z.object({
        path: z.object({
          id: z.string(),
        }),
        body: z.object({
          file: z.any(),
          alt: z.string().optional(),
        }),
      }),
      response: z.object({
        uploaded: z.boolean(),
      }),
      test: {
        tags: ["user", "upload"],
        input: {
          path: { id: "user-1" },
          body: {
            file: "fake-file-content",
            alt: "Avatar",
          },
        },
      },
    },

    deleteUser: {
      method: "DELETE",
      path: "/users/:id",
      request: z.object({
        path: z.object({
          id: z.string(),
        }),
      }),
      response: z.object({ deleted: z.boolean() }),
      test: {
        tags: ["user", "danger"],
        destructive: true,
        input: {
          path: { id: "user-1" },
        },
      },
    },

    disabledEndpoint: {
      method: "GET",
      path: "/disabled",
      request: z.object({}),
      response: z.object({ ok: z.boolean() }),
      test: {
        enabled: false,
      },
    },

    notFoundExpected: {
      method: "GET",
      path: "/users/missing",
      request: z.object({}),
      response: userResponseSchema,
      test: {
        tags: ["user", "negative"],
        cases: [
          {
            name: "404 is expected",
            input: {},
            expectStatus: 404,
          },
        ],
      },
    },
  },

  admin: {
    getSecret: {
      method: "GET",
      path: "/admin/secret",
      auth: true,
      request: z.object({}),
      response: z.object({ secret: z.string() }),
      mockData: { secret: "mock-secret" },
      test: {
        tags: ["admin"],
      },
    },
  },
} satisfies Contracts;

describe("TypeFetch testing feature", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("TypeFetchTestContext", () => {
    it("stores and reads shared values between endpoint tests", () => {
      const ctx = new TypeFetchTestContext({ userId: "initial-user" });

      expect(ctx.get("userId")).toBe("initial-user");
      expect(ctx.has("userId")).toBe(true);
      expect(ctx.has("missing")).toBe(false);

      ctx.set("createdUserId", "created-user");

      expect(ctx.get("createdUserId")).toBe("created-user");
      expect(ctx.data).toEqual({
        userId: "initial-user",
        createdUserId: "created-user",
      });
    });
  });

  describe("generateInput", () => {
    it("generates valid input from common Zod schemas", () => {
      const schema = z.object({
        path: z.object({
          id: z.string(),
        }),
        query: z.object({
          page: z.number().min(1),
          active: z.boolean(),
          tags: z.array(z.string()),
          sort: z.enum(["newest", "oldest"]),
        }),
        body: z.object({
          name: z.string().min(12),
          email: z.string().email(),
          website: z.string().url().optional(),
        }),
      });

      const input = generateInput(schema);

      expect(schema.parse(input)).toEqual({
        path: {
          id: "1",
        },
        query: {
          page: 1,
          active: true,
          tags: ["test-string"],
          sort: "newest",
        },
        body: {
          name: "Test Namexxx",
          email: "test@example.com",
          website: "https://example.com",
        },
      });
    });

    it("supports overrides by full path, short path, and field name", () => {
      const schema = z.object({
        path: z.object({
          id: z.string(),
        }),
        body: z.object({
          name: z.string(),
          email: z.string().email(),
        }),
      });

      const input = generateInput(schema, {
        values: {
          "path.id": "user-override",
          name: "Custom Name",
          "body.email": "custom@example.com",
        },
      });

      expect(schema.parse(input)).toEqual({
        path: { id: "user-override" },
        body: {
          name: "Custom Name",
          email: "custom@example.com",
        },
      });
    });

    it("can exclude optional fields", () => {
      const schema = z.object({
        body: z.object({
          required: z.string(),
          optional: z.string().optional(),
        }),
      });

      const input = generateInput(schema, { includeOptional: false });

      expect(input).toEqual({
        body: {
          required: "test-string",
        },
      });
      expect(schema.parse(input)).toEqual(input);
    });

    it("uses fileFactory for file-like fields", () => {
      const fileValue = { fixture: "avatar.png" };
      const schema = z.object({
        body: z.object({
          file: z.any(),
          avatar: z.any(),
        }),
      });

      const input = generateInput(schema, {
        fileFactory: () => fileValue,
      });

      expect(input).toEqual({
        body: {
          file: fileValue,
          avatar: fileValue,
        },
      });
    });
  });

  describe("createApiTestRunner - schema and mock modes", () => {
    it("runs schema mode without calling network", async () => {
      const client = new ApiClient({ baseUrl: "https://api.test.com" }, contracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts,
        options: {
          mode: "schema",
        },
        context: {
          createdUserId: "ctx-user-1",
        },
      }).run();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(report.mode).toBe("schema");
      expect(report.summary.failed).toBe(0);
      expect(report.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            module: "user",
            endpoint: "getUserById",
            phase: "schema",
            status: "passed",
            input: { path: { id: "ctx-user-1" } },
          }),
          expect.objectContaining({
            endpoint: "deleteUser",
            status: "skipped",
            skipReason: "Destructive endpoint skipped",
          }),
          expect.objectContaining({
            endpoint: "disabledEndpoint",
            status: "skipped",
            skipReason: "Endpoint tests disabled",
          }),
        ]),
      );
    });

    it("runs mock mode and validates mockData with endpoint response schema", async () => {
      const client = new ApiClient({ baseUrl: "https://api.test.com" }, contracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts,
        options: {
          mode: "mock",
          includeTags: ["admin"],
        },
      }).run();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(report.summary.failed).toBe(0);
      expect(report.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            module: "admin",
            endpoint: "getSecret",
            phase: "mock",
            status: "passed",
            response: { secret: "mock-secret" },
          }),
          expect.objectContaining({
            module: "user",
            endpoint: "listUsers",
            status: "skipped",
            skipReason: "Endpoint does not match includeTags",
          }),
        ]),
      );
    });

    it("reports mock validation errors as failed results", async () => {
      const invalidMockContracts = {
        user: {
          brokenMock: {
            method: "GET",
            path: "/broken-mock",
            request: z.object({}),
            response: z.object({ id: z.string() }),
            mockData: { id: 123 },
          },
        },
      } satisfies Contracts;

      const client = new ApiClient({ baseUrl: "https://api.test.com" }, invalidMockContracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts: invalidMockContracts,
        options: {
          mode: "mock",
        },
      }).run();

      expect(report.summary.failed).toBe(1);
      expect(report.results[0]).toEqual(
        expect.objectContaining({
          endpoint: "brokenMock",
          phase: "mock",
          status: "failed",
          error: expect.objectContaining({
            code: "VALIDATION_ERROR",
          }),
        }),
      );
    });
  });

  describe("createApiTestRunner - live and full modes", () => {
    it("runs live mode through ApiClient modules and creates a useful report", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse([{ id: "user-1", name: "Taha", email: "taha@example.com" }]),
        )
        .mockResolvedValueOnce(
          jsonResponse({ id: "created-user-1", name: "Taha Nabavi", email: "taha@example.com" }),
        )
        .mockResolvedValueOnce(
          jsonResponse({ id: "created-user-1", name: "Taha Nabavi", email: "taha@example.com" }),
        )
        .mockResolvedValueOnce(jsonResponse({ uploaded: true }))
        .mockResolvedValueOnce(
          jsonResponse(
            { message: "User not found", code: "USER_NOT_FOUND" },
            { ok: false, status: 404, statusText: "Not Found" },
          ),
        )
        .mockResolvedValueOnce(jsonResponse({ secret: "real-secret" }));

      const client = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          token: "access-token",
        },
        contracts,
      );
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts,
        options: {
          mode: "live",
          excludeTags: ["danger"],
          timeout: 5_000,
        },
      }).run();

      expect(report.mode).toBe("live");
      expect(report.summary.failed).toBe(0);
      expect(report.summary.passed).toBe(6);
      expect(report.summary.skipped).toBe(2);

      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        "https://api.test.com/users?page=1&active=true",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
          signal: expect.any(AbortSignal),
        },
      );

      expect(fetchMock).toHaveBeenNthCalledWith(2, "https://api.test.com/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Taha Nabavi",
          email: "taha@example.com",
        }),
        signal: expect.any(AbortSignal),
      });

      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        "https://api.test.com/users/created-user-1",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
          signal: expect.any(AbortSignal),
        },
      );

      const uploadCall = fetchMock.mock.calls[3];
      expect(uploadCall[0]).toBe("https://api.test.com/users/user-1/avatar");
      expect(uploadCall[1]).toEqual(
        expect.objectContaining({
          method: "POST",
          headers: {},
          signal: expect.any(AbortSignal),
        }),
      );
      expect(uploadCall[1]?.body).toBeInstanceOf(FormData);

      expect(fetchMock).toHaveBeenNthCalledWith(
        6,
        "https://api.test.com/admin/secret",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer access-token",
          },
          body: undefined,
          signal: expect.any(AbortSignal),
        },
      );

      expect(report.results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            endpoint: "notFoundExpected",
            caseName: "404 is expected",
            status: "passed",
            error: expect.objectContaining({
              status: 404,
              code: "USER_NOT_FOUND",
            }),
          }),
          expect.objectContaining({
            endpoint: "deleteUser",
            status: "skipped",
            destructive: true,
          }),
          expect.objectContaining({
            endpoint: "disabledEndpoint",
            status: "skipped",
          }),
        ]),
      );
    });

    it("runs full mode as schema + mock + live for endpoints with mockData", async () => {
      const oneEndpointContracts = {
        user: {
          listUsers: contracts.user.listUsers,
        },
      } satisfies Contracts;

      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: "real-user-1", name: "Real User" }]));

      const client = new ApiClient({ baseUrl: "https://api.test.com" }, oneEndpointContracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts: oneEndpointContracts,
        options: {
          mode: "full",
        },
      }).run();

      expect(report.summary).toEqual(
        expect.objectContaining({
          total: 3,
          passed: 3,
          failed: 0,
          skipped: 0,
        }),
      );
      expect(report.results.map((item) => item.phase)).toEqual(["schema", "mock", "live"]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("stops on first failed endpoint when stopOnFail is enabled", async () => {
      const failingContracts = {
        first: {
          fail: {
            method: "GET",
            path: "/fail",
            request: z.object({}),
            response: z.object({ ok: z.boolean() }),
          },
        },
        second: {
          shouldNotRun: {
            method: "GET",
            path: "/should-not-run",
            request: z.object({}),
            response: z.object({ ok: z.boolean() }),
          },
        },
      } satisfies Contracts;

      fetchMock.mockResolvedValueOnce(jsonResponse({ invalid: true }));

      const client = new ApiClient({ baseUrl: "https://api.test.com" }, failingContracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts: failingContracts,
        options: {
          mode: "live",
          stopOnFail: true,
        },
      }).run();

      expect(report.summary.total).toBe(1);
      expect(report.summary.failed).toBe(1);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(report.results[0]).toEqual(
        expect.objectContaining({
          module: "first",
          endpoint: "fail",
          status: "failed",
          error: expect.objectContaining({ code: "VALIDATION_ERROR" }),
        }),
      );
    });

    it("marks missing token errors as failed for auth endpoints", async () => {
      const onlyAdminContracts = {
        admin: {
          getSecret: contracts.admin.getSecret,
        },
      } satisfies Contracts;

      const client = new ApiClient({ baseUrl: "https://api.test.com" }, onlyAdminContracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts: onlyAdminContracts,
        options: {
          mode: "live",
        },
      }).run();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(report.summary.failed).toBe(1);
      expect(report.results[0]).toEqual(
        expect.objectContaining({
          endpoint: "getSecret",
          status: "failed",
          error: expect.objectContaining({
            name: "Error",
            message: "Missing token for /admin/secret",
            status: 401,
            code: "NO_TOKEN",
          }),
        }),
      );
    });
  });

  describe("setup and teardown", () => {
    it("runs setup before cases and teardown after cases", async () => {
      const events: string[] = [];

      const setupContracts = {
        user: {
          getUser: {
            method: "GET",
            path: "/users/:id",
            request: z.object({
              path: z.object({ id: z.string() }),
            }),
            response: userResponseSchema,
            test: {
              setup: (ctx) => {
                events.push("setup");
                ctx.set("id", "setup-user");
              },
              input: (ctx) => {
                events.push("input");
                return { path: { id: ctx.get("id") as string } };
              },
              teardown: () => {
                events.push("teardown");
              },
            },
          },
        },
      } satisfies Contracts;

      fetchMock.mockResolvedValueOnce(jsonResponse({ id: "setup-user", name: "Setup User" }));

      const client = new ApiClient({ baseUrl: "https://api.test.com" }, setupContracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts: setupContracts,
        options: {
          mode: "live",
        },
      }).run();

      expect(report.summary.failed).toBe(0);
      expect(events).toEqual(["setup", "input", "teardown"]);
      expect(fetchMock).toHaveBeenCalledWith("https://api.test.com/users/setup-user", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
        signal: expect.any(AbortSignal),
      });
    });

    it("returns setup failure as a failed result and does not call network", async () => {
      const setupFailContracts = {
        user: {
          getUser: {
            method: "GET",
            path: "/users/:id",
            request: z.object({ path: z.object({ id: z.string() }) }),
            response: userResponseSchema,
            test: {
              setup: () => {
                throw new Error("setup failed");
              },
            },
          },
        },
      } satisfies Contracts;

      const client = new ApiClient({ baseUrl: "https://api.test.com" }, setupFailContracts);
      client.init();

      const report = await createApiTestRunner({
        client,
        contracts: setupFailContracts,
      }).run();

      expect(fetchMock).not.toHaveBeenCalled();
      expect(report.summary.failed).toBe(1);
      expect(report.results[0]).toEqual(
        expect.objectContaining({
          caseName: "setup",
          status: "failed",
          error: expect.objectContaining({ message: "setup failed" }),
        }),
      );
    });
  });

  describe("reporter", () => {
    it("creates markdown and html reports from runner output", async () => {
      const report = {
        generatedAt: "2026-06-28T00:00:00.000Z",
        mode: "live" as const,
        summary: {
          total: 2,
          passed: 1,
          failed: 1,
          skipped: 0,
          durationMs: 1250,
        },
        results: [
          {
            module: "user",
            endpoint: "listUsers",
            caseName: "default",
            phase: "live" as const,
            method: "GET" as const,
            path: "/users",
            tags: ["user"],
            destructive: false,
            status: "passed" as const,
            durationMs: 100,
          },
          {
            module: "user",
            endpoint: "broken",
            caseName: "default",
            phase: "live" as const,
            method: "GET" as const,
            path: "/broken",
            tags: ["user"],
            destructive: false,
            status: "failed" as const,
            durationMs: 1150,
            error: {
              message: "Validation error: Required",
              code: "VALIDATION_ERROR",
              issues: [{ path: ["id"], message: "Required" }],
            },
          },
        ],
      };

      const markdown = createMarkdownReport(report);
      const html = createHtmlReport(report);

      expect(markdown).toContain("# TypeFetch API Test Report");
      expect(markdown).toContain("| 2 | 1 | 1 | 0 | 1.25s |");
      expect(markdown).toContain("### user.broken — default");
      expect(markdown).toContain("VALIDATION_ERROR");

      expect(html).toContain("<!doctype html>");
      expect(html).toContain("TypeFetch API Test Report");
      expect(html).toContain("user.broken");
      expect(html).toContain("Validation error: Required");
    });
  });
});
