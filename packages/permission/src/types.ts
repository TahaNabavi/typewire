/* ============================================================================
 * CONTRACT — the shared bit map
 *
 * This file is imported by frontend *and* backend (and any other project that
 * speaks the same permissions). It declares the vocabulary; it never opens a
 * database, fetches, or imports a framework. See `docs/PERMISSION.md`.
 * ========================================================================== */

/**
 * A single permission flag.
 *
 * `bit` is **mandatory and permanent**: it is the stable index into the shared
 * bit space. Auto-assigning bits by declaration order would silently change the
 * meaning of every stored bitfield the moment a flag is inserted in the middle —
 * so the bit is always explicit, and reusing one is forbidden (CI-enforced via
 * the lock file).
 */
export type FlagDef = {
  /** The permanent, explicit bit index. A non-negative integer, unique per tree. */
  bit: number;

  /**
   * Holding this flag short-circuits to the full mask — the `ADMINISTRATOR`
   * escape hatch. Applied before `implies`/`requires`, and it only ever *adds*
   * bits, so an actor's unknown (newer-version) bits are preserved.
   */
  grantsAll?: boolean;

  /**
   * Holding this flag also grants these (upward closure). The transitive closure
   * is precomputed at `definePermissions()` time to a single mask, so runtime
   * cost is one `|`, not a graph walk.
   */
  implies?: string[];

  /**
   * This flag is void unless *all* of these are also held (gating). Applied
   * last, so it can revoke what `implies` granted — this is what makes
   * "denied the channel ⇒ can do nothing in it" fall out of the model instead of
   * being re-checked at every call site. Gating cascades to a fixpoint.
   */
  requires?: string[];

  /**
   * Retired flag. Its bit is burned forever and must never be reused. Still
   * evaluates (the stored data exists) and is reported by the lock check.
   */
  deprecated?: boolean;

  /** Human-readable name for admin UIs. May be an i18n key. */
  label?: string;

  /** Longer help text for admin UIs. */
  description?: string;

  /** Internal flag — omitted from `catalog()`, still enforced everywhere. */
  hidden?: boolean;
};

/**
 * A module-grouped map of flags — structurally parallel to typefetch's
 * `Contracts` and typesocket's `SocketContracts`, so all three produce the same
 * `"module.member"` identifier shape and higher layers key them uniformly.
 *
 * Nesting is naming only: there is exactly one flat bit space across all modules.
 */
export type PermissionTree = {
  [module: string]: { [member: string]: FlagDef };
};

/* ============================================================================
 * DERIVED TYPES — the compile-time drift-killer
 * ========================================================================== */

/**
 * The literal union of every `"module.member"` name in a tree. This is what
 * makes `has(perms, "chat.SEND_MESSAGES")` a compile error on a typo instead of
 * a silent `false`.
 */
export type FlagName<T extends PermissionTree> = {
  [M in keyof T & string]: {
    [K in keyof T[M] & string]: `${M}.${K}`;
  }[keyof T[M] & string];
}[keyof T & string];

/* ============================================================================
 * RESOLUTION
 * ========================================================================== */

/**
 * One tier of the resolution fold. Applied as `(perms & ~deny) | allow`.
 *
 * `allow`/`deny` may each be a single mask or an array of masks; an array is
 * unioned first, so **allow beats deny within a tier**, and a later tier beats
 * an earlier one. That is Discord's channel-overwrite chain, expressed as data.
 */
export type Layer = {
  allow?: bigint | bigint[];
  deny?: bigint | bigint[];
  /** Optional label, surfaced only by `explain()`'s trace. */
  source?: string;
};

/* ============================================================================
 * CONTRACT LINK — the optional `permission` key on an endpoint / event
 * ========================================================================== */

/**
 * A permission requirement that a transport contract (typefetch endpoint,
 * typesocket event) can carry inline, so the flag name is written once and the
 * server guard, client pre-flight, and CI lint all derive from it.
 *
 * Purely additive: a contract without this key behaves exactly as before.
 * `require` needs *all* listed flags; `any` needs *at least one*; when both are
 * present, both conditions must pass.
 */
export type PermissionRequirement<Name extends string = string> = {
  /** All of these must be held (`hasAll`). */
  require?: readonly Name[];
  /** At least one of these must be held (`hasAny`). */
  any?: readonly Name[];
  /** Optional human reason, surfaced in the 403 body and the audit log. */
  reason?: string;
};

/** The outcome of evaluating a {@link PermissionRequirement} against a bitfield. */
export type AuthorizeDecision<Name extends string = string> = {
  granted: boolean;
  /** Flags demanded by `require` that the actor lacks. Empty when `granted`. */
  missing: Name[];
  /** The `any` set, when it was the failing condition. */
  missingAny?: Name[];
  reason?: string;
};

/* ============================================================================
 * REACTIVITY — the repo-wide Observable contract (redeclared, never imported,
 * so this package stays dependency-free)
 * ========================================================================== */

/**
 * The universal reactivity contract. Structurally identical to the one in
 * `query-core`/`devtools-core`; anything that binds one binds the other
 * (React `useSyncExternalStore`, Vue `shallowRef`, Svelte store, …).
 */
export interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/** The snapshot a {@link PermissionStore} holds: a global set plus scoped sets. */
export type StoreSnapshot = {
  /** Monotonic epoch; bump to invalidate caches (see `docs/PERMISSION.md` §10.4). */
  version: number;
  /** Bits that apply everywhere — the base set. */
  global: bigint;
  /** Per-scope bits, e.g. `"channel:123"`. Unknown scopes fall back to `global`. */
  scopes: Record<string, bigint>;
};

/* ============================================================================
 * CODECS
 * ========================================================================== */

/**
 * How a bitfield crosses an IO boundary. The runtime value is always `bigint`;
 * these are only representations.
 *
 * The binary codecs (`decimal`, `hex`, `base64url`, `chunks`) are **lossless** —
 * they carry unknown (newer-version) bits through untouched. The human-readable
 * codecs (`names`, `grouped`) are lossy for unknown bits by nature, since a bit
 * with no name in this version cannot be written as one.
 */
export type Codec =
  | "decimal"
  | "hex"
  | "base64url"
  | "chunks"
  | "names"
  | "grouped";

/** The wire type produced by each codec. */
export type Encoded = {
  decimal: string;
  hex: string;
  base64url: string;
  chunks: number[];
  names: string[];
  grouped: Record<string, string[]>;
};

/* ============================================================================
 * LOCK FILE — the cross-project interop + drift-detection artifact
 * ========================================================================== */

/** One entry of the flat, language-neutral `name → bit` manifest. */
export type LockEntry = {
  bit: number;
  deprecated?: boolean;
};

/** The `permissions.lock.json` shape. `version` gates consumer compatibility. */
export type Lock = {
  version: number;
  flags: Record<string, LockEntry>;
};

/** A single drift finding produced by comparing a tree against a prior lock. */
export type LockViolation =
  | { kind: "bit-reused"; bit: number; was: string; now: string }
  | { kind: "bit-changed"; name: string; was: number; now: number }
  | { kind: "removed"; name: string; bit: number };

/** One row of `catalog()` — the source for a permission-management UI. */
export type CatalogEntry = {
  name: string;
  module: string;
  member: string;
  bit: number;
  label?: string;
  description?: string;
  implies?: string[];
  requires?: string[];
  grantsAll: boolean;
  deprecated: boolean;
};
