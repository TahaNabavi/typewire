import { SetMetadata } from "@nestjs/common";
import type { PermissionRequirement } from "@tahanabavi/typefetch";
import { TYPEFETCH_PERMISSION_METADATA } from "../constants";

/**
 * Declare a permission requirement on a route that isn't bound to a contract —
 * or to override the contract's `permission` key on one that is. The permission
 * guard reads this first and falls back to `endpoint.permission`.
 *
 * The flag names reference a `@tahanabavi/type-permission` bit map; they are the
 * same strings the guard's `authorize` (usually `P.authorize`) resolves.
 *
 * @example
 * ⁣@Post("ban")
 * ⁣@RequirePermission({ require: ["guild.KICK_MEMBERS"] })
 * banUser() { ... }
 *
 * @example any-of
 * ⁣@RequirePermission({ any: ["post.publish", "post.moderate"] })
 */
export function RequirePermission(
  requirement: PermissionRequirement,
): MethodDecorator & ClassDecorator {
  return SetMetadata(TYPEFETCH_PERMISSION_METADATA, requirement);
}
