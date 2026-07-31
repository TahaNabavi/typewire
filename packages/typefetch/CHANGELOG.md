# @tahanabavi/typefetch

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
