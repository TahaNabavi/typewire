import assert from "node:assert/strict";
import { createServer } from "node:http";
import { selectEntries } from "@tahanabavi/type-devtools-core";
import { handleMedia } from "../shared/media-server.js";
import { createStack } from "../shared/stack.js";

/**
 * The same wiring the React app uses, driven without a UI — and it asserts as
 * it goes, because `pnpm test` runs this file. An example that only prints can
 * drift from the packages it demonstrates without anyone noticing; one that
 * fails the build cannot.
 */

// The `media` endpoints are the only ones that reach the network; everything
// else is answered by an override. Port 0 lets the OS pick a free one, so this
// never collides with the dev server or a second copy of the run.
const media = createServer((req, res) => {
  void handleMedia(req, res).then((handled) => {
    if (!handled) res.writeHead(404).end();
  });
});
const mediaPort = await new Promise<number>((resolve) => {
  media.listen(0, "127.0.0.1", () => {
    const address = media.address();
    resolve(typeof address === "object" && address ? address.port : 0);
  });
});

const { client, bridge, socket, getUser, updateUser, sendMessage, upload, download } =
  createStack({ baseUrl: `http://127.0.0.1:${mediaPort}` });

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

// ── 5. Response types and transfer progress ──────────────────────────────────
// The only endpoints here that touch the network. Progress is a property of
// bytes actually moving, so it cannot be shown through an override.

const payload = new Blob([Buffer.alloc(64 * 1024, 7)], {
  type: "application/octet-stream",
});
const file = new File([payload], "report.bin", {
  type: "application/octet-stream",
});

const uploadTicks: number[] = [];
const stored = await upload(
  { body: { file } },
  { onUploadProgress: (p) => uploadTicks.push(p.loaded) },
);
console.log(`[5] uploaded ${stored.bytes} bytes as ${stored.id}`);
assert.ok(stored.bytes > 0, "the server should have received the body");

// The documented boundary, asserted rather than described: `fetch` has no
// upload-progress API, so typefetch routes these requests through
// `XMLHttpRequest` — which Node does not have. The request still succeeds; the
// handler is simply never called, and the client warns once. In a browser this
// same call drives a progress bar.
assert.equal(
  uploadTicks.length,
  0,
  "Node has no XMLHttpRequest, so upload progress cannot be reported",
);
console.log("[5] upload progress ticks in Node →", uploadTicks.length, "(expected: browser only)");

// Download progress needs none of that: it counts bytes off `res.body` on the
// normal fetch path, so it works here.
const downloadTicks: Array<{ loaded: number; percent?: number }> = [];
const got = await download(
  { path: { id: stored.id } },
  { onDownloadProgress: (p) => downloadTicks.push({ loaded: p.loaded, percent: p.percent }) },
);

// `responseType: "file"` decoded the body as a Blob and read the filename off
// Content-Disposition — neither is something the call site had to do.
console.log(
  `[5] downloaded "${got.filename}" — ${got.size} bytes, ${downloadTicks.length} progress ticks`,
);
assert.equal(got.filename, "report.bin", "filename comes from Content-Disposition");
assert.equal(got.size, stored.bytes, "the round trip should preserve every byte");
assert.ok(got.blob instanceof Blob, "responseType: 'file' decodes to a Blob");
assert.deepEqual(
  new Uint8Array(await got.blob.arrayBuffer()),
  new Uint8Array(await file.arrayBuffer()),
  "the bytes that came back should be the bytes that went up",
);
assert.ok(downloadTicks.length > 0, "download progress runs on the fetch path");
assert.equal(
  downloadTicks[downloadTicks.length - 1]?.percent,
  100,
  "Content-Length was exposed, so the last tick should be 100%",
);

// ── 6. One timeline ──────────────────────────────────────────────────────────
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
await new Promise<void>((done) => media.close(() => done()));
console.log("\n[done] all assertions passed");

/** Poll until `predicate` holds; the engine settles over several microtasks. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
