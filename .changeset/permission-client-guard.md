---
"@tahanabavi/typefetch": minor
"@tahanabavi/typesocket": minor
---

Client-side permission enforcement, mirroring the server's `createPermissionGuard`.

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
