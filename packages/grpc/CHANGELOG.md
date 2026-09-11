# @tahanabavi/typefetch-grpc

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

### Patch Changes

- Updated dependencies [4079eb1]
- Updated dependencies [3683319]
  - @tahanabavi/typefetch@2.0.0
