import { z, ZodError } from "zod";
import { ApiClient, RichError, isContractError } from "../client";
import { Contracts } from "../types";
import { makeRequestSchema } from "../utils/make-request-schema";

global.fetch = jest.fn();

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/user",
      request: z.object({ id: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
      // Add mock data for testing
      mockData: { id: "mock-1", name: "Mock User" },
    },
    createUser: {
      method: "POST",
      path: "/user",
      auth: true,
      request: z.object({ name: z.string() }),
      response: z.object({ id: z.string(), name: z.string() }),
      // Add dynamic mock data function
      mockData: () => ({
        id: `mock-${Math.random().toString(36).substr(2, 6)}`,
        name: "Dynamic Mock User",
      }),
    },
    listUsers: {
      method: "GET",
      path: "/users",
      request: z.object({}),
      response: z.array(z.object({ id: z.string(), name: z.string() })),
      // No mock data for this endpoint
    },
    getUserById: {
      method: "GET",
      path: "/users/:id",
      request: makeRequestSchema<
        { id: z.ZodString },
        {
          include: z.ZodOptional<z.ZodString>;
          active: z.ZodOptional<z.ZodBoolean>;
        }
      >()({
        path: z.object({
          id: z.string(),
        }),
        query: z.object({
          include: z.string().optional(),
          active: z.boolean().optional(),
        }),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
    },

    updateUserStructured: {
      method: "PATCH",
      path: "/users/:id",
      request: makeRequestSchema<
        { id: z.ZodString },
        {},
        z.ZodObject<{
          name: z.ZodString;
          age: z.ZodOptional<z.ZodNumber>;
        }>
      >()({
        path: z.object({
          id: z.string(),
        }),
        body: z.object({
          name: z.string(),
          age: z.number().optional(),
        }),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
        age: z.number().optional(),
      }),
    },

    searchUsersStructured: {
      method: "GET",
      path: "/users/search",
      request: makeRequestSchema<
        {},
        {
          q: z.ZodString;
          tags: z.ZodOptional<z.ZodArray<z.ZodString>>;
          page: z.ZodOptional<z.ZodNumber>;
        }
      >()({
        query: z.object({
          q: z.string(),
          tags: z.array(z.string()).optional(),
          page: z.number().optional(),
        }),
        headers: z.record(z.string(), z.string()).optional(),
      }),
      response: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
    },

    createUserStructured: {
      method: "POST",
      path: "/users",
      request: makeRequestSchema<
        {},
        {},
        z.ZodObject<{
          name: z.ZodString;
        }>
      >()({
        body: z.object({
          name: z.string(),
        }),
      }),
      response: z.object({
        id: z.string(),
        name: z.string(),
      }),
    },

    uploadAvatar: {
      method: "POST",
      path: "/users/:id/avatar",
      bodyType: "form-data",
      request: makeRequestSchema<
        { id: z.ZodString },
        {},
        z.ZodObject<{
          file: z.ZodString;
          alt: z.ZodOptional<z.ZodString>;
        }>
      >()({
        path: z.object({
          id: z.string(),
        }),
        body: z.object({
          file: z.string(),
          alt: z.string().optional(),
        }),
      }),
      response: z.object({
        uploaded: z.boolean(),
      }),
    },
  },
  admin: {
    // Add this missing module
    getAdminData: {
      method: "GET",
      path: "/admin/data",
      auth: true,
      request: z.object({}),
      response: z.object({ secret: z.string() }),
      mockData: { secret: "admin-secret" },
    },
  },
} satisfies Contracts;

describe("ApiClient", () => {
  let client: ApiClient<typeof contracts>;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new ApiClient({ baseUrl: "https://api.test.com" }, contracts);
    client.init();
  });

  it("should initialize modules correctly", () => {
    expect(client.modules.user).toBeDefined();
    expect(typeof client.modules.user.getUser).toBe("function");
  });

  it("should call fetch with correct URL and headers", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    const res = await client.modules.user.getUser({ id: "1" });
    expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      body: undefined,
    });
    expect(res).toEqual({ id: "1", name: "John" });
  });

  it("should throw validation error if input is invalid", async () => {
    await expect(client.modules.user.getUser({} as any)).rejects.toBeInstanceOf(
      ZodError,
    );
  });

  it("should handle auth header when token is provided", async () => {
    const authedClient = new ApiClient(
      { baseUrl: "https://api.test.com", token: "mytoken" },
      contracts,
    );
    authedClient.init();

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "2", name: "Alice" }),
    });

    await authedClient.modules.user.createUser({ name: "Alice" });

    expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer mytoken",
      },
      body: JSON.stringify({ name: "Alice" }),
    });
  });

  it("should throw error if auth required and no token provided", async () => {
    await expect(
      client.modules.user.createUser({ name: "Alice" }),
    ).rejects.toThrow(RichError);
  });

  it("should call errorHandler when error occurs", async () => {
    const handler = jest.fn();
    client.onError(handler);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ message: "Invalid input" }),
    });

    await expect(client.modules.user.getUser({ id: "bad" })).rejects.toThrow();

    expect(handler).toHaveBeenCalled();
  });

  it("should apply responseTransform", async () => {
    client.useResponseTransform((data) => ({ ...data, transformed: true }));

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    const res = await client.modules.user.getUser({ id: "1" });
    expect(res).toEqual({ id: "1", name: "John", transformed: true });
  });

  it("should execute middleware in order", async () => {
    const logs: string[] = [];

    client.use(async (ctx, next) => {
      logs.push("before");
      const res = await next();
      logs.push("after");
      return res;
    });

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "1", name: "John" }),
    });

    await client.modules.user.getUser({ id: "1" });

    expect(logs).toEqual(["before", "after"]);
  });

  describe("Mock Data Feature", () => {
    it("should use mock data when mock mode is enabled", async () => {
      client.setMockMode(true, { min: 0, max: 0 });
      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should use dynamic mock data function when provided", async () => {
      client.setMockMode(true, { min: 0, max: 0 });

      const result1 = await client.modules.user.createUser({ name: "Test" });
      const result2 = await client.modules.user.createUser({ name: "Test" });

      expect(result1.id).toMatch(/^mock-/);
      expect(result1.name).toBe("Dynamic Mock User");
      expect(result2.id).not.toBe(result1.id);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should fall back to real API when mock data is not provided", async () => {
      client.setMockMode(true, { min: 0, max: 0 });

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [{ id: "1", name: "User1" }],
      });

      const result = await client.modules.user.listUsers({});

      expect(result).toEqual([{ id: "1", name: "User1" }]);
      expect(fetch).toHaveBeenCalled();
    });

    it("should add random delay when using mock data", async () => {
      const mockDateNow = jest
        .spyOn(Date, "now")
        .mockReturnValueOnce(0)
        .mockReturnValueOnce(100);

      client.setMockMode(true, { min: 100, max: 100 });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
      expect(fetch).not.toHaveBeenCalled();

      mockDateNow.mockRestore();
    });

    it("should toggle mock mode at runtime", async () => {
      client.setMockMode(true, { min: 0, max: 0 });
      let result = await client.modules.user.getUser({ id: "1" });
      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
      expect(fetch).not.toHaveBeenCalled();

      client.setMockMode(false);
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "real-1", name: "Real User" }),
      });

      result = await client.modules.user.getUser({ id: "1" });
      expect(result).toEqual({ id: "real-1", name: "Real User" });
      expect(fetch).toHaveBeenCalled();
    });
  });

  describe("Response Wrapper Feature", () => {
    const createApiResponseWrapper = (successResponse: z.ZodTypeAny) =>
      z.union([
        z.object({
          success: z.literal(true),
          data: successResponse,
          timestamp: z.string(),
          requestId: z.string(),
        }),
        z.object({
          success: z.literal(false),
          message: z.string(),
          code: z.number(),
          timestamp: z.string(),
          requestId: z.string(),
        }),
      ]);

    it("should validate and unwrap successful wrapped responses", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John" });
    });

    it("should throw error for failed wrapped responses", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          message: "User not found",
          code: 404,
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      await expect(client.modules.user.getUser({ id: "999" })).rejects.toThrow(
        RichError,
      );
    });

    it("should work with mock data and response wrapper", async () => {
      client.setResponseWrapper(createApiResponseWrapper);
      client.setMockMode(true, { min: 0, max: 0 });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
    });

    it("should throw validation error for invalid wrapped response format", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invalid: "format",
        }),
      });

      try {
        await client.modules.user.getUser({ id: "1" });
        fail("Expected error to be thrown");
      } catch (error: any) {
        expect(error.message).toContain("Validation error");
        expect(error.message).toMatch(/validation|invalid/i);
      }
    });

    it("should handle response transform with wrapper", async () => {
      client.setResponseWrapper(createApiResponseWrapper);
      client.useResponseTransform((data) => ({ ...data, transformed: true }));

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John", transformed: true });
    });
  });

  describe("Integration: Mock Data + Response Wrapper", () => {
    it("should handle both features together", async () => {
      const wrapper = (successResponse: z.ZodTypeAny) =>
        z.union([
          z.object({
            success: z.literal(true),
            data: successResponse,
            timestamp: z.string(),
            requestId: z.string(),
          }),
          z.object({
            success: z.literal(false),
            message: z.string(),
            code: z.number(),
            timestamp: z.string(),
            requestId: z.string(),
          }),
        ]);

      client.setResponseWrapper(wrapper);
      client.setMockMode(true, { min: 0, max: 0 });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
    });
  });

  describe("Token Provider Feature", () => {
    it("should use tokenProvider when provided in constructor", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithProvider.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dynamic-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should use tokenProvider over static token when both provided", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");
      const clientWithBoth = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          token: "static-token",
          tokenProvider,
        },
        contracts,
      );
      clientWithBoth.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithBoth.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dynamic-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should work with async tokenProvider", async () => {
      const tokenProvider = jest.fn().mockResolvedValue("async-token");
      const clientWithAsyncProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithAsyncProvider.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithAsyncProvider.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer async-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should set tokenProvider dynamically after initialization", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");

      // Client without initial token provider
      const clientWithoutProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
        },
        contracts,
      );
      clientWithoutProvider.init();

      // Set token provider after initialization
      clientWithoutProvider.setTokenProvider(tokenProvider);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await clientWithoutProvider.modules.user.createUser({ name: "Alice" });

      expect(tokenProvider).toHaveBeenCalled();
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer dynamic-token",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should get current token from tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("current-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      const token = await clientWithProvider.getCurrentToken();

      expect(tokenProvider).toHaveBeenCalled();
      expect(token).toBe("current-token");
    });

    it("should get current token from static config when no tokenProvider", async () => {
      const clientWithStaticToken = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          token: "static-token",
        },
        contracts,
      );
      clientWithStaticToken.init();

      const token = await clientWithStaticToken.getCurrentToken();

      expect(token).toBe("static-token");
    });

    it("should return undefined when no token or tokenProvider", async () => {
      const clientWithoutToken = new ApiClient(
        {
          baseUrl: "https://api.test.com",
        },
        contracts,
      );
      clientWithoutToken.init();

      const token = await clientWithoutToken.getCurrentToken();

      expect(token).toBeUndefined();
    });

    it("should handle tokenProvider returning empty string", async () => {
      const tokenProvider = jest.fn().mockReturnValue("");
      const clientWithEmptyProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithEmptyProvider.init();

      await expect(
        clientWithEmptyProvider.modules.user.createUser({ name: "Alice" }),
      ).rejects.toThrow(RichError);

      expect(tokenProvider).toHaveBeenCalled();
    });

    it("should handle tokenProvider returning null/undefined", async () => {
      const tokenProvider = jest.fn().mockReturnValue(null);
      const clientWithNullProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithNullProvider.init();

      await expect(
        clientWithNullProvider.modules.user.createUser({ name: "Alice" }),
      ).rejects.toThrow(RichError);

      expect(tokenProvider).toHaveBeenCalled();
    });

    it("should work with tokenProvider for non-auth endpoints", async () => {
      const tokenProvider = jest.fn().mockReturnValue("some-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      const result = await clientWithProvider.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John" });
      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });

      const fetchCall = (fetch as jest.Mock).mock.calls[0][1] as RequestInit;
      expect(fetchCall.headers).not.toHaveProperty("Authorization");
    });

    it("should call tokenProvider for each auth request", async () => {
      const tokenProvider = jest.fn().mockReturnValue("dynamic-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "1", name: "User1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "2", name: "User2" }),
        });

      await clientWithProvider.modules.user.createUser({ name: "User1" });
      await clientWithProvider.modules.user.createUser({ name: "User2" });

      expect(tokenProvider).toHaveBeenCalledTimes(2);
    });

    it("should work with mock data and tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("mock-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
          useMockData: true,
        },
        contracts,
      );
      clientWithProvider.init();

      const result = await clientWithProvider.modules.user.createUser({
        name: "Test",
      });

      expect(result.id).toMatch(/^mock-/);
      expect(result.name).toBe("Dynamic Mock User");
      // Token provider should not be called when using mock data
      expect(tokenProvider).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("should handle tokenProvider errors gracefully", async () => {
      const tokenProvider = jest.fn().mockImplementation(() => {
        throw new Error("Token provider failed");
      });
      const clientWithFailingProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithFailingProvider.init();

      await expect(
        clientWithFailingProvider.modules.user.createUser({ name: "Alice" }),
      ).rejects.toThrow("Token provider failed");
    });

    it("should work with response wrapper and tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("wrapper-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      clientWithProvider.setResponseWrapper((successResponse) =>
        z.union([
          z.object({
            success: z.literal(true),
            data: successResponse,
          }),
          z.object({
            success: z.literal(false),
            error: z.string(),
          }),
        ]),
      );

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
        }),
      });

      const result = await clientWithProvider.modules.user.createUser({
        name: "Alice",
      });

      expect(tokenProvider).toHaveBeenCalled();
      expect(result).toEqual({ id: "1", name: "John" });
    });

    it("should work with multiple modules and tokenProvider", async () => {
      const tokenProvider = jest.fn().mockReturnValue("multi-token");
      const clientWithProvider = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          tokenProvider,
        },
        contracts,
      );
      clientWithProvider.init();

      (fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "1", name: "User1" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ secret: "admin-data" }),
        });

      await clientWithProvider.modules.user.createUser({ name: "User1" });
      await clientWithProvider.modules.admin.getAdminData({});

      expect(tokenProvider).toHaveBeenCalledTimes(2);
      expect(fetch).toHaveBeenNthCalledWith(1, "https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer multi-token",
        },
        body: JSON.stringify({ name: "User1" }),
      });
      expect(fetch).toHaveBeenNthCalledWith(
        2,
        "https://api.test.com/admin/data",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer multi-token",
          },
          body: undefined,
        },
      );
    });
  });

  describe("Response Wrapper Feature", () => {
    const createApiResponseWrapper = (successResponse: z.ZodTypeAny) =>
      z.union([
        z.object({
          success: z.literal(true),
          data: successResponse,
          timestamp: z.string(),
          requestId: z.string(),
        }),
        z.object({
          success: z.literal(false),
          message: z.string(),
          code: z.number(),
          timestamp: z.string(),
          requestId: z.string(),
        }),
      ]);

    it("should validate and unwrap successful wrapped responses", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John" });
    });

    it("should throw error for failed wrapped responses", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          message: "User not found",
          code: 404,
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      await expect(client.modules.user.getUser({ id: "999" })).rejects.toThrow(
        RichError,
      );
    });

    it("should throw validation error for invalid wrapped response format", async () => {
      client.setResponseWrapper(createApiResponseWrapper);

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          invalid: "format",
        }),
      });

      try {
        await client.modules.user.getUser({ id: "1" });
        fail("Expected error to be thrown");
      } catch (error: any) {
        expect(error.message).toContain("Validation error");
        expect(error.message).toMatch(/validation|invalid/i);
      }
    });

    it("should handle response transform with wrapper", async () => {
      client.setResponseWrapper(createApiResponseWrapper);
      client.useResponseTransform((data) => ({ ...data, transformed: true }));

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { id: "1", name: "John" },
          timestamp: "2024-01-15T10:30:00Z",
          requestId: "req-123",
        }),
      });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "1", name: "John", transformed: true });
    });
  });

  describe("Integration: Mock Data + Response Wrapper", () => {
    it("should handle both features together", async () => {
      const wrapper = (successResponse: z.ZodTypeAny) =>
        z.union([
          z.object({
            success: z.literal(true),
            data: successResponse,
            timestamp: z.string(),
            requestId: z.string(),
          }),
          z.object({
            success: z.literal(false),
            message: z.string(),
            code: z.number(),
            timestamp: z.string(),
            requestId: z.string(),
          }),
        ]);

      client.setResponseWrapper(wrapper);
      client.setMockMode(true, { min: 0, max: 0 });

      const result = await client.modules.user.getUser({ id: "1" });

      expect(result).toEqual({ id: "mock-1", name: "Mock User" });
    });
  });

  describe("Structured Request Parts Feature", () => {
    it("should replace path params and append query params for structured GET requests", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123", name: "John" }),
      });

      const result = await client.modules.user.getUserById({
        path: { id: "123" },
        query: {
          include: "roles",
          active: true,
        },
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/users/123?include=roles&active=true",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
        },
      );

      expect(result).toEqual({ id: "123", name: "John" });
    });

    it("should URL encode path params", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "user 123", name: "John" }),
      });

      await client.modules.user.getUserById({
        path: { id: "user 123" },
        query: {},
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/users/user%20123",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
        },
      );
    });

    it("should send only structured body for non-GET requests", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123", name: "Taha", age: 22 }),
      });

      const result = await client.modules.user.updateUserStructured({
        path: { id: "123" },
        body: {
          name: "Taha",
          age: 22,
        },
      });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/users/123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Taha",
          age: 22,
        }),
      });

      expect(result).toEqual({ id: "123", name: "Taha", age: 22 });
    });

    it("should merge structured request headers into fetch headers", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123", name: "Taha" }),
      });

      await client.modules.user.updateUserStructured({
        path: { id: "123" },
        headers: {
          "X-Tenant": "main",
          "X-Request-Source": "test-suite",
        },
        body: {
          name: "Taha",
        },
      });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/users/123", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "main",
          "X-Request-Source": "test-suite",
        },
        body: JSON.stringify({
          name: "Taha",
        }),
      });
    });

    it("should append array query params by repeating the same query key", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "1", name: "John" },
          { id: "2", name: "Alice" },
        ],
      });

      const result = await client.modules.user.searchUsersStructured({
        query: {
          q: "dev",
          tags: ["react", "node"],
          page: 2,
        },
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/users/search?q=dev&tags=react&tags=node&page=2",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
        },
      );

      expect(result).toEqual([
        { id: "1", name: "John" },
        { id: "2", name: "Alice" },
      ]);
    });

    it("should allow structured POST with only body and no path/query/headers", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "Taha" }),
      });

      const result = await client.modules.user.createUserStructured({
        body: {
          name: "Taha",
        },
      });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Taha",
        }),
      });

      expect(result).toEqual({ id: "1", name: "Taha" });
    });

    it("should not send a body for structured GET even when body exists in schema input", async () => {
      const weirdGetContracts = {
        user: {
          getWithBodyIgnored: {
            method: "GET",
            path: "/users/:id",
            request: makeRequestSchema<
              { id: z.ZodString },
              {},
              z.ZodObject<{ ignored: z.ZodString }>
            >()({
              path: z.object({
                id: z.string(),
              }),
              body: z.object({
                ignored: z.string(),
              }),
            }),
            response: z.object({
              id: z.string(),
            }),
          },
        },
      } satisfies Contracts;

      const weirdClient = new ApiClient(
        { baseUrl: "https://api.test.com" },
        weirdGetContracts,
      );

      weirdClient.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123" }),
      });

      await weirdClient.modules.user.getWithBodyIgnored({
        path: { id: "123" },
        body: { ignored: "do-not-send" },
      });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/users/123", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
    });

    it("should throw validation error when structured path params are invalid", async () => {
      await expect(
        client.modules.user.getUserById({
          path: {},
          query: {},
        } as any),
      ).rejects.toThrow();

      expect(fetch).not.toHaveBeenCalled();
    });

    it("should preserve legacy GET behavior", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await client.modules.user.getUser({ id: "1" });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
    });

    it("should preserve legacy POST behavior", async () => {
      const authedClient = new ApiClient(
        {
          baseUrl: "https://api.test.com",
          token: "mytoken",
        },
        contracts,
      );

      authedClient.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "2", name: "Alice" }),
      });

      await authedClient.modules.user.createUser({ name: "Alice" });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mytoken",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should send structured form-data body without Content-Type json header", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uploaded: true }),
      });

      const result = await client.modules.user.uploadAvatar({
        path: { id: "123" },
        body: {
          file: "fake-file-content",
          alt: "Avatar",
        },
      });

      expect(fetch).toHaveBeenCalledTimes(1);

      const [url, init] = (fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];

      expect(url).toBe("https://api.test.com/users/123/avatar");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({});
      expect(init.body).toBeInstanceOf(FormData);

      const form = init.body as FormData;

      expect(form.get("file")).toBe("fake-file-content");
      expect(form.get("alt")).toBe("Avatar");

      expect(result).toEqual({ uploaded: true });
    });
  });

  describe("Structured Request Parts Feature", () => {
    it("should replace path params and append query params for structured GET requests", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123", name: "John" }),
      });

      const result = await client.modules.user.getUserById({
        path: { id: "123" },
        query: { include: "roles", active: true },
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/users/123?include=roles&active=true",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
        },
      );

      expect(result).toEqual({ id: "123", name: "John" });
    });

    it("should URL encode path params", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "user 123", name: "John" }),
      });

      await client.modules.user.getUserById({
        path: { id: "user 123" },
        query: {},
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/users/user%20123",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
        },
      );
    });

    it("should send only structured body for non-GET requests", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123", name: "Taha", age: 22 }),
      });

      const result = await client.modules.user.updateUserStructured({
        path: { id: "123" },
        body: { name: "Taha", age: 22 },
      });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/users/123", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Taha", age: 22 }),
      });

      expect(result).toEqual({ id: "123", name: "Taha", age: 22 });
    });

    it("should merge structured request headers into fetch headers", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "123", name: "Taha" }),
      });

      await client.modules.user.updateUserStructured({
        path: { id: "123" },
        headers: {
          "X-Tenant": "main",
          "X-Request-Source": "test-suite",
        },
        body: { name: "Taha" },
      });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/users/123", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-Tenant": "main",
          "X-Request-Source": "test-suite",
        },
        body: JSON.stringify({ name: "Taha" }),
      });
    });

    it("should append array query params by repeating the same query key", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => [
          { id: "1", name: "John" },
          { id: "2", name: "Alice" },
        ],
      });

      const result = await client.modules.user.searchUsersStructured({
        query: { q: "dev", tags: ["react", "node"], page: 2 },
      });

      expect(fetch).toHaveBeenCalledWith(
        "https://api.test.com/users/search?q=dev&tags=react&tags=node&page=2",
        {
          method: "GET",
          headers: { "Content-Type": "application/json" },
          body: undefined,
        },
      );

      expect(result).toEqual([
        { id: "1", name: "John" },
        { id: "2", name: "Alice" },
      ]);
    });

    it("should allow structured POST with only body", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "Taha" }),
      });

      const result = await client.modules.user.createUserStructured({
        body: { name: "Taha" },
      });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Taha" }),
      });

      expect(result).toEqual({ id: "1", name: "Taha" });
    });

    it("should preserve legacy GET behavior", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "1", name: "John" }),
      });

      await client.modules.user.getUser({ id: "1" });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        body: undefined,
      });
    });

    it("should preserve legacy POST behavior", async () => {
      const authedClient = new ApiClient(
        { baseUrl: "https://api.test.com", token: "mytoken" },
        contracts,
      );
      authedClient.init();

      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: "2", name: "Alice" }),
      });

      await authedClient.modules.user.createUser({ name: "Alice" });

      expect(fetch).toHaveBeenCalledWith("https://api.test.com/user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer mytoken",
        },
        body: JSON.stringify({ name: "Alice" }),
      });
    });

    it("should send structured form-data body without Content-Type json header", async () => {
      (fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ uploaded: true }),
      });

      const result = await client.modules.user.uploadAvatar({
        path: { id: "123" },
        body: { file: "fake-file-content", alt: "Avatar" },
      });

      const [url, init] = (fetch as jest.Mock).mock.calls[0] as [
        string,
        RequestInit,
      ];

      expect(url).toBe("https://api.test.com/users/123/avatar");
      expect(init.method).toBe("POST");
      expect(init.headers).toEqual({});
      expect(init.body).toBeInstanceOf(FormData);

      const form = init.body as FormData;
      expect(form.get("file")).toBe("fake-file-content");
      expect(form.get("alt")).toBe("Avatar");

      expect(result).toEqual({ uploaded: true });
    });
  });
});

describe("Typed Error Responses (errors map)", () => {
  const errorContracts = {
    user: {
      createUser: {
        method: "POST",
        path: "/users",
        request: z.object({ email: z.string() }),
        response: z.object({ id: z.string() }),
        errors: {
          409: z.object({
            code: z.literal("EMAIL_TAKEN"),
            conflictField: z.string(),
          }),
          422: z.object({
            code: z.literal("INVALID"),
            issues: z.array(z.string()),
          }),
        },
      },
      getUser: {
        method: "GET",
        path: "/user",
        request: z.object({ id: z.string() }),
        response: z.object({ id: z.string(), name: z.string() }),
        // no `errors` declared — legacy behavior
      },
    },
  } satisfies Contracts;

  let errorClient: ApiClient<typeof errorContracts>;

  beforeEach(() => {
    jest.clearAllMocks();
    errorClient = new ApiClient(
      { baseUrl: "https://api.test.com" },
      errorContracts,
    );
    errorClient.init();
  });

  it("should parse the declared error body into RichError.data", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ code: "EMAIL_TAKEN", conflictField: "email" }),
    });

    try {
      await errorClient.modules.user.createUser({ email: "a@b.com" });
      fail("Expected error to be thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(RichError);
      expect((error as RichError).status).toBe(409);
      expect((error as RichError).data).toEqual({
        code: "EMAIL_TAKEN",
        conflictField: "email",
      });
      // body validated against the declared schema
      expect((error as RichError).dataParsed).toBe(true);
    }
  });

  it("should narrow the error with isContractError at the matching status", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      json: async () => ({ code: "EMAIL_TAKEN", conflictField: "email" }),
    });

    try {
      await errorClient.modules.user.createUser({ email: "a@b.com" });
      fail("Expected error to be thrown");
    } catch (error) {
      expect(isContractError(errorContracts.user.createUser, error, 409)).toBe(
        true,
      );
      expect(isContractError(errorContracts.user.createUser, error, 422)).toBe(
        false,
      );

      if (isContractError(errorContracts.user.createUser, error, 409)) {
        // `error.data` is typed as the 409 body here
        expect(error.data.conflictField).toBe("email");
      }
    }
  });

  it("should fall back to raw json when no schema is declared for the status", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Server Error",
      json: async () => ({ message: "boom", detail: "internal" }),
    });

    try {
      await errorClient.modules.user.createUser({ email: "a@b.com" });
      fail("Expected error to be thrown");
    } catch (error) {
      expect((error as RichError).status).toBe(500);
      expect((error as RichError).data).toEqual({
        message: "boom",
        detail: "internal",
      });
    }
  });

  it("should fall back to raw json when the body fails schema validation", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 409,
      statusText: "Conflict",
      // does not match the 409 schema (wrong literal, missing field)
      json: async () => ({ code: "SOMETHING_ELSE" }),
    });

    try {
      await errorClient.modules.user.createUser({ email: "a@b.com" });
      fail("Expected error to be thrown");
    } catch (error) {
      expect((error as RichError).status).toBe(409);
      // typing never throws — raw body is preserved
      expect((error as RichError).data).toEqual({ code: "SOMETHING_ELSE" });
      // body did NOT match the schema, so it was not marked as validated
      expect((error as RichError).dataParsed).toBe(false);
      // and the guard refuses to narrow to a type the body doesn't match
      expect(
        isContractError(errorContracts.user.createUser, error, 409),
      ).toBe(false);
    }
  });

  it("should attach raw json as data for endpoints without an errors map", async () => {
    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ message: "user not found", code: "NOT_FOUND" }),
    });

    try {
      await errorClient.modules.user.getUser({ id: "missing" });
      fail("Expected error to be thrown");
    } catch (error) {
      expect((error as RichError).status).toBe(404);
      expect((error as RichError).data).toEqual({
        message: "user not found",
        code: "NOT_FOUND",
      });
      // existing normalized fields remain untouched
      expect((error as RichError).message).toBe("user not found");
      expect((error as RichError).code).toBe("NOT_FOUND");
    }
  });

  it("should still call the error handler with the typed error", async () => {
    const handler = jest.fn();
    errorClient.onError(handler);

    (fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 422,
      statusText: "Unprocessable Entity",
      json: async () => ({ code: "INVALID", issues: ["email"] }),
    });

    await expect(
      errorClient.modules.user.createUser({ email: "bad" }),
    ).rejects.toBeInstanceOf(RichError);

    expect(handler).toHaveBeenCalled();
    const handled = handler.mock.calls[0][0] as RichError;
    expect(handled.status).toBe(422);
    expect(handled.data).toEqual({ code: "INVALID", issues: ["email"] });
  });

  it("should return false from isContractError for non-RichError values", () => {
    expect(
      isContractError(errorContracts.user.createUser, new Error("x"), 409),
    ).toBe(false);
    expect(
      isContractError(errorContracts.user.createUser, "nope", 409),
    ).toBe(false);
  });
});
