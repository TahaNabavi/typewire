import type { Compiled } from "./compile";
import type { Layer } from "./types";

export type ExplainReason =
  | "granted-direct"
  | "granted-admin"
  | "granted-implied"
  | "denied-missing"
  | "denied-requires"
  | "denied-layer";

export type ExplainTraceEntry = {
  tier: number;
  source?: string;
  effect: "allow" | "deny";
};

export type ExplainResult = {
  name: string;
  granted: boolean;
  reason: ExplainReason;
  /** Human-readable one-liner — safe to log or show a support engineer. */
  detail: string;
  /** Which tiers last touched this bit, when `explain` is given layers. */
  trace: ExplainTraceEntry[];
};

function foldMask(masks: bigint | bigint[] | undefined): bigint {
  if (masks === undefined) return 0n;
  if (typeof masks === "bigint") return masks;
  let out = 0n;
  for (const m of masks) out |= m;
  return out;
}

/**
 * Answer "why is this flag granted / denied?" in one call, on either side of the
 * wire — the feature that makes the package pleasant, not merely correct.
 *
 * Pass **layers** for a full tier trace, or a **bitfield** to reason about the
 * post-passes alone. Reasoning is most precise from pre-resolution input (layers
 * or a raw `pack()`), because an already-gated flag has no bit left to explain.
 */
export function explainWith(
  compiled: Compiled,
  input: bigint | Layer[],
  name: string,
): ExplainResult {
  const flag = compiled.byName.get(name);
  if (!flag) throw new Error(`[type-permission] unknown flag "${name}"`);
  const mask = flag.mask;

  // ---- Stage 0: fold to the pre-post-pass state, tracking the target bit. ----
  const trace: ExplainTraceEntry[] = [];
  let pre = 0n;
  if (Array.isArray(input)) {
    input.forEach((layer, tier) => {
      const allow = foldMask(layer.allow);
      const deny = foldMask(layer.deny);
      if ((allow & mask) !== 0n) {
        trace.push({ tier, source: layer.source, effect: "allow" });
      } else if ((deny & mask) !== 0n) {
        trace.push({ tier, source: layer.source, effect: "deny" });
      }
      pre = (pre & ~deny) | allow;
    });
  } else {
    pre = input;
  }

  // ---- Stages 1–3: replay the post-passes, keeping the intermediates. ----
  const adminFired =
    compiled.grantsAllMask !== 0n && (pre & compiled.grantsAllMask) !== 0n;
  const afterAdmin = adminFired ? pre | compiled.fullMask : pre;

  let afterImplies = afterAdmin;
  let impliedBy: string | undefined;
  for (const [flagMask, closure] of compiled.impliesList) {
    if ((afterImplies & flagMask) !== 0n) {
      if (
        impliedBy === undefined &&
        (afterAdmin & mask) === 0n &&
        (closure & mask) !== 0n
      ) {
        impliedBy = compiled.byBit.get(logBit(flagMask));
      }
      afterImplies |= closure;
    }
  }

  const final = replayRequires(compiled, afterImplies);
  const granted = (final & mask) !== 0n;

  // ---- Classify. ----
  const directlySet = (pre & mask) !== 0n;
  if (granted) {
    if (directlySet) {
      return done("granted-direct", `${name} is granted directly.`);
    }
    if (adminFired && (afterAdmin & mask) !== 0n) {
      const admin = firstName(compiled, compiled.grantsAllMask & pre);
      return done(
        "granted-admin",
        `${name} is granted by ${admin ?? "an administrator flag"} (grantsAll).`,
      );
    }
    if (impliedBy) {
      return done("granted-implied", `${name} is implied by ${impliedBy}.`);
    }
    return done("granted-direct", `${name} is granted.`);
  }

  // Denied. Was it present before `requires` gated it off?
  if ((afterImplies & mask) !== 0n) {
    const need = (flag.def.requires ?? []).filter((r) => {
      const dep = compiled.byName.get(r);
      return dep ? (final & dep.mask) === 0n : false;
    });
    const gate = need[0] ?? flag.def.requires?.[0] ?? "a prerequisite";
    return done(
      "denied-requires",
      `${name} is gated by ${gate}, which was denied.`,
    );
  }
  // Was it explicitly denied by a layer (rather than simply never granted)?
  if (trace.length > 0 && trace[trace.length - 1]?.effect === "deny") {
    const t = trace[trace.length - 1];
    return done(
      "denied-layer",
      `${name} was denied by tier ${t?.tier}${t?.source ? ` (${t.source})` : ""}.`,
    );
  }
  return done("denied-missing", `${name} was never granted.`);

  function done(reason: ExplainReason, detail: string): ExplainResult {
    return { name, granted, reason, detail, trace };
  }
}

/** Requires fixpoint, isolated so `explain` and `resolve` stay in step. */
function replayRequires(compiled: Compiled, input: bigint): bigint {
  let perms = input;
  if (compiled.requiresList.length === 0) return perms;
  for (let guard = 0; guard <= compiled.requiresList.length; guard++) {
    let changed = false;
    for (const [flagMask, requiredMask] of compiled.requiresList) {
      if ((perms & flagMask) !== 0n && (perms & requiredMask) !== requiredMask) {
        perms &= ~flagMask;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return perms;
}

/** Index of the single set bit in a one-bit mask. */
function logBit(mask: bigint): number {
  let n = 0;
  let m = mask;
  while (m > 1n) {
    m >>= 1n;
    n++;
  }
  return n;
}

/** The first named flag present in `bits`, in declaration order. */
function firstName(compiled: Compiled, bits: bigint): string | undefined {
  for (const flag of compiled.byName.values()) {
    if ((bits & flag.mask) !== 0n) return flag.name;
  }
  return undefined;
}
