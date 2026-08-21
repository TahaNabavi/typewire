#!/usr/bin/env node
/**
 * Cross-runtime smoke test
 * ========================
 * Imports the **built** ESM entries and drives a request end to end against a
 * stubbed `fetch`.
 *
 * This is not a second test suite — Jest already covers behaviour on Node. It
 * checks the things Jest structurally cannot: that `exports` resolves outside
 * Node's resolver, that no accidental Node built-in leaked into a browser-facing
 * bundle, and that the globals each package assumes actually exist in Bun, Deno
 * and the edge runtimes people deploy to.
 *
 * An ESM/CJS mistake that Node tolerates fails loudly here, which is the point.
 *
 * Usage: `node scripts/runtime-smoke.mjs` · `bun scripts/runtime-smoke.mjs`
 *        `deno run -A scripts/runtime-smoke.mjs`
 */

const runner =
  process.argv.find((a) => a.startsWith("--runner="))?.split("=")[1] ?? "node";

/** Which JS runtime is actually executing, regardless of the --runner label. */
const detected =
  typeof globalThis.Deno !== "undefined"
    ? "deno"
    : typeof globalThis.Bun !== "undefined"
      ? "bun"
      : "node";

let failures = 0;

function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => console.log(`  ✓ ${name}`))
    .catch((error) => {
      failures++;
      console.error(`  ✗ ${name}\n    ${error?.message ?? error}`);
    });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

console.log(`\nRuntime smoke test — runner: ${runner}, detected: ${detected}\n`);

// --- capability matrix -------------------------------------------------------
// Reported rather than asserted: these gaps are real and documented, and the
// point is to notice when a runtime's answer changes.
const capabilities = {
  fetch: typeof fetch !== "undefined",
  ReadableStream: typeof ReadableStream !== "undefined",
  XMLHttpRequest: typeof XMLHttpRequest !== "undefined",
  FormData: typeof FormData !== "undefined",
  Blob: typeof Blob !== "undefined",
  TextEncoder: typeof TextEncoder !== "undefined",
  structuredClone: typeof structuredClone !== "undefined",
};

console.log("  capabilities:");
for (const [name, present] of Object.entries(capabilities)) {
  console.log(`    ${present ? "•" : "○"} ${name}${present ? "" : " (absent)"}`);
}
console.log("");

// `fetch` is the one hard requirement — every transport is built on it.
assert(capabilities.fetch, "fetch is required and is missing in this runtime");
assert(
  capabilities.TextEncoder,
  "TextEncoder is required (gRPC framing) and is missing",
);

const { z } = await import("zod");
const { ApiClient, RichError, describeEndpoint } = await import(
  "../packages/typefetch/dist/index.mjs"
);
const { graphqlTransport } = await import(
  "../packages/graphql/dist/index.mjs"
);
const { grpcTransport, GrpcCode, encodeFrame, decodeFrames } = await import(
  "../packages/grpc/dist/index.mjs"
);

const User = z.object({ id: z.string(), name: z.string() });

const contracts = {
  user: {
    getUser: {
      method: "GET",
      path: "/users/:id",
      request: z.object({ path: z.object({ id: z.string() }) }),
      response: User,
    },
    syncUser: {
      transport: "grpc",
      service: "user.v1.UserService",
      rpc: "SyncUser",
      request: z.object({ id: z.string() }),
      response: User,
    },
    profile: {
      transport: "graphql",
      operation: "query",
      root: "user",
      request: z.object({ id: z.string() }),
      response: User,
    },
  },
};

/** Record every outgoing request so each transport's wire shape is asserted. */
const sent = [];
const originalFetch = globalThis.fetch;

globalThis.fetch = async (url, init) => {
  sent.push({ url: String(url), init });

  if (String(url).includes("graphql")) {
    return new Response(JSON.stringify({ data: { user: { id: "1", name: "Ada" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ id: "1", name: "Ada" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};

const client = new ApiClient(
  {
    baseUrl: "https://api.test",
    transports: [
      graphqlTransport({ url: "https://api.test/graphql" }),
      grpcTransport(),
    ],
  },
  contracts,
);
client.init();

await check("http route resolves and validates", async () => {
  const user = await client.modules.user.getUser({ path: { id: "1" } });
  assert(user.name === "Ada", `expected Ada, got ${user.name}`);
  assert(
    sent.at(-1).url === "https://api.test/users/1",
    `bad url: ${sent.at(-1).url}`,
  );
});

await check("grpc route posts to /service/rpc", async () => {
  const user = await client.modules.user.syncUser({ id: "1" });
  assert(user.name === "Ada", "grpc response did not validate");
  assert(
    sent.at(-1).url === "https://api.test/user.v1.UserService/SyncUser",
    `bad url: ${sent.at(-1).url}`,
  );
});

await check("graphql route generates a selection set from the schema", async () => {
  const user = await client.modules.user.profile({ id: "1" });
  assert(user.name === "Ada", "graphql response did not validate");

  const body = JSON.parse(sent.at(-1).init.body);
  assert(
    body.query.includes("id") && body.query.includes("name"),
    `selection set missing fields: ${body.query}`,
  );
});

await check("errors normalize across transports", async () => {
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "nope" }), { status: 401 });

  try {
    await client.modules.user.getUser({ path: { id: "1" } });
    throw new Error("expected a rejection");
  } catch (error) {
    assert(error instanceof RichError, "not a RichError");
    assert(
      error.kind === "unauthenticated",
      `expected unauthenticated, got ${error.kind}`,
    );
  }
});

await check("a client describes a route through its registered adapter", () => {
  const route = client.describe(contracts.user.syncUser);
  assert(route.protocol === "gRPC", `expected gRPC, got ${route.protocol}`);
  assert(
    route.target === "user.v1.UserService/SyncUser",
    `bad target: ${route.target}`,
  );
});

await check("describeEndpoint degrades rather than throwing on an unknown transport", () => {
  // Tooling that holds contracts but no client — a lint rule, a doc generator —
  // must still run against a transport it was built before. Printing a route
  // with a `?` target beats omitting it, and beats crashing.
  const route = describeEndpoint(contracts.user.syncUser);
  assert(route.protocol === "grpc", `expected grpc, got ${route.protocol}`);
  assert(route.target === "?", `expected the degraded target, got ${route.target}`);

  // …and resolves fully once the adapter is handed to it.
  const resolved = describeEndpoint(contracts.user.syncUser, [grpcTransport()]);
  assert(resolved.protocol === "gRPC", `expected gRPC, got ${resolved.protocol}`);
});

await check("grpc-web framing round-trips", () => {
  const frames = decodeFrames(encodeFrame(new Uint8Array([1, 2, 3])));
  assert(frames.length === 1, `expected 1 frame, got ${frames.length}`);
  assert(frames[0].payload.length === 3, "payload was corrupted");
  assert(GrpcCode.NotFound === 5, "GrpcCode enum did not survive the bundle");
});

globalThis.fetch = originalFetch;

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed on ${detected}.\n`);
  process.exit(1);
}
console.log(`All checks passed on ${detected}.\n`);
