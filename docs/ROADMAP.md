# TypeWire — pluggable packages roadmap

The sequencing across [`TRANSPORTS.md`](../packages/typefetch/docs/TRANSPORTS.md)
and [`CLI.md`](./CLI.md). One package at a time; each row is done only when
`pnpm -r build && typecheck && test` is green, the package README is written, and
a changeset exists.

The organising rule, applied everywhere: **anything that needs a dependency ships
as its own package.** The core is the runtime and nothing else.

---

## Status

| # | Unit | State |
| --- | --- | --- |
| 0 | Core types — transport registry, `ErrorKind`, `errorKey` | **done** |
| 0b | Input validation classified like output validation | **done** |
| 1 | Core seam — `TransportAdapter` + built-in http adapter | **done** |
| 1b | `driver: "auto" \| "fetch" \| "xhr"` + `resolveDriver` on the seam | **done** |
| 1c | CI — gzipped size budget, zero-dep assertion, Node/Bun/Deno matrix | **done** |
| 2 | `@tahanabavi/typefetch-graphql` | **done** — needed zero core changes |
| 3 | `@tahanabavi/typefetch-grpc` | **done** |
| 3b | Connect conformance runner in CI | **open** — see below |
| 4 | `@tahanabavi/typefetch-encryption` — core reaches zero dependencies | **done** |
| 5a | `@tahanabavi/typewire-cli` — the move, byte-for-byte | **done** |
| 5b | `typewire.config.ts` + `defineConfig` + `extends` + tsconfig `paths` | **done** |
| 5c | `typewire init` — detect the project, ask, scaffold | **done** |
| 5c+ | `release-doc` implemented — it was in `--help` but had no case | **done** |
| 5d | `snapshot` · `diff` · `lint` · `doctor` · `explain` · `mock` · `generate` | planned |
| 6 | `@tahanabavi/typewire-codemod` — the migration for everything above | |
| 7 | Rename the five unpublished packages (see below) | |
| 8 | Downstream packages (query-core, devtools, nestjs, react) | in progress |
| 8a | `devtools-core` + `devtools` — transport, `errorKind`, progress | **done** |
| 8b | `nestjs` — gRPC, GraphQL and typesocket gateways served from one contract | **done** |
| 8c | query-core seams — `gate` · `sources` · `updatedAt` · `reason` | planned — [`SYNC.md`](./SYNC.md) §9 |
| 9 | Examples updated to the v2 shape | **done** — new `transports` example |
| 10 | `@tahanabavi/typewire-sync` — mirror · lock · leader, across browser tabs | planned — [`SYNC.md`](./SYNC.md) |
| 11 | Standard Schema accepted wherever a contract takes a schema | planned — [`SCHEMA.md`](./SCHEMA.md) |
| 12 | `@tahanabavi/typefetch-sse` — typed SSE and HTTP streaming | planned — [`SSE.md`](./SSE.md) |
| 13 | `@tahanabavi/typewire-offline` — persisted cache + mutation outbox | planned — [`OFFLINE.md`](./OFFLINE.md) |
| 14 | `typewire generate mcp` — contracts as agent tools | planned — [`MCP.md`](./MCP.md) |

The core is at **zero runtime dependencies**, asserted in CI by
`scripts/assert-no-deps.mjs` rather than claimed in a README. `pnpm verify` runs
build + typecheck + test + size budget + dependency assertion + cross-runtime
smoke in one command.

### Sequencing — what is next, and why in that order

The table above is numbered in the order things were **built**. This is the order
to build what is left, and two rules decide it: a change that unblocks two
packages ships before either of them, and a breaking change ships as early as it
can, because every package written after it is one that never has to be migrated.

| # | Unit | Why here |
| --- | --- | --- |
| 1 | **8c** — query-core seams | Four additive hooks, no behaviour change. Rows 10 and 13 need all four, so they land once, first, as their own release |
| 2 | **10** — `typewire-sync` | The gap users hit first and the one nothing else covers. M3 (`createTabSync`) is shippable alone, so a slip costs nothing already shipped |
| 3 | **11** — Standard Schema | Its additive half (S1–S4) blocks nothing and should start now; only S5 breaks, and typefetch 2.0.0 is already on npm, so that half is a **v3** with a real migration. Every release that ships zod-only widens it, which is the argument for starting early even though the free window closed |
| 4 | **12** — `typefetch-sse` | Its contracts declare a schema per event, so it is written vendor-neutral from the start if 11 is already in. Also the first core-seam change since the transport registry, and it wants a quiet moment |
| 5 | **13** — `typewire-offline` | Needs 8c *and* the leader primitive from 10. Building it earlier means building half of 10 twice |
| 6 | **5d** — `snapshot` + `diff` | The enterprise gate, and independent of everything above — which is exactly why it can wait without blocking anything |
| 7 | **5d** — `lint` · `doctor` · `explain` · `mock` · `generate openapi` | `mock` wants the JSON Schema walker that 11 produces; writing it first means writing it twice |
| 8 | **14** — `generate mcp` | Shares the `generate` scaffold with `openapi`, and its tool descriptions come out better once 11's ladder exists |
| 9 | `type-permission` client pre-flight + Vue/React recipes | Small, self-contained, nothing depends on it |
| 10 | `typewire-vue` / `typewire-angular` | The `Observable` seam already exists; these are adapters, not design work |
| 11 | **3b** — Connect conformance | An honest gap with nothing waiting on it. Last is where it belongs, not hidden |

**The launch-readiness section below is history, not a plan.** All twelve
packages are on npm — `typefetch` 2.0.0, `typesocket` 2.2.0, `typewire-nestjs`
4.0.0, and the five that were waiting at `0.0.0` shipped under the names they
had. The three open decisions were answered by publishing, and step 7's renames
were answered by default: `type-devtools`, `type-devtools-core`,
`type-permission`, `typefetch-query-core` and `typefetch-react` are now names
with users behind them. Renaming them means deprecated aliases and a major
each — so that row needs re-deciding as *whether*, not *when*.

`type-opengraph` was dropped from the roadmap. It was the one planned package
that shared nothing with the rest: no contract, no transport, no `endpointId` —
a metadata scraper that happened to be typed. Everything above earns its place by
consuming the same contract object; that one did not.

### 9 — what the examples proved

The three existing examples typechecked against v2 **untouched**, which is the
result step 1 was designed for: the seam landed with no behaviour change, and
`endpointId` never moved.

The gap was the other direction — the headline feature had no example at all.
`examples/transports` now runs REST, GraphQL and gRPC against one hand-written
`node:http` server, asserts that all three return the same value and that all
three failure shapes normalize to one `ErrorKind`, and prints the GraphQL
document generated from the zod schema. It is headless and self-asserting, so
`pnpm test` covers it.

Writing it surfaced a real gap: `typewire list` printed `?` for every non-http
route, because the CLI holds contracts but no adapters. Fixed with
`typefetch.transports` — see the changeset.

### 3b — why conformance is still open

Connect's conformance runner drives a client under test over **length-prefixed
protobuf on stdin/stdout**. Speaking that harness protocol needs a protobuf
runtime — the exact dependency the `GrpcCodec` seam exists to avoid shipping.

It is still the right thing to do, as a CI-only harness with `@bufbuild/protobuf`
as a dev dependency (dev deps do not ship, so the guarantee holds). It is not
done, and it is not half-done: writing an unverified workflow that *claims*
conformance would be worse than the honest gap. The 36 tests in `packages/grpc`
cover the protocol surface we actually implement — URL shape, protocol-version
header, both deadline spellings, code↔status↔kind mapping in both directions,
framing, trailers, trailers-only, and the CORS-hidden-trailer case.

### Launch readiness

Documentation is complete against the `AGENTS.md` checklist for everything this
work added:

| Package | README | Release doc | Banner | Changeset |
| --- | --- | --- | --- | --- |
| `typefetch` | ✓ | `v2.0.0.md` | ✓ | major |
| `typefetch-graphql` | ✓ | `v0.1.0.md` | ✓ | minor |
| `typefetch-grpc` | ✓ | `v0.1.0.md` | ✓ | minor |
| `typefetch-encryption` | ✓ | `v0.1.0.md` | ✓ | minor |
| `typewire-cli` | ✓ | `v0.1.0.md` | ✓ | minor |
| `type-devtools-core` | ✓ | `v0.1.0.md` | ✓ | minor |
| `type-devtools` | ✓ | `v0.1.0.md` | ✓ | minor |
| `typewire-nestjs` | ✓ | `v0.2.0.md` | ✓ | minor |

**Three decisions are still open, and they are the user's to make**, because
they decide what actually gets published:

1. `query-core` and `react` carry a pending **minor** with no `docs/releases/`
   file. `AGENTS.md` requires one for every minor. (`devtools-core` was in this
   list until step 8a, which wrote one; `nestjs` until 8b, which had a release
   doc but no changeset at all — so its permission guard would not have shipped
   either. 8b wrote the changeset and folded both stories into `v0.2.0.md`.)
2. `permission` has **no changeset at all**, so `changeset version` will not
   bump it off `0.0.0` and `changeset publish` will not publish it. Either it is
   out of the first launch, or it needs one.
3. Step 7 (renaming the five `0.0.0` packages off their stray `type-` /
   `typefetch-` prefixes) is still unscheduled. It is free *now* and expensive
   after the first publish, so it belongs before launch or never. The two
   devtools packages are among the five, so their new release docs and banners
   would need the name swapped with them.

---

## Naming

**The prefix says what a package plugs into.** An adapter implements typefetch's
`TransportAdapter`, so it carries typefetch's name. A tool that reads
`typewire.config.ts` and covers every package carries TypeWire's.

| Package | Prefix | Why |
| --- | --- | --- |
| `typefetch-graphql` · `-grpc` · `-encryption` | `typefetch-` | plug into typefetch specifically |
| `typewire-cli` (bin `typewire`) · `typewire-codemod` | `typewire-` | one config, one lockfile, every package |
| `typewire-query-core` · `typewire-devtools-core` | `typewire-` | already accept typefetch **and** typesocket sources |
| `typewire-permission` · `typewire-devtools` · `typewire-react` | `typewire-` | family-wide, transport-agnostic by design |
| `typewire-sync` · `typewire-offline` | `typewire-` | coordinate every package's traffic in one browser; they speak no wire of their own |
| `typefetch-sse` | `typefetch-` | another `TransportAdapter`, like `-graphql` and `-grpc` |

The three published packages keep their names: `typefetch` (1.7.1), `typesocket`
(2.0.0), `typewire-nestjs` (0.1.1). The five at `0.0.0` are renamed off the stray
`type-` / `typefetch-` prefixes while it is still free — `type-devtools-core`,
`type-devtools`, `type-permission`, `typefetch-query-core`, `typefetch-react`.
Scheduled at step 7 rather than first so it does not tangle with the seam
refactor's diff.

---

## 1. Core seam — the prerequisite

Not a package: no adapter can exist until this lands, and it must land with
**zero behaviour change** so it is the regression net for everything after.

- `TransportAdapter` (`kind`, `apiVersion`, `capabilities`, `validate`,
  `describe`, `build`, `decode`, `fail`, optional `send`) + explicit
  registration at the setup site.
- Today's request building, decoding and failure handling extracted verbatim
  into the built-in `http` adapter.
- `describe()` adopted by `middlewares/permission.ts` and `cli/print-result.ts`,
  which read `.method`/`.path` directly today — the two places that would break
  the moment a second transport is registered.
- `capabilities` wired to warnings, so `onUploadProgress` on a transport that
  cannot report it says so instead of silently never firing.
- `driver: "auto" | "fetch" | "xhr"` lands here — with the http adapter to
  honour it, not before.
- CI gains the gzipped size budget and the runtime matrix.

## 2. `…-graphql` — first, because it is the seam's test

Built **entirely outside the core, deliberately**. If it needs even one change to
the core to work, the seam is wrong, and this is the only cheap moment to find
out. Everything after depends on that answer.

- POST `{ query, variables, operationName }`; both response media types
  (`application/json` with errors inside a 200, and
  `application/graphql-response+json` with a real 4xx/5xx).
- `errorPolicy: "none" | "all"` for partial data.
- **Selection set generated from the zod response schema** — the one thing no
  other GraphQL client can do, and the reason a team would pick this over Apollo.
  Explicit `document` remains available for fragments, aliases and unions.

## 3. `…-grpc`

- Connect unary JSON by default: real status codes, JSON error bodies, curl-able,
  zero dependencies.
- `GrpcCode` + its mapping into `ErrorKind`.
- Binary grpc-web behind the `GrpcCodec` seam — the adapter owns framing and
  trailers, the codec owns message bytes, so protobuf never enters anything we
  publish.
- Connect's conformance runner in CI. Evidence, not a claim.

## 4. `…-encryption`

`crypto-js` and `node-forge` leave the core with the encryption middleware, and
`jiti` leaves with the CLI in step 5. **Only then is "zero dependencies" true**,
and it is among the first things an enterprise audit checks.

Breaking: the import path moves. Handled by the codemod in step 6.

## 5. `…-cli`

Two halves, in order:

1. **Move**, changing nothing: `src/cli/**` out of the core, `jiti` with it,
   every existing command working byte-for-byte.
2. **Grow**: `typewire.config.ts` with per-package sections, then `snapshot` +
   `diff` (the feature that earns the split), `lint`, `doctor`, `explain`,
   `mock`, `generate openapi`.

## 6. `…-codemod`

One `npx` invocation migrating every break introduced above: `ZodError` catches
for invalid input, `ctx.endpoint.method` reads in middleware, encryption import
paths, `typefetch.test.config.ts` → `typewire.config.ts`.

Ships last because it can only be written once the breaks are known — but every
break above is recorded against it as it lands, not reconstructed afterwards.

## 7. Downstream packages

They key on `endpointId`, which does not move, so they kept working untouched
throughout — which is why this was deferred until the transports existed and
were proven. Transport-aware polish comes now, package by package.

### 8a — devtools (done)

The bridge was built when "which client" and "which wire" were the same
question. Three gaps, all of them only visible once a second transport existed:

1. **Every row said `http`.** `connectTypeFetch` dropped the `transport` field
   typefetch emits, so a GraphQL query and a REST GET were indistinguishable.
2. **Failures showed `status` and nothing else** — a field that is meaningful on
   exactly one of the three wires typefetch now speaks. `ErrorKind` existed and
   the inspector was throwing it away.
3. **Progress was recorded and never rendered.** `devtools-core` has stored
   transfer ticks since the progress release; the panel called `selectEntries`
   without them, so a 200 MB upload showed a static `pending` row.

`source` was deliberately **not** widened to `"graphql"` / `"grpc"`. It is the
key space for overrides and correlation ids, and the connector that resolves a
GraphQL override is typefetch's — an override registered under `"graphql"` would
be accepted, listed in the panel, and never match anything. `transport` is a new
axis instead; `source` stays per-client.

Also fixed: the cURL button was producing `curl -X query '…'` for GraphQL rows,
because it reconstructs the command from the start event's operation and target.

### 8b — nestjs (done)

The guard-rail this file asked for turned out to be the smallest part. Rejecting
a non-http endpoint at module registration is right, but only worth doing if
something *else* serves it — so the package now serves all four wires:

- **`.../grpc`** — Connect's JSON protocol is an HTTP POST, so a NestJS app
  serves gRPC contracts with no protobuf runtime. Failures are named in the gRPC
  key space (which is what the contract's `errors` map is keyed by), and
  deadlines are *enforced* rather than merely received.
- **`.../graphql`** — the client generates its document from the `response`
  schema, so an operation can be addressed by name and answered from that same
  schema, with no GraphQL engine. Resolvers run through Nest's own pipeline via
  `ExternalContextCreator`, so guards — including the contract permission guard —
  work in a resolver exactly as on a route.
- **`.../socket`** — typesocket gateways, promised in the README since 0.1.0.
- **http** gained what it had been missing: `responseType` downloads actually
  serve (a `Buffer` was being JSON-serialised), with both `Content-Disposition`
  spellings and the `Access-Control-Expose-Headers` a cross-origin client needs.

Each wire is a separate entry point with its own optional peer, so an HTTP-only
app installs nothing extra — and each peer is one the contract already required,
since it is what augments the `TransportRegistry` in the first place.

Also fixed: the global response envelope was wrapping payloads it does not own —
a Connect error body, a GraphQL `{ data }`, a WebSocket ack.

### Still open

- **query-core** — cache keys are `endpointId` + input, which is transport-blind
  by design and needs nothing. Worth checking is whether retry/`staleTime`
  defaults should differ per wire.
- **react** — nothing known; it re-exports query-core's observers.
- **nestjs, later** — binary grpc-web (needs raw-body access and trailer
  framing), field-level encryption on the GraphQL transport (warned at bootstrap
  rather than silently skipped), and GraphQL request batching.

---

## 10. `…-sync` — the tab axis

Every package here assumes one runtime holds one client, and a browser breaks
that assumption the moment the user opens a second tab. Four tabs mount the same
query and four requests leave; one tab saves and the others keep rendering the
old row; two tabs run the same checkout and the customer is charged twice.

The instinct is "broadcast the cache", which is one third of the answer. The
design in [`SYNC.md`](./SYNC.md) separates it into three primitives — **mirror**
(a value crosses so the other tabs adopt instead of refetch), **lock** (one tab
performs, and the losers get a named answer instead of a spinner), and **leader**
(one tab owns the socket, the poll and the token refresh) — over two replaceable
seams, `ChannelAdapter` and `LockAdapter`, so it is testable in Node with no
browser.

It keys on `"module.member"`, which is why it is one package rather than a
feature bolted onto query-core: the same policy map that mirrors a typefetch
query serializes a typesocket emit.

Two things it must not repeat, both of them live complaints against the
equivalent in TanStack Query: a `gcTime` eviction in a background tab must not
remove the query in the tab the user is reading, and a large payload must not be
posted to every tab on every keystroke. The first needs `reason` on query-core's
`removed` event — the cache cannot currently tell explicit removal from garbage
collection, and that ambiguity is invisible until it crosses a channel.

## 11. Standard Schema — stop being a zod package

Full design: [`SCHEMA.md`](./SCHEMA.md).

`zod` is a peer dependency because schemas only compare correctly against one
instance. Standard Schema is the other half of that thought: a ~60-line
interface that zod 4, Valibot, ArkType and Effect Schema all implement, so a
contract can be validated by whichever of them the consuming team already has.

It costs nothing to accept — `~standard.validate` is one call, and no runtime
dependency comes with it — and it removes the single largest reason a team says
no to a contract-first library. `zod` stays the documented default and every
example keeps using it; the change is that it is no longer the only thing that
typechecks.

The work is not in typefetch. It is in the places that read a schema's *shape*
rather than validating with it: the GraphQL selection-set generator and
`generate openapi` both walk zod internals today. Those either keep a zod fast
path or move behind a capability check that says so out loud.

## 12. `…-sse` — the wire that AI made mandatory

Full design: [`SSE.md`](./SSE.md).

Streaming is where every product went while this repo built request/response.
Server-Sent Events is the transport under most of it, and it is a plain HTTP GET
with a text body, so it fits the existing `TransportAdapter` without a new core
concept: `event:` names map to a record of schemas, each frame validates against
the one it names, and the call returns an `AsyncIterable` instead of a value.

What earns the package rather than a recipe is the failure half. `EventSource`
reconnects on its own and the generation state does not come back with it, so
the contract carries `lastEventId` and the adapter resumes rather than restarting
a half-finished response. HTTP/1.1's six-connections-per-origin ceiling is also
real, and it is the same ceiling `…-sync`'s leader primitive already lifts — one
stream in the leader tab, fanned out — which is why these two are sequenced next
to each other.

## 13. `…-offline` — persistence, and a queue with an owner

Full design: [`OFFLINE.md`](./OFFLINE.md).

Two halves that are usually sold as one:

1. **Persist the cache** — hydrate from IndexedDB on boot so a reload is not a
   blank screen, with the version and the `dataUpdatedAt` guard already designed
   for the sync channel.
2. **A durable outbox** — a mutation queued while offline must survive a hard
   close and replay in order, which an in-memory retry cannot do.

The outbox is where this depends on step 10 rather than duplicating it: a queue
that every tab drains sends every write as many times as there are tabs. Exactly
one tab may drain it, which is the leader primitive, unchanged.

Conflict resolution is deliberately **not** in scope. Last-write-wins with the
server as the arbiter, plus a typed `onConflict` hook, is the honest boundary for
a contract library; CRDTs and merge semantics are a different product.

## 14. `typewire generate mcp` — the contracts an agent can call

Full design: [`MCP.md`](./MCP.md).

`generate openapi` is already planned, and this is the same walk over the same
contracts with a different emitter: one MCP tool per endpoint, the request schema
as the tool's input schema, the description from the contract.

The argument for it is that the alternative is worse. Teams currently hand-write
a wrapper per endpoint for their agent, and that wrapper is the fourth copy of a
shape this repo exists to keep in one place. Generating it means an agent's tool
call is validated by the same schema as the app's — including the `type-permission`
bits, which is the part a hand-written wrapper always forgets.
