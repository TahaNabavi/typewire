# @tahanabavi/type-devtools-core

![type-devtools-core — transport-agnostic inspector bridge: one timeline for HTTP and WS, with runtime overrides](./docs/assets/type-devtools-core-banner.png)

The **transport-agnostic** core the TypeWire inspector is built on: one timeline
for REST, GraphQL, gRPC **and** WebSocket, a runtime override registry, and a
live mirror of a query cache. Headless and **dependency-free** — it stores
generic events and types every client structurally, so it imports neither
typefetch nor typesocket nor the query engine.

Pair it with [`@tahanabavi/type-devtools`](../devtools) for the React panel, or
render its snapshots yourself.

```bash
pnpm add @tahanabavi/type-devtools-core
```

## The bridge

`InspectorBridge` is the store: one ring buffer of source-tagged events plus an
override registry keyed by `(source, label)`. Each transport plugs in as a
`connect*` call — that's what lets one timeline hold both without a branch per
transport:

```ts
import {
  InspectorBridge,
  connectTypeFetch,
  connectTypeSocket,
  selectEntries,
} from '@tahanabavi/type-devtools-core'

const bridge = new InspectorBridge() // { limit } — default 500 events
connectTypeFetch(apiClient, bridge) // typefetch: REST, GraphQL, gRPC
connectTypeSocket(socketClient, bridge) // typesocket: WebSocket

// A start+success (or outbound+ack) pair collapses into one entry per call.
// Pass the progress store too, to join live transfers onto the rows.
const entries = selectEntries(
  bridge.getSnapshot(),
  bridge.getProgressSnapshot()
)
```

`bridge.subscribe` / `getSnapshot` implement the `Observable` contract, so a
panel binds it with `useSyncExternalStore` directly.

### `source` is the client; `transport` is the wire

One typefetch client now speaks REST, GraphQL and gRPC, so those two stopped
being the same thing:

|             | means                                                                                  | on an entry                         |
| ----------- | -------------------------------------------------------------------------------------- | ----------------------------------- |
| `source`    | which **client** produced it — `http` (typefetch) or `ws` (typesocket)                 | always present                      |
| `transport` | which **wire** carried it — `http`, `graphql`, `grpc`, or a third-party adapter's name | present when the client reports one |

The distinction is load-bearing rather than pedantic. `source` is the key space
for overrides and correlation ids, so it must stay stable per client — an
override registered under `"graphql"` would never match, because the connector
that resolves it is typefetch's. Show `transport` in a UI; key on `source`.

A client older than the transport registry reports no wire, and every call it
could make was HTTP — so `connectTypeFetch` fills in `http` rather than leaving
a blank that would read as "unknown".

### Normalized failures

`entry.errorKind` carries typefetch's `ErrorKind`, hoisted out of the error so a
panel never reaches into a transport-specific body. `404`, gRPC code `5` and
GraphQL `extensions.code: "NOT_FOUND"` all arrive as `not_found` — which is what
makes a mixed timeline readable, since gRPC and GraphQL carry no HTTP status at
all.

### Transfer progress

Progress ticks are stored **latest-only, outside the event log**: a single large
upload emits continuously, and appending each tick would evict a whole session's
history from the ring buffer within one request.

```ts
bridge.getProgressSnapshot() // ReadonlyMap<`${source}:${id}`, InspectorProgress>
```

Both stores publish through the one `subscribe`, so a panel binds either or both.
An entry's progress is released the moment its call concludes, which is what
keeps the map bounded over a long session.

## Overrides

The override registry steers **every future call** of an endpoint/event — no code
change at the call site, no touching the contract. The connectors translate a
generic override into each transport's own shape (a typefetch `mock`/`error`, a
typesocket `drop`):

```ts
bridge.setOverride('http', 'user.getUser', {
  mock: { id: '1', name: 'Forced' },
})
bridge.setOverride('http', 'user.getUser', { latencyMs: 2000 })
bridge.setOverride('ws', 'chat.sendMessage', { drop: true })

bridge.listOverrides() // render the panel's active-overrides strip
bridge.removeOverride('http', 'user.getUser')
```

## Query cache

The timeline is an append-only log; a query cache is a _set of stateful
entities_, so it gets its own store. `connectQueryClient` subscribes to the
engine's event bus, re-reads the authoritative query list, and exposes the three
actions a cache view offers:

```ts
import { connectQueryClient } from '@tahanabavi/type-devtools-core'

const queries = connectQueryClient(queryClient) // a QueryInspector
queries.getSnapshot() // { queries: [...], mutations: [...] }
queries.refetch(query) // refetch / invalidate / remove by { endpointId, input }
queries.dispose() // detach (the timeline connectors return a detach fn instead)
```

The client is typed structurally as `QueryClientLike`, so attaching it adds no
dependency on the query engine.

## Exports

`InspectorBridge` · `selectEntries` · `connectTypeFetch` · `connectTypeSocket` ·
`QueryInspector` · `connectQueryClient`, plus the `InspectorEvent` /
`InspectorEntry` / `InspectorOverride` / `InspectorProgress` / `QuerySnapshot` /
`QueryInspectorSnapshot` types.

## License

[MIT](../../LICENSE) © Taha Nabavi
