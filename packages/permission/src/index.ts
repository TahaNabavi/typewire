/**
 * `@tahanabavi/type-permission`
 *
 * Framework-less, dependency-free capability permissions. One shared bit map,
 * evaluated identically on client and server. See `docs/PERMISSION.md`.
 */

export { definePermissions } from "./define";
export type { Permissions } from "./define";

// Standalone reactive store + resolver (also reachable via `P.createStore` etc).
export { createStore, createResolver } from "./store";
export type { PermissionStore, PermissionResolver } from "./store";

// Explain result shape.
export type {
  ExplainResult,
  ExplainReason,
  ExplainTraceEntry,
} from "./explain";

// Public types.
export type {
  FlagDef,
  PermissionTree,
  FlagName,
  Layer,
  PermissionRequirement,
  AuthorizeDecision,
  Observable,
  StoreSnapshot,
  Codec,
  Encoded,
  Lock,
  LockEntry,
  LockViolation,
  CatalogEntry,
} from "./types";
