import assert from "node:assert/strict";
import { selectEntries } from "@tahanabavi/type-devtools-core";
import { createStack } from "../shared/stack.js";

/**
 * The same wiring the React app uses, driven without a UI — and it asserts as
 * it goes, because `pnpm test` runs this file. An example that only prints can
 * drift from the packages it demonstrates without anyone noticing; one that
 * fails the build cannot.
 */
const { client, bridge, socket, getUser, updateUser, sendMessage } = createStack();

const httpCalls = (label: string) =>
  bridge.getSnapshot().filter((e) => e.kind === "start" && e.label === label).length;

// ── 1. Deduplication ─────────────────────────────────────────────────────────
const [a, b] = await Promise.all([
  client.fetchQuery(getUser, { path: { id: "1" } }),
  client.fetchQuery(getUser, { path: { id: "1" } }),
]);
console.log("[1] two concurrent reads →", httpCalls("user.getUser"), "request");
assert.equal(httpCalls("user.getUser"), 1, "concurrent reads must share one request");
assert.deepEqual(a, b);

// ── 2. Cache hit ─────────────────────────────────────────────────────────────
await client.fetchQuery(getUser, { path: { id: "1" } }, { staleTime: 60_000 });
console.log("[2] fresh read served from cache →", httpCalls("user.getUser"), "request");
assert.equal(httpCalls("user.getUser"), 1, "fresh data must not refetch");

// ── 3. A watcher, and automatic invalidation ─────────────────────────────────
// `watchQuery` is exactly what `useQuery` wraps — the React hook adds binding,
// not behaviour.
const observer = client.watchQuery(getUser, { path: { id: "1" } }, {
  staleTime: 60_000,
});
observer.subscribe(() => {});
await waitFor(() => observer.getSnapshot().isSuccess);
console.log("[3] watching user.getUser → version", observer.getSnapshot().data?.version);
assert.equal(observer.getSnapshot().data?.version, 1);

await client.watchMutation(updateUser).mutateAsync({
  path: { id: "1" },
  body: { name: "Taha Nabavi" },
});
// The mutation named no query. The relation did, once, at setup.
await waitFor(() => observer.getSnapshot().data?.version === 2);
console.log(
  "[3] after updateUser → version",
  observer.getSnapshot().data?.version,
  `(${observer.getSnapshot().data?.name})`,
);
assert.equal(observer.getSnapshot().data?.name, "Taha Nabavi");

// ── 4. The same engine over WebSocket ────────────────────────────────────────
// An acked `client->server` event is request/response shaped, so it caches like
// any endpoint. typesocket calls its id `eventId` and typefetch calls it
// `endpointId`; the engine accepts either.
const ack = await client.fetchQuery(sendMessage, { text: "hello" });
console.log("[4] ws ack cached →", ack);
assert.equal(client.cache.find({ endpointId: "chat.sendMessage" }).length, 1);
assert.deepEqual(client.getQueryData(sendMessage, { text: "hello" }), ack);

// ── 5. One timeline ──────────────────────────────────────────────────────────
const entries = selectEntries(bridge.getSnapshot());
console.log("\n  timeline");
for (const entry of entries) {
  const duration =
    entry.durationMs === undefined ? "" : ` ${entry.durationMs.toFixed(1)}ms`;
  console.log(
    `  ${entry.source.padEnd(4)} ${entry.label.padEnd(18)} ${entry.status}${duration}`,
  );
}

const sources = new Set(entries.map((e) => e.source));
assert.ok(sources.has("http") && sources.has("ws"), "both transports in one log");
assert.ok(
  entries.every((e) => e.status === "success"),
  "every call should have completed",
);

observer.destroy();
socket.destroy();
console.log("\n[done] all assertions passed");

/** Poll until `predicate` holds; the engine settles over several microtasks. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
