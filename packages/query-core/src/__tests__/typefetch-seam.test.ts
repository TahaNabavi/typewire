import { ApiClient } from "@tahanabavi/typefetch";
import { z } from "zod";
import { QueryClient } from "../query-client";
import type { QueryEndpoint } from "../types";

/**
 * The cross-package seam. query-core never imports typefetch's types — it
 * accepts anything structurally shaped like a generated member — so nothing but
 * a test catches it if typefetch renames `endpointId` or changes the call
 * signature. That is exactly the drift this suite exists to fail on.
 */
const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: z.object({ id: z.string(), name: z.string() }),
      mockData: { id: "1", name: "Taha" },
    },
  },
} as const;

function makeClient() {
  const client = new ApiClient(
    {
      baseUrl: "http://localhost:9999",
      useMockData: true,
      mockDelay: { min: 0, max: 0 },
    },
    contracts,
  );
  client.init();
  return client;
}

describe("typefetch seam", () => {
  it("a generated endpoint method satisfies QueryEndpoint", () => {
    const client = makeClient();

    // Compile-time assertion: this line failing to typecheck *is* the test.
    const endpoint: QueryEndpoint = client.modules.user.getUser;

    expect(typeof endpoint).toBe("function");
    expect(endpoint.endpointId).toBe("user.getUser");
  });

  it("caches a real typefetch endpoint through the query client", async () => {
    const client = makeClient();
    const queryClient = new QueryClient();
    const endpoint = client.modules.user.getUser;

    const data = await queryClient.fetchQuery(endpoint, { path: { id: "1" } });

    expect(data).toEqual({ id: "1", name: "Taha" });
    expect(queryClient.getQueryData(endpoint, { path: { id: "1" } })).toEqual({
      id: "1",
      name: "Taha",
    });
  });

  it("keys the cache by the endpoint id typefetch attached", async () => {
    const client = makeClient();
    const queryClient = new QueryClient();

    await queryClient.fetchQuery(client.modules.user.getUser, {
      path: { id: "1" },
    });

    expect(queryClient.cache.find({ endpointId: "user.getUser" })).toHaveLength(1);
  });

  it("deduplicates concurrent calls to a real endpoint", async () => {
    const client = makeClient();
    const queryClient = new QueryClient();
    const endpoint = client.modules.user.getUser;

    const a = queryClient.fetchQuery(endpoint, { path: { id: "1" } });
    const b = queryClient.fetchQuery(endpoint, { path: { id: "1" } });

    // The identical promise object is the dedup: the second caller joined the
    // first request rather than starting its own.
    expect(a).toBe(b);
    await expect(a).resolves.toEqual({ id: "1", name: "Taha" });
  });
});
