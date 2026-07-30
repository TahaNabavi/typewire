import type { Compiled } from "./compile";
import type { Layer } from "./types";

/** Union a `bigint | bigint[] | undefined` into a single mask. */
function fold(masks: bigint | bigint[] | undefined): bigint {
  if (masks === undefined) return 0n;
  if (typeof masks === "bigint") return masks;
  let out = 0n;
  for (const m of masks) out |= m;
  return out;
}

/**
 * The three post-passes, in the one order that is correct
 * (see `docs/PERMISSION.md` §2):
 *
 *  1. `grantsAll` — if an admin bit survived, OR in the full mask. It only *adds*
 *     bits, so an actor's unknown (newer-version) bits are preserved.
 *  2. `implies`  — one pass over precomputed closures (each is already
 *     transitive, so a single pass suffices).
 *  3. `requires` — gating, last, iterated to a fixpoint so a broken prerequisite
 *     cascades (A requires B, B requires C, C denied ⇒ A and B both fall).
 *
 * Only known bits are ever cleared; unknown bits pass through untouched.
 */
export function postpass(compiled: Compiled, input: bigint): bigint {
  let perms = input;

  // 1. grantsAll
  if (compiled.grantsAllMask !== 0n && (perms & compiled.grantsAllMask) !== 0n) {
    perms |= compiled.fullMask;
  }

  // 2. implies
  for (const [flagMask, closure] of compiled.impliesList) {
    if ((perms & flagMask) !== 0n) perms |= closure;
  }

  // 3. requires — fixpoint. Each iteration only clears bits (monotonic), so it
  // converges in at most `requiresList.length` rounds.
  if (compiled.requiresList.length > 0) {
    for (let guard = 0; guard <= compiled.requiresList.length; guard++) {
      let changed = false;
      for (const [flagMask, requiredMask] of compiled.requiresList) {
        if (
          (perms & flagMask) !== 0n &&
          (perms & requiredMask) !== requiredMask
        ) {
          perms &= ~flagMask;
          changed = true;
        }
      }
      if (!changed) break;
    }
  }

  return perms;
}

/**
 * Fold ordered layers into an effective bitfield.
 *
 * Each layer applies `(perms & ~deny) | allow`, with `allow`/`deny` arrays
 * unioned first — so allow beats deny within a tier and a later tier beats an
 * earlier one. The post-passes run once at the end.
 */
export function resolveWith(compiled: Compiled, layers: Layer[]): bigint {
  let perms = 0n;
  for (const layer of layers) {
    const allow = fold(layer.allow);
    const deny = fold(layer.deny);
    perms = (perms & ~deny) | allow;
  }
  return postpass(compiled, perms);
}

/**
 * Pack flag names into a **raw** bitfield — a plain OR of their bits, with no
 * post-passes. This is the right primitive for building role bundles and layer
 * masks that will themselves be fed into `resolve()`; applying `requires` gating
 * to a bare role would wrongly strip a flag whose prerequisite is granted by a
 * *different* layer.
 */
export function packWith(compiled: Compiled, names: string[]): bigint {
  let perms = 0n;
  for (const name of names) {
    const flag = compiled.byName.get(name);
    if (!flag) throw new Error(`[type-permission] unknown flag "${name}"`);
    perms |= flag.mask;
  }
  return perms;
}

/**
 * Build an **effective** bitfield from flag names: pack them, then run the
 * post-passes. This is the simple-app entry point — the names go in, `implies`
 * is applied, and `has()` behaves as expected without any layer ceremony.
 */
export function fromWith(compiled: Compiled, names: string[]): bigint {
  return postpass(compiled, packWith(compiled, names));
}
