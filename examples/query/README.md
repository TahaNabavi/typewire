# query

The query layer end to end, on one contract: `useQuery` / `useMutation` over
HTTP **and** WebSocket, with the devtools panel showing both in one timeline.

```bash
pnpm --filter @typewire-examples/query dev     # React app on http://127.0.0.1:5274
pnpm --filter @typewire-examples/query start   # headless, asserts and exits
```

No server and no network: both clients answer through
`instrument({ resolveOverride })` — the same seam a devtools panel uses to force
a mock, an error or latency at runtime. That keeps the example about the query
layer rather than about transport setup.

## Layout

```txt
shared/contracts.ts   the Zod contracts — HTTP and WS
shared/stack.ts       wires clients, bridge and QueryClient once
client/               the React app: hooks + devtools panel
headless/main.ts      the same stack with no UI, asserting as it runs
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

## Why it is also a test

`pnpm test` runs `headless/main.ts`, which asserts every step with
`node:assert`. A package change that breaks the behaviour turns the build red
instead of quietly rotting an example nobody runs — and because it shares
`createStack()` with the app, the assertions cover the app's wiring too.
