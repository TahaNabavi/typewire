# @tahanabavi/typefetch

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
