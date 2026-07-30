import type { Compiled } from "./compile";
import type { Lock, LockViolation } from "./types";

/**
 * Build the `permissions.lock.json` manifest: a flat, language-neutral
 * `name → bit` map. It is the drift-detection baseline *and* the cross-project
 * interop artifact — a Go or Python service needs only this file and three lines
 * of bit math, not this package.
 */
export function buildLock(compiled: Compiled, version = 1): Lock {
  const flags: Lock["flags"] = {};
  for (const flag of compiled.byName.values()) {
    flags[flag.name] = flag.def.deprecated
      ? { bit: flag.bit, deprecated: true }
      : { bit: flag.bit };
  }
  return { version, flags };
}

/**
 * Compare the current tree against a committed lock and report anything that
 * would change a stored bit's meaning. A non-empty result should fail CI.
 *
 *  - **bit-changed** — a flag kept its name but moved bit. Always corrupting.
 *  - **bit-reused**  — a name vanished and its bit now belongs to a *different*
 *    flag. Either an intentional rename (same concept, review & re-commit the
 *    lock) or a forbidden reuse (new concept on a burned bit) — the human
 *    decides, which is exactly what a failed lock check is for.
 *  - **removed**     — a flag vanished and freed its bit. Retire with
 *    `deprecated` instead, so the bit stays burned.
 */
export function diffLock(compiled: Compiled, previous: Lock): LockViolation[] {
  const violations: LockViolation[] = [];
  for (const name of Object.keys(previous.flags)) {
    const was = previous.flags[name];
    if (!was) continue;
    const current = compiled.byName.get(name);
    if (current) {
      if (current.bit !== was.bit) {
        violations.push({ kind: "bit-changed", name, was: was.bit, now: current.bit });
      }
      continue;
    }
    const ownerNow = compiled.byBit.get(was.bit);
    if (ownerNow !== undefined) {
      violations.push({ kind: "bit-reused", bit: was.bit, was: name, now: ownerNow });
    } else {
      violations.push({ kind: "removed", name, bit: was.bit });
    }
  }
  return violations;
}
