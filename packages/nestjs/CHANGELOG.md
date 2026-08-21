# @tahanabavi/typewire-nestjs

## 1.0.0

### Minor Changes

- dd0bca8: One contract file, served over every wire — plus the permission guard, which had
  not shipped either.

  typefetch v2 made the transport pluggable, so a contract file stopped being a
  list of HTTP routes. The server half had not moved. It has now, as three new
  entry points that an HTTP-only app never installs:

  - **`.../grpc` — `@GrpcEndpoint()`.** Connect's JSON protocol: `POST
/<service>/<rpc>`, real HTTP statuses, **no protobuf runtime and no `.proto`
    file**. Failures are named in the gRPC key space, which is what an endpoint's
    `errors` map is keyed by — throw `GrpcException(GrpcCode.NotFound)`, or throw
    the NestJS exception you already would and let it map. The status→code table
    is deliberately not the client's: there a 404 means "no such method", here it
    means a handler looked and did not find. Deadlines are _enforced_, not merely
    received — `@GrpcDeadline()` hands the handler an `AbortSignal`, because a
    deadline only the client honours is a timeout that still holds a database
    connection.
  - **`.../graphql` — `ContractGraphQLModule` + `@GraphQLEndpoint()`.** A GraphQL
    endpoint with **no GraphQL runtime**: the client generates its document from
    the Zod `response` schema, so both halves agree on the selection set by
    construction and an operation can be addressed by name. Resolvers run through
    NestJS's own pipeline, so `@UseGuards()` and `@ContractInput()` behave exactly
    as they do on a route. It is a _contract_ server, not a general GraphQL server
    — the README says where the line is.
  - **`.../socket` — `@SocketEvent()`.** typesocket gateways, promised in 0.1.0
    and now here. One contract object serves both ends; inbound frames are checked
    against `request`, acknowledgements against `ack`, and server pushes against
    `payload` — the last of which matters most, because typesocket _drops_ an
    inbound payload that fails its schema.

  Three fixes fell out of it, all for things that could not work before:

  - **`responseType` is served.** A `Buffer` was JSON-serialised into
    `{"type":"Buffer",…}` and `zFile()` rejected it before that. `contractFile()`
    streams bytes with both `Content-Disposition` spellings and a
    `Content-Length`, and `Access-Control-Expose-Headers` so a cross-origin client
    can actually read them.
  - **The response envelope knows what it does not own.** It no longer wraps a
    Connect error body, a GraphQL `{ data }`, or a WebSocket ack. `@SkipEnvelope()`
    is the manual form, and it covers the error branch too.
  - **`@TypeFetchEndpoint()` on a non-HTTP contract fails at bootstrap**, naming
    the decorator that serves it, instead of throwing
    `Unsupported HTTP method "undefined"`.

  The **permission guard** (`createPermissionGuard`, `@RequirePermission`) ships in
  this release and now works on all four wires.

  Backward compatible. Every existing HTTP route behaves identically; the widened
  pieces are `InferRequest` / `InferResponse` / `ContractHandler`, `UseContract()`
  and `validateRequest()`, which accept an endpoint on any transport rather than
  only HTTP. `getContractEndpoint()` returns `AnyEndpointDefZ`, so reading
  `.method` off it needs a narrowing check once a transport package is installed —
  the same narrowing typefetch's own `MiddlewareContext.endpoint` requires.

### Patch Changes

- Updated dependencies [4079eb1]
- Updated dependencies [3683319]
- Updated dependencies [40f076d]
  - @tahanabavi/typefetch@2.0.0
  - @tahanabavi/typefetch-graphql@0.1.0
  - @tahanabavi/typefetch-grpc@0.1.0

## 3.0.0

### Patch Changes

- Updated dependencies [7e52d2b]
  - @tahanabavi/typefetch@1.10.0

## 2.0.0

### Patch Changes

- Updated dependencies [03ecc58]
  - @tahanabavi/typefetch@1.9.0

## 1.0.0

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

### Patch Changes

- Updated dependencies [ecf70c7]
  - @tahanabavi/typefetch@1.8.0

## 0.1.1

### Patch Changes

- 84c00be: Update package manifest metadata — author contact (email/URL), homepage, and
  keywords — with no runtime or API changes. typesocket additionally corrects its
  license to MIT and now ships its README and LICENSE in the published tarball
  (previously `dist` only).
- Updated dependencies [84c00be]
  - @tahanabavi/typefetch@1.7.1
