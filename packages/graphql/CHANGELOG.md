# @tahanabavi/typefetch-graphql

## 0.1.1

### Patch Changes

- e60581b: All 12 packages receiving a patch bump for the next release.

## 0.1.0

### Minor Changes

- 4079eb1: Pluggable transports, and a core with zero runtime dependencies.

  TypeFetch spoke one wire: `fetch`, swapped for `XMLHttpRequest` when a request
  asked for upload progress. The wire is now **pluggable**, so gRPC and GraphQL
  ship as separate installable packages that feed the same contract, the same
  middleware chain, the same `onError`, the same retry policy, the same mock mode
  and the same devtools timeline. Application code stops caring which wire it is
  on.

  **New packages**

  - `@tahanabavi/typefetch-graphql` — GraphQL over HTTP, with the selection set
    generated from the Zod `response` schema so the shape that requests the data
    and the shape that validates it cannot drift.
  - `@tahanabavi/typefetch-grpc` — Connect unary JSON out of the box, binary
    grpc-web behind a codec seam. No protobuf runtime.
  - `@tahanabavi/typefetch-encryption` — the encryption middleware, moved out of
    core along with `crypto-js` and `node-forge`.
  - `@tahanabavi/typewire-cli` — the CLI binary (renamed `typefetch` → `typewire`),
    moved out of core along
    with `jiti`.

  **`@tahanabavi/typefetch` now declares zero runtime dependencies.** `zod` remains
  the single peer dependency.

  **New in core**

  - `TransportRegistry`, an augmentable interface third-party transports merge into
    — `transport: "grpc"` does not compile until the package is installed.
  - `TransportAdapter`, the public, versioned seam (`TRANSPORT_API_VERSION`).
  - `RichError.kind`, a normalised failure taxonomy shared by every transport, so
    one `onError` handler covers HTTP 401, gRPC `UNAUTHENTICATED` and GraphQL
    `extensions.code` alike.
  - `describeEndpoint()`, so tooling identifies a route without reading
    transport-specific fields.

  **Fixed**

  - A request input that failed its own `request` schema escaped as a raw
    `ZodError`: no `RichError`, no `kind`, never passed to `onError`, and invisible
    to instrumentation — while a bad _response_ one line later did all four. Both
    ends of the contract now fail identically, with Zod's field errors carried into
    `RichError.errors`.

  **Breaking**

  | Before                                                              | After                                                                     |
  | ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
  | `import { encryptionMiddleware } from "@tahanabavi/typefetch"`      | `from "@tahanabavi/typefetch-encryption"`                                 |
  | `npx typewire` (bin in core)                                        | `npm i -D @tahanabavi/typewire-cli`                                       |
  | `import { defineTypeFetchTestConfig } from "@tahanabavi/typefetch"` | `from "@tahanabavi/typewire-cli"`                                         |
  | `ErrorResponsesMap = Record<number, …>`                             | `Record<number \| string, …>` (widened; the old form is still assignable) |
  | A bad request input threw `ZodError`                                | It now throws `RichError` with `kind: "validation"`                       |

  Endpoints without a `transport` key keep defaulting to `"http"`, so every
  existing contract compiles and behaves exactly as before.

- 40f076d: New package: GraphQL as a transport for TypeFetch contracts.

  A GraphQL route lives in the same contract file, behind the same client, as your
  REST routes — and keeps every transport-independent feature unchanged:
  middleware, `onError`, retries, timeouts, `AbortSignal`, mock mode,
  instrumentation, devtools, and query-engine cache keys.

  **The selection set is generated from the Zod response schema.** No codegen step,
  no document to keep in sync, and no way for the shape that requests the data to
  drift from the shape that validates it. `document` remains available for
  fragments, aliases and unions.

  ```ts
  getUser: {
    transport: "graphql",
    operation: "query",
    root: "user",
    request: z.object({ id: z.string() }),
    response: z.object({ id: z.string(), name: z.string() }),
    variableTypes: { id: "ID!" },
  }
  // → query UserGetUser($id: ID!) { user(id: $id) { id name } }
  ```

  Also included:

  - **Errors mapped onto the shared `ErrorKind`**, so one
    `kind === "unauthenticated"` handler covers a GraphQL `UNAUTHENTICATED` and an
    HTTP 401 alike. `errors` is keyed by `extensions.code`, and `isContractError`
    narrows off it.
  - **Both response media types** — legacy `application/json` with errors inside a
    200, and `application/graphql-response+json` with a real status.
    `extensions.http.status` is honoured.
  - **Partial data is a decision, not an accident** — `errorPolicy: "none"`
    (default) throws; `"all"` resolves the data and hands the errors to
    `onPartialErrors` rather than dropping them.
  - **Refusals are loud and early.** A schema whose selection set cannot be
    inferred (unions, records, cycles) fails at `client.init()` naming the endpoint
    and the path, not on a request in production.
  - **GET mode** for queries, so they are CDN-cacheable. Mutations always POST.

  Requires `@tahanabavi/typefetch` >= 2.0.0 for the transport seam. Installing this
  package is what makes `transport: "graphql"` type-check; registering it in
  `transports` is what puts it in the bundle.

### Patch Changes

- Updated dependencies [4079eb1]
- Updated dependencies [3683319]
  - @tahanabavi/typefetch@2.0.0
