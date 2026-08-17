---
"@tahanabavi/typewire-nestjs": minor
---

One contract file, served over every wire — plus the permission guard, which had
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
  means a handler looked and did not find. Deadlines are *enforced*, not merely
  received — `@GrpcDeadline()` hands the handler an `AbortSignal`, because a
  deadline only the client honours is a timeout that still holds a database
  connection.
- **`.../graphql` — `ContractGraphQLModule` + `@GraphQLEndpoint()`.** A GraphQL
  endpoint with **no GraphQL runtime**: the client generates its document from
  the Zod `response` schema, so both halves agree on the selection set by
  construction and an operation can be addressed by name. Resolvers run through
  NestJS's own pipeline, so `@UseGuards()` and `@ContractInput()` behave exactly
  as they do on a route. It is a *contract* server, not a general GraphQL server
  — the README says where the line is.
- **`.../socket` — `@SocketEvent()`.** typesocket gateways, promised in 0.1.0
  and now here. One contract object serves both ends; inbound frames are checked
  against `request`, acknowledgements against `ack`, and server pushes against
  `payload` — the last of which matters most, because typesocket *drops* an
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
