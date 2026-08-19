# @tahanabavi/type-permission

## 0.1.0

### Minor Changes

- ecf70c7: Add `@tahanabavi/type-permission` — framework-less, dependency-free capability
  permissions. One shared `bigint` bit map, evaluated identically on client and
  server: `definePermissions` with explicit permanent bits and load-time
  validation, layered `resolve()` (Discord's overwrite chain) with
  `grantsAll`/`implies`/`requires` post-passes, `from`/`pack`, set algebra with a
  `canGrant` escalation guard, `explain()`, a reactive `createStore` on the
  repo-wide `Observable<T>` plus a memoizing `createResolver`, lossless/lossy
  codecs (`decimal`/`hex`/`base64url`/`chunks`/`names`/`grouped`), a
  `buildLock`/`diffLock` drift check, `catalog()` for admin UIs, and an optional
  contract `permission` key with `authorize()`.
