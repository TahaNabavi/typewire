# TypeFetch — pluggable transports (design)

**Status:** proposal. Decide the seam here before any code moves.

TypeFetch speaks one wire today: `fetch`, swapped for `XMLHttpRequest` when a
request asks for upload progress. This makes the wire **pluggable**, so gRPC,
GraphQL, and anything after them ship as separate installable packages that feed
the same contract, the same middleware chain, and the same client.

Three constraints govern every decision below:

1. **The core has zero runtime dependencies.** Not "few". Zero.
2. **Transports are external packages.** `@tahanabavi/typefetch` never imports
   one, never lists one, and never grows when one ships.
3. **The seam is public API.** Third-party packages compile against it, so it is
   versioned and breaking it is a major.

Constraint 3 is the whole design. Everything else follows from taking it
seriously.

---

## 1. Why this is cheap: the wires are all HTTP

gRPC-for-the-web (Connect, grpc-web) and GraphQL-over-HTTP are both **a POST
with a body**. Neither needs a new socket, a new client, or a second pipeline.

Everything the client already does survives untouched:

| Feature | Survives | Why |
| --- | --- | --- |
| Middleware chain | yes | still `(ctx, next) => Promise<Response>` |
| `auth` + `tokenProvider` | yes | still an `Authorization` header |
| Retry / backoff, `timeout`, `AbortSignal` | yes | still wraps the terminal send |
| `instrument()` events + overrides | yes | keyed on `endpointId`, not on HTTP |
| Mock mode + forced mocks | yes | short-circuits before the wire |
| `endpointId` → query-core / devtools | yes | **unchanged** — those packages need no change |

Exactly **four** things vary per transport, and they are the adapter's whole job:

1. build `url` + `RequestInit` from the parsed input,
2. decode a 2xx body into the value `response` validates,
3. turn a failure into a normalized error,
4. describe itself to tooling.

---

## 2. Package topology

```txt
@tahanabavi/typefetch              core. zero deps. ships the built-in http transport.
  ├── @tahanabavi/typefetch-graphql   peer-depends on core
  ├── @tahanabavi/typefetch-grpc      peer-depends on core
  └── @tahanabavi/typefetch-encryption  (see §7 — core is not dep-free today)
```

An adapter package exports a factory. Registration is **explicit at the setup
site**, so a REST-only app never pays a byte for a transport it does not use —
`sideEffects: false` is already set, so unregistered adapters tree-shake out.

```ts
import { ApiClient } from "@tahanabavi/typefetch";
import { graphqlTransport } from "@tahanabavi/typefetch-graphql";
import { grpcTransport } from "@tahanabavi/typefetch-grpc";

const client = new ApiClient({
  baseUrl: "https://api.example.com",
  transport: "http",                     // global default; omit for "http"
  transports: [
    graphqlTransport({ url: "https://api.example.com/graphql" }),
    grpcTransport({ baseUrl: "https://grpc.example.com" }),
  ],
}, contracts);
```

---

## 3. The contract type must be **open**

A closed union (`"http" | "grpc" | "graphql"`) cannot work once adapters live
outside the core: the core would have to know `service`/`rpc` fields that ship
in a package it must never import.

So the endpoint type is built from an **augmentable registry** — the pattern
Fastify, Vitest and tRPC use for exactly this problem.

```ts
// core
export interface TransportRegistry {
  http: {
    method: Method;
    path: string;
    bodyType?: "json" | "form-data";
    responseType?: ResponseType;
    driver?: "auto" | "fetch" | "xhr";
  };
}

export type TransportKind = keyof TransportRegistry & string;

export type EndpointFor<K extends TransportKind, TReq, TRes, TErr> =
  & EndpointBase<TReq, TRes, TErr>      // auth, permission, request, response,
  & TransportRegistry[K]                // errors, mockData, headers, test
  & (K extends "http" ? { transport?: "http" } : { transport: K });

export type AnyEndpointDef<TReq, TRes, TErr> =
  { [K in TransportKind]: EndpointFor<K, TReq, TRes, TErr> }[TransportKind];
```

An adapter package adds its variant by declaration merging:

```ts
// @tahanabavi/typefetch-grpc
declare module "@tahanabavi/typefetch" {
  interface TransportRegistry {
    grpc: {
      service: string;
      rpc: string;
      deadlineMs?: number;
      codec?: GrpcCodec<unknown, unknown>;
    };
  }
}
```

**Installing the package is what adds the type.** `transport: "grpc"` does not
compile until `@tahanabavi/typefetch-grpc` is a dependency, and once it is, the
contract is fully checked — including that a gRPC route may not carry `path`.

`EndpointDef` keeps its current name and its current HTTP-only meaning
(`= EndpointFor<"http", …>`), so every existing import resolves to the same type.
`Contracts` widens to `AnyEndpointDef`.

### What routes look like

```ts
// http — unchanged. `transport` omitted means "http".
getUser: { method: "GET", path: "/users/:id", request, response }

// grpc — no method/path/bodyType/responseType. One message in, one out.
getUser: { transport: "grpc", service: "user.v1.UserService", rpc: "GetUser",
           request, response, deadlineMs: 5_000 }

// graphql — `request` IS the variables; `root` unwraps data.user
getUser: { transport: "graphql", operation: "query", root: "user",
           request: z.object({ id: z.string() }), response: User }
```

For gRPC and GraphQL the whole parsed input is the message/variables — the
`{ path, query, body }` split is an HTTP concept and is skipped entirely.

---

## 4. The seam

```ts
export interface TransportAdapter<K extends TransportKind = TransportKind> {
  readonly kind: K;

  /** Seam version this adapter compiled against. Core refuses a mismatch loudly. */
  readonly apiVersion: 1;

  /** What this wire can and cannot do. Core warns instead of silently no-op'ing. */
  readonly capabilities?: TransportCapabilities;

  /** Run once per endpoint at `init()`. Throw with the endpointId on a bad contract. */
  validate?(endpoint: AnyEndpointDef, endpointId: string): void;

  /** Identify a route for CLI output, devtools rows and audit logs. */
  describe(endpoint: AnyEndpointDef): {
    protocol: string;    // "HTTP" | "gRPC" | "GraphQL"
    operation: string;   // "GET" | "unary" | "query"
    target: string;      // "/users/:id" | "user.v1.UserService/GetUser"
  };

  build(ctx: TransportContext): { url: string; init: RequestInit };
  decode(res: Response, ctx: TransportContext): Promise<unknown>;
  fail(res: Response, body: unknown, ctx: TransportContext): NormalizedFailure | undefined;

  /** Optional terminal sender. Defaults to the core fetch/XHR one. */
  send?(url: string, init: RequestInit, opts: SendOptions): Promise<Response>;
}

export type TransportCapabilities = {
  uploadProgress?: boolean;
  downloadProgress?: boolean;
  /** Whether the protocol makes a call safe to cache. */
  cacheable?: boolean;
  /** Which `responseType` values mean anything here. */
  responseTypes?: readonly ResponseType[];
};
```

Two members earn their place beyond the obvious three:

- **`describe`** is why the core never reads a transport-specific field. Today
  `middlewares/permission.ts` and `cli/print-result.ts` read `.method`/`.path`
  directly; with an open registry those fields may not exist. Asking the adapter
  keeps the core honest and keeps tooling working for transports written after
  it shipped.
- **`capabilities`** turns silent no-ops into warnings. Passing
  `onUploadProgress` to a gRPC route should say so, exactly as the client
  already warns when XHR is unavailable. Silence reads as a hung app.

`validate` runs at `init()`, not per request, so a misconfigured route fails at
client construction with its endpoint id — never on the first call in prod.

---

## 5. Errors must normalize, or the whole pitch collapses

The point of one client over three wires is that app code stops caring which
wire it is on. That fails immediately if "not found" is `404` here, `5` there,
and `"NOT_FOUND"` in the third place.

So `RichError` gains a **normalized `kind`**, and the gRPC code set is the
canonical taxonomy — it is the best-designed of the three, and HTTP status and
GraphQL `extensions.code` both map into it cleanly.

```ts
export type ErrorKind =
  | "cancelled" | "invalid_argument" | "deadline_exceeded" | "not_found"
  | "already_exists" | "permission_denied" | "unauthenticated"
  | "resource_exhausted" | "failed_precondition" | "aborted"
  | "out_of_range" | "unimplemented" | "internal" | "unavailable" | "data_loss"
  | "network" | "validation" | "unknown";
```

A global "redirect on `unauthenticated`" handler then works across every
transport — which is the actual product.

The **typed** error body stays transport-specific, because that is the part that
must match the server exactly. Unambiguous, since a route has one transport:

| Transport | `errors` key | `status` | Extra |
| --- | --- | --- | --- |
| `http` | HTTP status (`404`) | HTTP status | — |
| `grpc` | gRPC code (`5`) | mapped HTTP status | `grpcCode` |
| `graphql` | `extensions.code` (`"UNAUTHENTICATED"`) | `200` or real status | `graphqlErrors` |

One widening makes string keys legal:

```ts
-export type ErrorResponsesMap = Record<number, z.ZodTypeAny>;
+export type ErrorResponsesMap = Record<number | string, z.ZodTypeAny>;
```

`Record<number, T>` is assignable to it, `InferErrors`/`InferError` keep working
by `keyof`, and `isContractError`'s `S extends … & number` widens to
`& (number | string)`. Additive in both directions.

---

## 6. Adapter notes

### `@tahanabavi/typefetch-grpc`

Default wire is **Connect unary JSON** — the only gRPC-family protocol that is
honest HTTP: real status codes, a JSON error body, no trailers, curl-able.

```txt
POST {baseUrl}/user.v1.UserService/GetUser
Content-Type: application/json
Connect-Timeout-Ms: 5000

{"id":"u_1"}
```

Failures are non-2xx with `{"code":"not_found","message":"…","details":[…]}`,
which maps straight onto `ErrorKind`. No protobuf, no dependency — zod remains
the source of truth.

Binary grpc-web sits behind a codec seam so protobuf never enters any package we
publish: the adapter owns the 5-byte length-prefix framing and the `0x80`
trailer frame; the codec owns only message bytes and comes from whatever
generator the team already runs.

```ts
export type GrpcCodec<TIn, TOut> = {
  contentType?: string;   // default "application/grpc-web+proto"
  encode(message: TIn): Uint8Array;
  decode(bytes: Uint8Array): TOut;
};
```

> A grpc-gateway server that transcodes to real REST paths needs no adapter at
> all — that is already the http transport.

### `@tahanabavi/typefetch-graphql`

Standard POST of `{ query, variables, operationName }`, handling both response
media types: legacy `application/json` (errors inside a 200) and
`application/graphql-response+json` (errors with a real 4xx/5xx). Partial data
is governed by `errorPolicy: "none" | "all"`, where `"all"` resolves the data
and reports the errors through the existing `onError` — keeping the return type
`Promise<T>` rather than forcing every call site to unpack a result object.

**The selection set is generated from the zod schema.** This is the one thing no
other GraphQL client can do, because no other one is zod-first:

```ts
getUser: {
  transport: "graphql",
  operation: "query",
  root: "user",
  request: z.object({ id: z.string() }),
  response: User,          // → query GetUser($id:ID!){ user(id:$id){ id name email } }
}
```

One source of truth, so a selection set can never drift from the schema that
validates it. An explicit `document` remains available for fragments, aliases,
unions and nested arguments.

---

## 7. The core is not dependency-free today

`@tahanabavi/typefetch` currently ships three runtime dependencies:

| Dep | Used by | Fix |
| --- | --- | --- |
| `crypto-js` | `middlewares/encryption.ts` | move to `@tahanabavi/typefetch-encryption` |
| `node-forge` | `middlewares/encryption.ts` (RSA) | same |
| `jiti` | CLI config loading | CLI-only, but installs for everyone — split the bin or make it optional |

Encryption is a middleware, so it moves out without needing the transport seam
at all — it is already plugin-shaped. That makes it a good forcing function:
if the core cannot cleanly shed a feature it already owns, the plugin story is
not real yet.

Until this lands, "zero dependencies" is not a claim we can make, and it is one
of the first things an enterprise audit checks.

---

## 8. What "a large org would adopt this" actually costs

Ambition is not a feature. These are the auditable, concrete things that decide
adoption, and none of them are optional at that tier:

- **Protocol conformance, in CI.** The Connect project ships a conformance
  runner that can drive a client under test. Passing it is evidence, not a
  claim. GraphQL's published audits are server-side, so the client equivalent is
  an explicit spec matrix over both response media types.
- **A tested runtime matrix**, not an assumed one: Chrome/Safari/Firefox, Node
  18+, Bun, Deno, Cloudflare Workers, React Native. Each has a real gap — RN has
  no `ReadableStream` (no download progress), Workers have no `XMLHttpRequest`
  (no upload progress). Detected and warned, never silent.
- **Supply chain.** Zero runtime deps in core, npm provenance on publish, no
  postinstall scripts, SBOM, signed tags.
- **A size budget enforced in CI** — a gzipped ceiling per package that fails
  the build on regression.
- **A written semver policy for the seam**, because third-party adapters compile
  against it. `apiVersion` is the runtime half of that promise.
- **Published benchmarks** against connect-es and Apollo. Numbers, or the
  performance question gets asked in every evaluation and answered by a guess.

---

## 9. Deliberately out of scope

- **Streaming** — gRPC server/bidi streaming and GraphQL subscriptions cannot
  return `Promise<T>` and would change `EndpointMethod`. Unary and
  query/mutation only. A later additive `AsyncIterable` return type, or
  typesocket, covers those.
- **Typed selection-set inference** from a hand-written document (gql.tada
  style). We generate the document from zod instead — the inverse, and one fewer
  source of truth.
- **Persisted queries / APQ**, `@defer` / `@stream`, protobuf reflection,
  client-side gRPC load balancing.
- **Other packages in this repo.** query-core, devtools and react key on
  `endpointId`, which does not move, so they keep working untouched and get
  transport-aware polish later.

---

## 10. Build order

Each step ends with `pnpm -r build && typecheck && test` green.

1. **Core types.** `TransportRegistry`, `EndpointFor`, `AnyEndpointDef`,
   `ErrorKind` on `RichError`, widened `ErrorResponsesMap`. No behavior change,
   nothing else moves.
2. **Core seam.** `TransportAdapter` + explicit registration + the built-in
   `http` adapter extracted verbatim from today's `client.ts`. Still zero
   behavior change — this is the regression net for everything after. Land the
   size budget and the runtime matrix in CI here.
3. **`@tahanabavi/typefetch-graphql`.** Built entirely outside the core, on
   purpose: **the first external adapter is the test of the seam.** If it needs
   one core change, the seam was wrong, and now is the only cheap time to fix it.
4. **`@tahanabavi/typefetch-grpc`.** Connect JSON first, conformance runner in
   CI, binary codec seam after.
5. **`@tahanabavi/typefetch-encryption`.** Core reaches zero dependencies.
6. **Docs** — README, `docs/releases/`, banner, changeset, semver policy for the
   seam.
