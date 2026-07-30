import type { FlagDef, PermissionTree } from "./types";

/** One flag, flattened and precompiled. */
export type CompiledFlag = {
  name: string;
  module: string;
  member: string;
  bit: number;
  /** `1n << bit` — precomputed so a check is one `&`. */
  mask: bigint;
  def: FlagDef;
};

/**
 * A permission tree flattened, validated, and precompiled into the masks the
 * evaluator needs. Everything here is computed once at `definePermissions()`
 * time so the runtime hot path (`has`, `resolve`) is pure bit math.
 */
export type Compiled = {
  tree: PermissionTree;
  /** name → flag, in declaration order (insertion order is preserved by Map). */
  byName: Map<string, CompiledFlag>;
  /** bit → name, for `list()` and duplicate detection. */
  byBit: Map<number, string>;
  /** OR of every known bit. */
  fullMask: bigint;
  /** OR of every `grantsAll` flag's bit. */
  grantsAllMask: bigint;
  /** `[flagMask, impliedClosureMask]` for flags with implications. */
  impliesList: Array<[bigint, bigint]>;
  /** `[flagMask, requiredMask]` for gated flags. */
  requiresList: Array<[bigint, bigint]>;
};

const FLAG_NAME = /^[A-Za-z0-9_]+\.[A-Za-z0-9_]+$/;

function fail(message: string): never {
  throw new Error(`[type-permission] ${message}`);
}

/** Flatten `{ module: { member: def } }` into ordered `"module.member"` flags. */
function flatten(tree: PermissionTree): CompiledFlag[] {
  const flags: CompiledFlag[] = [];
  for (const module of Object.keys(tree)) {
    const members = tree[module];
    if (!members) continue;
    for (const member of Object.keys(members)) {
      const def = members[member];
      if (!def) continue;
      const name = `${module}.${member}`;
      if (!FLAG_NAME.test(name)) {
        fail(
          `invalid flag name "${name}": module and member must match [A-Za-z0-9_]`,
        );
      }
      const { bit } = def;
      if (!Number.isInteger(bit) || bit < 0) {
        fail(`flag "${name}" has an invalid bit ${String(bit)} — expected a non-negative integer`);
      }
      flags.push({
        name,
        module,
        member,
        bit,
        mask: 1n << BigInt(bit),
        def,
      });
    }
  }
  return flags;
}

/**
 * Depth-first transitive closure of `implies`, returning the union of implied
 * *bits* (excluding the flag's own bit). Detects and rejects cycles, which would
 * otherwise loop forever.
 */
function impliesClosure(
  start: string,
  byName: Map<string, CompiledFlag>,
): bigint {
  const stack: string[] = [];
  const seen = new Set<string>();

  const walk = (name: string): bigint => {
    const flag = byName.get(name);
    if (!flag) fail(`"${name}" implies unknown flag`);
    if (stack.includes(name)) {
      fail(`implies cycle: ${[...stack, name].join(" → ")}`);
    }
    if (seen.has(name)) return 0n;
    seen.add(name);
    stack.push(name);
    let mask = 0n;
    for (const target of flag.def.implies ?? []) {
      const child = byName.get(target);
      if (!child) fail(`"${name}" implies unknown flag "${target}"`);
      mask |= child.mask | walk(target);
    }
    stack.pop();
    return mask;
  };

  return walk(start);
}

/**
 * Validate and precompile a permission tree. Throws on: an invalid or duplicate
 * bit, a dangling `implies`/`requires` reference, or an `implies` cycle — all at
 * definition time, so a bad contract is a startup crash rather than a wrong
 * answer in production.
 */
export function compileTree(tree: PermissionTree): Compiled {
  const flags = flatten(tree);

  const byName = new Map<string, CompiledFlag>();
  const byBit = new Map<number, string>();
  let fullMask = 0n;
  let grantsAllMask = 0n;

  for (const flag of flags) {
    if (byName.has(flag.name)) fail(`duplicate flag "${flag.name}"`);
    const owner = byBit.get(flag.bit);
    if (owner !== undefined) {
      fail(
        `bit ${flag.bit} is used by both "${owner}" and "${flag.name}" — ` +
          `each bit must be unique and permanent`,
      );
    }
    byName.set(flag.name, flag);
    byBit.set(flag.bit, flag.name);
    fullMask |= flag.mask;
    if (flag.def.grantsAll) grantsAllMask |= flag.mask;
  }

  const impliesList: Array<[bigint, bigint]> = [];
  const requiresList: Array<[bigint, bigint]> = [];

  for (const flag of byName.values()) {
    if (flag.def.implies?.length) {
      const closure = impliesClosure(flag.name, byName);
      if (closure !== 0n) impliesList.push([flag.mask, closure]);
    }
    if (flag.def.requires?.length) {
      let required = 0n;
      for (const target of flag.def.requires) {
        const dep = byName.get(target);
        if (!dep) fail(`"${flag.name}" requires unknown flag "${target}"`);
        required |= dep.mask;
      }
      requiresList.push([flag.mask, required]);
    }
  }

  return {
    tree,
    byName,
    byBit,
    fullMask,
    grantsAllMask,
    impliesList,
    requiresList,
  };
}
