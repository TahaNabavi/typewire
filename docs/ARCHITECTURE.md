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
wire adapters          contract clients         higher-level tools
─────────────          ────────────────         ────────────────────────────────
typefetch-grpc     ─┐
typefetch-graphql  ─┼─► typefetch  (HTTP+) ─┐
   http (built in) ─┘                       ├─► typefetch-query-core ─► typefetch-react
                        typesocket  (WS)  ──┘      (fetch data layer)     (React adapter)

                             both feed  ─►  type-devtools-core  ─►  type-devtools
                                              (generic bridge)        (React panel)

                    the same contracts, served ─►  typewire-nestjs
                                                   (http · grpc · graphql · ws)
```

Transports plug into `typefetch` from the outside (v2.0.0). The core ships the
`http` adapter and **zero runtime dependencies**; gRPC and GraphQL are separate
installs that merge themselves into an open `TransportRegistry`, so a transport's
contract fields only typecheck once its package is a dependency. Registration is
explicit at the setup site, so unused transports tree-shake out.

Crucially `endpointId` does not vary by transport — which is why query-core and
devtools-core consume every wire without knowing any of them exist.

### Tooling reads the contract too (`typewire-cli`)

`@tahanabavi/typewire-cli` is a devDependency, never a runtime one: the same
rule as adapters — anything needing a dependency ships separately, and a
TypeScript loader has no business in a browser bundle.

It reads one `typewire.config.ts` with a section per package, because a CLI over
contract-first code cannot take its input on the command line — a Zod schema is
not a flag, so the tool has to import the project's own code. `contracts` is the
only always-required key; a client is demanded by the commands that actually
make requests, so `list` (and later `lint`, `diff`, `explain`) run against a
contract file with no API reachable.

Two consequences worth stating, because both are seams rather than conveniences:

- **`transports` is declared to the config, not derived from a client.** Tooling
  must ask the adapter to describe a route — `method` and `path` exist only on
  http endpoints — and no contracts-only command has a client to ask.
- **`projects` is a list of API surfaces**, not of packages. A repo with
  `dashboard`, `admin` and `landing` APIs declares three, each with its own
  contracts, client and baseline. A single-API config resolves to one *implicit*
  project, so commands never branch on which shape was written.

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

### The server side of the transport seam

`@tahanabavi/typewire-nestjs` serves every wire the clients speak, and mirrors
the client's rules rather than inventing its own:

- **A wire is bound explicitly, per decorator, per entry point** —
  `@TypeFetchEndpoint()` (http), `@GrpcEndpoint()`, `@GraphQLEndpoint()`,
  `@SocketEvent()`. That mirrors registering an adapter at the setup site: if a
  server could silently serve a transport the client never registered, the two
  halves of one contract could disagree about which wire they are on.
- **A transport-specific field is never read blind.** `endpoint.method` does not
  exist on a gRPC route, so anything naming a route goes through
  `describeContractRoute()` — the server's counterpart to the adapter's
  `describe()` seam.
- **A failure is named in its own wire's key space**, because that is what the
  contract's `errors` map is keyed by: an HTTP status, a gRPC code, a GraphQL
  `extensions.code`. The client normalizes all three back to one `ErrorKind`.
- **Two of the wires need no runtime.** Connect's JSON protocol is an HTTP POST,
  so gRPC is served with no protobuf; and because the GraphQL transport
  *generates* its document from the endpoint's `response` schema, an operation
  can be addressed by name and answered from that same schema — with no GraphQL
  engine. The cost is that it serves contracts rather than arbitrary documents;
  `packages/nestjs/README.md` marks the line.

The `{ path, query, body, headers }` split stops at HTTP. It exists because a
URL has those parts; a unary RPC and a GraphQL operation each carry exactly one
message, so for them the whole request is the body.

## Transport-agnostic devtools (why the split)

`type-devtools-core` knows nothing about any wire. It defines a generic
`InspectorEvent { source, transport, kind, id, ts, payload }` and an override
registry keyed by `(source, label)`. Each **client** plugs in as a connector:

- `connectTypeFetch(client, bridge)` maps `RequestEvent` → `InspectorEvent` and
  generic overrides → typefetch `Override`.
- `connectTypeSocket(socket, bridge)` maps WS frames → `InspectorEvent` and WS
  overrides (inject / drop / delay a message).

The React panel (`type-devtools`) renders any bridge, so adding typesocket is a
drop-in second connector — no refactor.

### `source` and `transport` are different axes

They were the same thing until typefetch grew a transport registry. Now one
client speaks REST, GraphQL and gRPC, so:

- **`source`** is which *client* produced the event — `"http"` (typefetch),
  `"ws"` (typesocket). It is the key space for overrides and correlation ids, so
  it must stay stable per client.
- **`transport`** is which *wire* carried the call — `"http"`, `"graphql"`,
  `"grpc"`, or a third-party adapter's `kind`. It is what a UI shows.

Collapsing them would break silently rather than loudly: the connector that
resolves an override for a GraphQL endpoint is typefetch's and asks for
`getOverride("http", …)`, so an override registered under `"graphql"` would be
accepted, listed, and never match anything.

For the same reason `errorKind` — typefetch's normalized `ErrorKind` — is
hoisted onto the entry. `status` is meaningful on exactly one of the three wires
typefetch speaks, so it is the only field a mixed timeline can rely on to say
what went wrong.

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
