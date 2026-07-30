import {
  canGrant,
  equals,
  intersect,
  isSuperset,
  subtract,
  union,
} from "./algebra";
import { catalog } from "./catalog";
import { has, hasAll, hasAny, list, missing } from "./check";
import { compileTree, type Compiled } from "./compile";
import { decode, encode } from "./codecs";
import { explainWith, type ExplainResult } from "./explain";
import { buildLock, diffLock } from "./lock";
import { authorize } from "./requirement";
import { fromWith, packWith, postpass, resolveWith } from "./resolve";
import {
  createResolver,
  createStore,
  type PermissionResolver,
  type PermissionStore,
} from "./store";
import type {
  AuthorizeDecision,
  CatalogEntry,
  Codec,
  Encoded,
  FlagName,
  Layer,
  Lock,
  LockViolation,
  PermissionRequirement,
  PermissionTree,
  StoreSnapshot,
} from "./types";

/**
 * The compiled permission surface returned by {@link definePermissions}. Every
 * flag-name argument is typed to the literal union derived from the tree, so a
 * typo is a compile error, not a silent `false`.
 */
export interface Permissions<T extends PermissionTree> {
  /** The original tree, for tooling that wants to walk it. */
  readonly tree: T;
  /** Every `"module.member"` name, in declaration order. */
  readonly names: ReadonlyArray<FlagName<T>>;
  /** OR of every known bit — what `grantsAll` expands to. */
  readonly full: bigint;
  /** The empty set (`0n`), for readability at call sites. */
  readonly empty: bigint;

  /** The permanent bit index of a flag. */
  bit(name: FlagName<T>): number;
  /** The single-bit mask (`1n << bit`) of a flag. */
  mask(name: FlagName<T>): bigint;

  has(perms: bigint, name: FlagName<T>): boolean;
  hasAll(perms: bigint, names: ReadonlyArray<FlagName<T>>): boolean;
  hasAny(perms: bigint, names: ReadonlyArray<FlagName<T>>): boolean;
  list(perms: bigint): FlagName<T>[];
  missing(perms: bigint, names: ReadonlyArray<FlagName<T>>): FlagName<T>[];

  /** Raw OR of named bits — no post-passes. For role/layer masks. */
  pack(names: ReadonlyArray<FlagName<T>>): bigint;
  /** Effective set from names — pack + post-passes. The simple-app entry. */
  from(names: ReadonlyArray<FlagName<T>>): bigint;
  /** Fold ordered layers, then post-passes. The scoped/Discord-shaped entry. */
  resolve(layers: Layer[]): bigint;
  /** Apply grantsAll/implies/requires to a raw bitfield. */
  effective(perms: bigint): bigint;

  union(a: bigint, b: bigint): bigint;
  intersect(a: bigint, b: bigint): bigint;
  subtract(a: bigint, b: bigint): bigint;
  equals(a: bigint, b: bigint): boolean;
  isSuperset(actor: bigint, target: bigint): boolean;
  canGrant(actorPerms: bigint, roleBeingAssigned: bigint): boolean;

  explain(input: bigint | Layer[], name: FlagName<T>): ExplainResult;

  encode<C extends Codec>(perms: bigint, codec: C): Encoded[C];
  decode<C extends Codec>(value: Encoded[C], codec: C): bigint;

  catalog(): CatalogEntry[];
  buildLock(version?: number): Lock;
  diffLock(previous: Lock): LockViolation[];

  /** Named bit bundles — raw packs, ready to feed into `resolve()` as layers. */
  defineRoles<R extends Record<string, ReadonlyArray<FlagName<T>>>>(
    defs: R,
  ): { readonly [K in keyof R]: bigint };

  /**
   * Evaluate a requirement — typically an endpoint's `permission` key — against a
   * bitfield. The requirement is intentionally **string-typed** (not the
   * `FlagName<T>` union): it is the contract-glue path, where names arrive from a
   * loosely-typed transport contract, and an unknown name throws at runtime (the
   * "runtime lint"). Typed autocomplete lives on `has`/`hasAll`/`missing`/`from`.
   * This looseness is also what lets `P.authorize` be passed straight to the
   * NestJS `createPermissionGuard({ authorize })`.
   */
  authorize(
    perms: bigint,
    requirement: PermissionRequirement,
  ): AuthorizeDecision<FlagName<T>>;
  /** Boolean sugar over {@link authorize}. */
  check(perms: bigint, requirement: PermissionRequirement): boolean;

  createStore(init?: {
    global?: bigint;
    scopes?: Record<string, bigint>;
    version?: number;
  }): PermissionStore;
  createResolver(opts: {
    compute: (actorId: string, scope?: string) => bigint | Promise<bigint>;
    ttl?: number;
    version?: (actorId: string) => number;
    now?: () => number;
  }): PermissionResolver;
}

/**
 * Compile a permission tree into its typed, runtime surface. Validation is eager
 * — a duplicate bit, a dangling `implies`/`requires`, or an `implies` cycle
 * throws here, at module load, rather than producing a wrong answer later.
 *
 * @example
 * export const P = definePermissions({
 *   chat: {
 *     VIEW_CHANNEL:  { bit: 0 },
 *     SEND_MESSAGES: { bit: 1, requires: ["chat.VIEW_CHANNEL"] },
 *   },
 * });
 * P.has(perms, "chat.SEND_MESSAGES"); // a typo here is a compile error
 */
export function definePermissions<const T extends PermissionTree>(
  tree: T,
): Permissions<T> {
  const compiled: Compiled = compileTree(tree);
  const names = [...compiled.byName.keys()] as FlagName<T>[];

  const maskOf = (name: FlagName<T>): bigint => {
    const flag = compiled.byName.get(name);
    if (!flag) throw new Error(`[type-permission] unknown flag "${name}"`);
    return flag.mask;
  };

  return {
    tree,
    names,
    full: compiled.fullMask,
    empty: 0n,

    bit: (name) => {
      const flag = compiled.byName.get(name);
      if (!flag) throw new Error(`[type-permission] unknown flag "${name}"`);
      return flag.bit;
    },
    mask: maskOf,

    has: (perms, name) => has(compiled, perms, name),
    hasAll: (perms, ns) => hasAll(compiled, perms, ns as string[]),
    hasAny: (perms, ns) => hasAny(compiled, perms, ns as string[]),
    list: (perms) => list(compiled, perms) as FlagName<T>[],
    missing: (perms, ns) => missing(compiled, perms, ns as string[]) as FlagName<T>[],

    pack: (ns) => packWith(compiled, ns as string[]),
    from: (ns) => fromWith(compiled, ns as string[]),
    resolve: (layers) => resolveWith(compiled, layers),
    effective: (perms) => postpass(compiled, perms),

    union,
    intersect,
    subtract,
    equals,
    isSuperset,
    canGrant,

    explain: (input, name) => explainWith(compiled, input, name),

    encode: (perms, codec) => encode(compiled, perms, codec),
    decode: (value, codec) => decode(compiled, value, codec),

    catalog: () => catalog(compiled),
    buildLock: (version) => buildLock(compiled, version),
    diffLock: (previous) => diffLock(compiled, previous),

    defineRoles: (defs) => {
      const out: Record<string, bigint> = {};
      for (const role of Object.keys(defs)) {
        out[role] = packWith(compiled, defs[role] as unknown as string[]);
      }
      return Object.freeze(out) as { readonly [K in keyof typeof defs]: bigint };
    },

    authorize: (perms, requirement) =>
      authorize(compiled, perms, requirement) as AuthorizeDecision<FlagName<T>>,
    check: (perms, requirement) =>
      authorize(compiled, perms, requirement).granted,

    createStore: (init) => createStore(init ?? {}),
    createResolver: (opts) => createResolver(opts),
  };
}

export type { StoreSnapshot };
