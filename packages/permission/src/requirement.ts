import type { Compiled } from "./compile";
import { hasAny, missing } from "./check";
import type { AuthorizeDecision, PermissionRequirement } from "./types";

/**
 * Evaluate a {@link PermissionRequirement} — the optional `permission` key a
 * transport contract carries — against a bitfield, returning a decision rich
 * enough to build a 403 body and an audit-log entry from.
 *
 * `require` needs *all* listed flags; `any` needs *at least one*; when both are
 * present, both must pass. An empty/absent requirement grants.
 */
export function authorize<Name extends string = string>(
  compiled: Compiled,
  perms: bigint,
  requirement: PermissionRequirement<Name>,
): AuthorizeDecision<Name> {
  const missingAll = requirement.require
    ? (missing(compiled, perms, requirement.require) as Name[])
    : [];

  const anyOk =
    !requirement.any ||
    requirement.any.length === 0 ||
    hasAny(compiled, perms, requirement.any);

  const granted = missingAll.length === 0 && anyOk;

  const decision: AuthorizeDecision<Name> = { granted, missing: missingAll };
  if (!anyOk && requirement.any) decision.missingAny = [...requirement.any];
  if (requirement.reason !== undefined) decision.reason = requirement.reason;
  return decision;
}
