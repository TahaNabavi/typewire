import type { Compiled } from "./compile";

function maskOf(compiled: Compiled, name: string): bigint {
  const flag = compiled.byName.get(name);
  if (!flag) throw new Error(`[type-permission] unknown flag "${name}"`);
  return flag.mask;
}

/** Does the bitfield hold this flag? Unknown bits are irrelevant to a check. */
export function has(compiled: Compiled, perms: bigint, name: string): boolean {
  return (perms & maskOf(compiled, name)) !== 0n;
}

/** Does the bitfield hold *every* listed flag? Empty list ⇒ `true` (vacuous). */
export function hasAll(
  compiled: Compiled,
  perms: bigint,
  names: readonly string[],
): boolean {
  for (const name of names) {
    if ((perms & maskOf(compiled, name)) === 0n) return false;
  }
  return true;
}

/** Does the bitfield hold *at least one* listed flag? Empty list ⇒ `false`. */
export function hasAny(
  compiled: Compiled,
  perms: bigint,
  names: readonly string[],
): boolean {
  for (const name of names) {
    if ((perms & maskOf(compiled, name)) !== 0n) return true;
  }
  return false;
}

/**
 * The named flags a bitfield holds, in declaration order. Unknown (newer-version)
 * bits are skipped — there is no name to give them in this version — which is why
 * `names`/`grouped` codecs are documented as lossy for unknown bits.
 */
export function list(compiled: Compiled, perms: bigint): string[] {
  const out: string[] = [];
  for (const flag of compiled.byName.values()) {
    if ((perms & flag.mask) !== 0n) out.push(flag.name);
  }
  return out;
}

/** Of the listed flags, the ones the bitfield is missing — for a 403 body. */
export function missing(
  compiled: Compiled,
  perms: bigint,
  names: readonly string[],
): string[] {
  const out: string[] = [];
  for (const name of names) {
    if ((perms & maskOf(compiled, name)) === 0n) out.push(name);
  }
  return out;
}
