# @tahanabavi/typefetch

## 2.0.0

### Major Changes

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

- 3683319: Lay the foundation for pluggable transports, and normalise the failure taxonomy.

  **Breaking:** an invalid request **input** now throws a `RichError` instead of a
  raw `ZodError`. See "input validation" below for the migration.

  **Transport registry.** `EndpointDef` is now built from an open
  `TransportRegistry` interface rather than being a fixed HTTP-only object type.
  Transport packages register themselves by declaration merging, which is what lets
  gRPC and GraphQL ship as separate installable packages while the core stays
  dependency-free. With only the built-in `http` transport installed, every type
  resolves exactly as it did before, so existing contracts are untouched.

  New exports: `TransportRegistry`, `TransportKind`, `EndpointBase`,
  `HttpEndpointFields`, `EndpointFor`, `AnyEndpointDef`, `AnyEndpointDefZ`.
  `EndpointDef` keeps its name and its HTTP-only meaning.

  **`RichError.kind`.** Every failure the client produces now carries a
  transport-independent classification (`not_found`, `unauthenticated`,
  `deadline_exceeded`, `validation`, `network`, …), so a global handler is written
  once and keeps working when an endpoint moves to a wire whose failure vocabulary
  is not HTTP status codes. `status` and `code` are unchanged. A request that times
  out is now distinguishable from one the caller cancelled — both abort, but they
  report `deadline_exceeded` and `cancelled` respectively.

  **`errors` accepts string keys.** `ErrorResponsesMap` widens from
  `Record<number, …>` to `Record<number | string, …>`, because a transport's error
  key space is its own — an HTTP status, a gRPC code, or a GraphQL
  `extensions.code`. `isContractError` narrows off either, matching on the new
  `RichError.errorKey` (the key in the contract's `errors` map) rather than
  assuming the HTTP status is that key.

  **Input validation now fails like output validation.** `request.parse` ran
  before the client's error handling, so a bad _input_ escaped as a raw `ZodError`
  — never a `RichError`, no `kind`, never reaching `onError`, never appearing in an
  inspector. A bad _output_, one line further down the same request, did all four.
  A global error handler therefore missed an entire class of failure with no
  signal that it had.

  Both ends of the contract now behave identically. Zod's per-field detail is
  carried across to `RichError.errors` (already `Record<string, string[]>`, the
  same shape), so nothing is lost.

  ```diff
    try {
      await api.user.createUser(input);
    } catch (e) {
  -   if (e instanceof ZodError) showFieldErrors(e.flatten().fieldErrors);
  +   if (e instanceof RichError && e.kind === "validation") showFieldErrors(e.errors);
    }
  ```

  Note that `onError` now fires for invalid input, where it previously did not.

  No new dependencies.

## 1.10.0

### Minor Changes

- 7e52d2b: Response types and transfer progress.

  - **typefetch** — new optional `responseType` on an endpoint: `json` (default),
    `text`, `blob`, `arrayBuffer`, `formData`, `file`, `stream`, `response`. Paired
    schema helpers `zBlob()` / `zFile()` / `zArrayBuffer()` / `zFormData()` /
    `zStream()` / `zResponse()` defer their global lookup into the validator, so a
    contract importing them is constructible in Node and SSR (unlike
    `z.instanceof(Blob)`). `responseType: "file"` resolves to
    `{ blob, filename, contentType, size }` with `filename` parsed from
    `Content-Disposition` (RFC 5987 form preferred, directory components stripped).
    `setResponseWrapper` / `useResponseTransform` apply to `json` and `text` only.

  - **typefetch** — new per-request `onUploadProgress` / `onDownloadProgress` in
    `RequestOptions`, reporting `TransferProgress`. `fetch` has no upload-progress
    API, so passing `onUploadProgress` swaps the middleware chain's terminal
    transport for `XMLHttpRequest`; middleware is unaffected (same context, still
    handed a `Response`) and requests without the handler keep the unchanged
    `fetch` path. Where `XMLHttpRequest` is absent the request still runs over
    `fetch` and the client warns once. Download progress counts bytes off
    `res.body` and is skipped for `stream`/`response`. `RequestEvent` gains a
    `progress` variant, emitted only for requests that asked for progress.

  - **type-devtools-core** — `TypeFetchRequestEvent` gains the `progress` variant,
    and `InspectorBridge` gains a separate latest-only progress channel
    (`recordProgress` / `getProgressSnapshot`) rather than routing ticks through
    the event ring buffer, where one upload would evict the whole log.
    `selectEntries(events, progress?)` joins it onto the matching row.

  - **typefetch-query-core** — `EndpointCallOptions` carries the progress
    callbacks; `MutationObserverOptions` gains `trackProgress` (`true` | `"upload"`
    | `"download"`) plus pass-through handlers, and `MutationState` gains
    `progress`. A mutation that wants nothing calls the endpoint with no options at
    all, exactly as before.

  - **typefetch-react** — `useMutation(endpoint, { trackProgress })` exposes
    `result.progress`, updating through the existing `useSyncExternalStore`
    subscription. No new hook.

  **Behavior change (fix):** `onError` now fires exactly once per failed request.
  It previously fired once per layer that saw the error on its way out — twice for
  a plain HTTP failure, and once per attempt plus one when retries were configured
  (`maxRetries: 2` called it four times). Reporting is now idempotent per error
  instance and sits outside the retry loop. Which errors reach the handler, and the
  error instance it receives, are unchanged.

  **Behavior change (fix):** a failed response is now handled before its body is
  decoded, and the body is read as text then parsed. Previously `res.json()` ran
  first, so a non-JSON failure — an HTML 502, an empty 401, a plain-text 503 —
  threw a raw `SyntaxError` and the HTTP status never reached the caller. Those now
  produce a `RichError` carrying `status`, with the raw text in `detail`. An
  envelope reporting `{ success: false }` alongside a 4xx still surfaces its
  message, now via `safeParse` so a non-envelope failure body falls through to the
  status error instead of throwing a validation error over it.

## 1.9.0

### Minor Changes

- 03ecc58: Client-side permission enforcement, mirroring the server's `createPermissionGuard`.

  - **typefetch** — `createPermissionMiddleware({ getPermissions, authorize, onDeny? })`
    returns a `Middleware` that reads `ctx.endpoint.permission`, evaluates it with the
    injected `authorize` (pass `P.authorize`), and throws `PermissionDeniedError`
    (`{ status: 403, missing, missingAny? }`) before the request is sent. Endpoints
    with no `permission` key pass through. `authorize` is injected, so typefetch keeps
    no dependency on `@tahanabavi/type-permission`.

  - **typesocket** — `createPermissionMiddleware({ getPermissions, authorize, onDeny? })`
    builds a pre-emit guard registered via the new `authorizeOutbound` client option
    (or `client.setOutboundAuthorizer()`). A denied emit throws `PermissionDeniedError`
    — an ack'd emit rejects, a fire-and-forget one throws synchronously. It uses
    `authorizeOutbound` rather than `client.use()` because a `SocketMiddleware` can only
    drop a frame silently; `getPermissions` is synchronous so a `void` emit can fail at
    the call site. New: `OutboundAuthorizer` type, `authorizeOutbound` option,
    `client.setOutboundAuthorizer()`.

  Both are additive and dependency-free; client checks are UX only — the server
  (`@tahanabavi/typewire-nestjs`) remains the enforcement point.

## 1.8.0

### Minor Changes

- ecf70c7: Contract-linked permissions (opt-in, additive). Endpoints and `client->server`
  socket events may now carry an optional `permission` requirement
  (`{ require?, any?, reason? }`) written once on the contract:

  - **typefetch** — `EndpointDef.permission`
  - **typesocket** — `ClientToServerDef.permission` (client authorizes what it sends)

  Both types are redeclared structurally, so the transports stay dependency-free.

  **typewire-nestjs** gains `createPermissionGuard({ getPermissions, authorize })`
  — a NestJS guard that reads the requirement off the contract metadata and
  rejects with a 403 naming the missing flags — plus a `@RequirePermission()`
  decorator for contract-less routes. Pass `@tahanabavi/type-permission`'s
  `P.authorize` straight through; a route with no requirement is never blocked.

## 1.7.1

### Patch Changes

- 84c00be: Update package manifest metadata — author contact (email/URL), homepage, and
  keywords — with no runtime or API changes. typesocket additionally corrects its
  license to MIT and now ships its README and LICENSE in the published tarball
  (previously `dist` only).
