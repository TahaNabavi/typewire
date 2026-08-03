# query

The query layer end to end, on one contract: `useQuery` / `useMutation` over
HTTP **and** WebSocket, with the devtools panel showing both in one timeline.

```bash
pnpm --filter @typewire-examples/query dev     # React app on http://127.0.0.1:5274
pnpm --filter @typewire-examples/query start   # headless, asserts and exits
```

Almost no server and almost no network: the user and chat endpoints answer
through `instrument({ resolveOverride })` — the same seam a devtools panel uses
to force a mock, an error or latency at runtime. That keeps the example about the
query layer rather than about transport setup.

The exception is the `media` module. A progress bar is a property of bytes
actually moving, and an override resolves *before* the transport runs, so upload
and download are served for real — by a Vite plugin in the browser, by a
`node:http` server in the headless run. Both mount the same handler.

## Layout

```txt
shared/contracts.ts    the Zod contracts — HTTP and WS
shared/stack.ts        wires clients, bridge and QueryClient once
shared/media-server.ts the one real endpoint pair: upload + download
client/                the React app: hooks + devtools panel
headless/main.ts       the same stack with no UI, asserting as it runs
```

`client/` and `headless/` import the *same* `createStack()`, so the UI
demonstrates the wiring rather than re-declaring a second version of it that can
drift.

## What the React app shows

| In the UI | Point |
| --- | --- |
| The `fresh` / `stale` / `fetching` badge | `useQuery` exposes fetch state separately from data state, so a background refetch does not blank the screen. |
| Switching **user 1 / user 2** | One cache entry per input. Coming back to a user inside `staleTime` renders with no request. |
| **rename** → `version` climbs | A mutation invalidated the query and it refetched itself. The component names no key. |
| The **ws** card | The same `useMutation`, over a socket event. |
| The **upload** bar | `trackProgress` puts transfer progress in the mutation's own state — no `useState`, no second hook. |
| **download it back** | `responseType: "file"` hands back `{ blob, filename, contentType, size }`, filename already parsed from `Content-Disposition`. |
| The panel at the bottom | HTTP and WS rows in one timeline, tagged by source. |

## The two ideas worth stealing

**Invalidation is declared once, at the setup site:**

```ts
const client = new QueryClient({
  relations: { "user.updateUser": ["user.getUser"] },
});
```

Nothing downstream mentions a key. `endpointId` (`"module.endpoint"`) *is* the
key, and the engine derives the rest — so a mutation and the queries it
invalidates can never drift apart the way hand-written keys do.

**WebSocket is not a special case.** typefetch names its id `endpointId` and
typesocket names it `eventId`; the engine reads either, so an acked event is
just another cacheable source:

```ts
const send = useMutation(socket.modules.chat.sendMessage);
```

Fire-and-forget emits and `server->client` listeners are deliberately *not*
queryable — they return `void` or are push, so they belong on the timeline
rather than in a cache.

## Progress, and where it does not work

```tsx
const upload = useMutation(stack.upload, { trackProgress: "upload" });

<progress value={upload.progress?.upload?.percent ?? 0} max={100} />;
```

`fetch` has **no upload-progress API**, so passing an upload-progress handler is
what moves that one request onto `XMLHttpRequest`. Middleware is unaffected — it
still receives the same context and is still handed a `Response`.

Which means **the headless run cannot demonstrate upload progress**: Node has no
`XMLHttpRequest`. Rather than hide that, `headless/main.ts` asserts it —

```ts
assert.equal(uploadTicks.length, 0,
  "Node has no XMLHttpRequest, so upload progress cannot be reported");
```

— and the client prints a one-time warning, so a silent zero is never mistaken
for a stalled upload. The upload itself still succeeds over `fetch`. Download
progress has no such constraint: it counts bytes off `res.body`, so it works in
both places, and the headless run asserts it reaches 100%.

`percent` is `undefined` whenever the length is unknown — a download whose
`Content-Length` is missing, or cross-origin not listed in
`Access-Control-Expose-Headers`. The UI renders that as an indeterminate bar
rather than 0%, which is why `shared/media-server.ts` sets both
`Content-Disposition` and `Content-Length` **and** exposes them.

## Why it is also a test

`pnpm test` runs `headless/main.ts`, which asserts every step with
`node:assert`. A package change that breaks the behaviour turns the build red
instead of quietly rotting an example nobody runs — and because it shares
`createStack()` with the app, the assertions cover the app's wiring too.
