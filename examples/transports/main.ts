import assert from "node:assert/strict";
import { RichError } from "@tahanabavi/typefetch";
import { createClient } from "./shared/client.js";
import { contracts } from "./shared/contracts.js";
import { startServer } from "./shared/server.js";

/**
 * Three protocols, one client, asserted.
 *
 * `pnpm test` runs this file. An example that only prints can drift from the
 * packages it demonstrates without anyone noticing; one that fails the build
 * cannot.
 */

const server = await startServer();

// The same factory `typewire.config.ts` hands to the CLI — it takes the options
// the CLI passes, so the app and the test runner drive one client definition.
const client = createClient({ baseUrl: server.url });
const { user } = client.modules;

// ── 1. The same call site, three wires ───────────────────────────────────────
// Nothing below names a protocol. Each of these is `await fn(input)` returning
// a validated `User` — the transport is a property of the contract, not of the
// call.
const [rest, graphql, grpc] = await Promise.all([
  user.getUser({ path: { id: "1" } }),
  user.profile({ id: "1" }),
  user.syncUser({ id: "1" }),
]);

console.log("[1] three transports, one shape");
for (const [label, value] of [
  ["http   ", rest],
  ["graphql", graphql],
  ["grpc   ", grpc],
] as const) {
  console.log(`      ${label} → ${value.name} <${value.email}>`);
}

assert.deepEqual(rest, graphql, "graphql must return what http returns");
assert.deepEqual(rest, grpc, "grpc must return what http returns");

// And each really did go over its own wire.
assert.deepEqual(
  server.log.map((entry) => entry.protocol).sort(),
  ["GraphQL", "HTTP", "gRPC"],
  "each route must have used its own protocol",
);

// ── 2. The GraphQL query was generated from the zod schema ───────────────────
// No document is written in the contract. This is what the client actually
// sent — derived from the `response` schema, so adding a field to `User` adds
// it to the query, and the two cannot drift.
console.log("\n[2] the document nobody wrote");

const graphqlRequest = server.log.find((entry) => entry.protocol === "GraphQL");
assert.ok(graphqlRequest, "expected a GraphQL request");

const sentQuery = String((graphqlRequest.body as { query?: string }).query ?? "");
for (const line of sentQuery.trim().split("\n")) console.log(`      ${line}`);

// The selection set is the response schema's fields, not a hand-kept list.
for (const field of ["id", "name", "email"]) {
  assert.match(sentQuery, new RegExp(`\\b${field}\\b`), `query must select ${field}`);
}

// ── 3. Errors normalize across every wire ────────────────────────────────────
// This is the part that earns the abstraction. Three completely different
// failure shapes — an HTTP 404 with a JSON body, a GraphQL 200 carrying
// `extensions.code`, and a Connect error body — land as one `kind`, so an app's
// "show a not-found page" branch is written once.
console.log("\n[3] one error kind from three failure shapes");

const failures = await Promise.all([
  kindOf(() => user.getUser({ path: { id: "999" } })),
  kindOf(() => user.profile({ id: "999" })),
  kindOf(() => user.syncUser({ id: "999" })),
]);

for (const [label, failure] of [
  ["http    404 + { message }        ", failures[0]],
  ["graphql 200 + extensions.code    ", failures[1]],
  ["grpc    404 + { code: not_found }", failures[2]],
] as const) {
  console.log(`      ${label} → kind "${failure.kind}"`);
}

for (const failure of failures) {
  assert.equal(failure.kind, "not_found", "every wire must normalize to not_found");
}

// ── 4. Tooling reads the route through the transport, never off the endpoint ──
// `method` and `path` exist only on http endpoints. Anything that prints a
// route — the CLI, a lint rule, a devtools row — has to ask the adapter, which
// is why `describe()` is part of the seam.
console.log("\n[4] describe(), the same question answered by three adapters");
for (const id of ["user.getUser", "user.profile", "user.syncUser"] as const) {
  console.log(`      ${describeRoute(id)}`);
}

const grpcRoute = client.describe(contracts.user.syncUser);
assert.equal(grpcRoute.protocol, "gRPC");
assert.equal(grpcRoute.target, "user.v1.UserService/GetUser");

await server.close();
console.log("\nAll assertions passed.");

/* ── helpers ─────────────────────────────────────────────────────────────── */

function describeRoute(id: "user.getUser" | "user.profile" | "user.syncUser"): string {
  const [, member] = id.split(".") as [string, keyof typeof contracts.user];
  const route = client.describe(contracts.user[member]);
  return `${id.padEnd(14)} ${route.protocol.padEnd(8)} ${route.operation.padEnd(6)} ${route.target}`;
}

async function kindOf(call: () => Promise<unknown>): Promise<RichError> {
  try {
    await call();
    throw new Error("expected the call to fail");
  } catch (error) {
    assert.ok(error instanceof RichError, "every transport must fail with a RichError");
    return error;
  }
}
