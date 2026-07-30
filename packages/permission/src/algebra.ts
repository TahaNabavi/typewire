/**
 * Pure set algebra over bitfields. Every operation works on the full `bigint`,
 * so unknown (newer-version) bits are always carried through untouched — the
 * §11.1 preservation invariant holds for free here.
 */

/** Bits in either set. */
export function union(a: bigint, b: bigint): bigint {
  return a | b;
}

/** Bits in both sets. */
export function intersect(a: bigint, b: bigint): bigint {
  return a & b;
}

/** Bits in `a` but not `b`. */
export function subtract(a: bigint, b: bigint): bigint {
  return a & ~b;
}

/** Exact equality. */
export function equals(a: bigint, b: bigint): boolean {
  return a === b;
}

/** Does `actor` hold every bit in `target` (and possibly more)? */
export function isSuperset(actor: bigint, target: bigint): boolean {
  return (actor & target) === target;
}

/**
 * May an actor grant a role/bundle? Only if they already hold every bit in it.
 *
 * This closes the classic privilege-escalation hole — a moderator minting a role
 * with `ADMINISTRATOR` and assigning it to themselves. It is three lines of bit
 * math, but it belongs in the library because every consumer forgets it.
 */
export function canGrant(actorPerms: bigint, roleBeingAssigned: bigint): boolean {
  return isSuperset(actorPerms, roleBeingAssigned);
}
