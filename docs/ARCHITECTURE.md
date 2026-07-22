# TypeWire — architecture

This monorepo (**TypeWire**) hosts several small packages that share one idea:
define your API as strongly-typed **contracts** once, then build everything else
on top. Packages ship under the `@tahanabavi/*` npm scope.

## The three design laws

1. **The contract is untouched.** Cache/query/devtools concerns never add
   parameters to the transport contract (`method/path/request/response/errors/…`).
2. **The daily call site is frozen.** Consumers use only `useQuery(endpoint, input)`
   and `useMutation(endpoint)`. New features go to the **setup site**
   (`createTypeFetchQuery(client, { … })`) as independent, optional keys — never as
   new params on the daily call.
3. **Features are independent modules on an event bus.** The engine exposes
   `cache API + observable contract`. Invalidation, devtools, persistence each
   subscribe. Adding a feature = a new module, not a change to the core.

DX north star: automatic type-safe query keys (`endpointId` + hashed input) and
automatic invalidation declared once — no hardcoded keys.

## Layers

```txt
transport clients          higher-level tools
──────────────────         ────────────────────────────────
typefetch   (HTTP)  ─┐
                     ├─►  typefetch-query-core  ─►  typefetch-react
typesocket  (WS)   ──┘         (fetch data layer)      (React adapter)

         both feed  ─►  type-devtools-core  ─►  type-devtools
                          (generic bridge)        (React panel)
```

### Upstream seam (`typefetch` v1.7.0 · `typesocket` v2.0.0)

The query and devtools layers build on two additive hooks **both** transport
clients ship, deliberately shaped the same way:

- **Endpoint metadata** — every generated member carries a stable
  `"module.endpoint"` id (`.endpointId` in typefetch, `.eventId` in typesocket)
  plus the contract def (`.endpoint` / `.def`).
- **Instrumentation** — `client.instrument({ on, resolveOverride })` emits
  structured lifecycle events with parsed I/O and resolves per-frame overrides.
  Zero-cost when unused.

| | `typefetch` | `typesocket` |
| --- | --- | --- |
| Id | `.endpointId` | `.eventId` |
| Events | `start` · `success` · `error` | `outbound` · `ack` · `inbound` · `dropped` · `frame_error` (+ connect/disconnect) |
| Correlation | `requestId` | `frameId` |
| Overrides | mock · error · latency · schema swap | ack · drop · error · latency · payload · schema swap |

The query engine keys its cache by that id + input. The devtools bridge attaches
one instrumentation hook per source.

Because typesocket events declare their `direction` rather than inheriting it
from which map they were passed in, one contract object also serves the server:
`@tahanabavi/typewire-nestjs` reads `client->server` as inbound handlers and
`server->client` as outbound emits, from the same file the client imports.

## Transport-agnostic devtools (why the split)

`type-devtools-core` knows nothing about HTTP or WS. It defines a generic
`InspectorEvent { source, kind, id, ts, payload }` and an override registry keyed
by `(source, id)`. Each transport plugs in as a **Source**:

- `connectTypeFetch(client, bridge)` maps `RequestEvent` → `InspectorEvent` and
  generic overrides → typefetch `Override`.
- `connectTypeSocket(socket, bridge)` (later) maps WS frames → `InspectorEvent`
  and WS overrides (inject / drop / delay a message).

The React panel (`type-devtools`) renders any bridge and tags each row by source,
so adding typesocket is a drop-in second source — no refactor.

## Reactivity contract (framework-agnostic)

Everything the UI reads implements one interface:

```ts
interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}
```

Adapters bind it natively: React → `useSyncExternalStore`; Vue → `shallowRef` +
`onScopeDispose`; Angular → signals / RxJS. The core never imports a framework.

## Build order

`pnpm -r` runs in topological order. `typefetch` and `typesocket` build first,
then `query-core` / `devtools-core`, then `react` / `devtools`.
