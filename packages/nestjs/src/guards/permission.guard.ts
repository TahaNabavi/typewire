import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  Optional,
  type Type,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { EndpointDefZ, PermissionRequirement } from "@tahanabavi/typefetch";
import {
  TYPEFETCH_ENDPOINT_METADATA,
  TYPEFETCH_PERMISSION_METADATA,
} from "../constants";

/**
 * The decision shape the guard needs from `authorize`. Declared structurally so
 * this package keeps depending only on typefetch — pass `P.authorize` from
 * `@tahanabavi/type-permission`, whose `AuthorizeDecision` satisfies this.
 */
export type PermissionDecisionLike = {
  granted: boolean;
  /** Flags demanded by `require` that the actor lacks. */
  missing?: string[];
  /** The `any` set, when it was the failing condition. */
  missingAny?: string[];
  reason?: string;
};

export interface PermissionGuardConfig {
  /**
   * Read the actor's effective bitfield off the request — whatever your auth
   * layer put there (`req.user.perms`, a decoded JWT claim, a per-scope lookup).
   * May be async. Authentication is assumed to have already happened upstream;
   * this guard only authorizes.
   */
  getPermissions: (request: any) => bigint | Promise<bigint>;

  /**
   * Evaluate a requirement against the actor's bits. Pass your permission
   * instance's `P.authorize` — it maps the requirement's flag names to bits and
   * returns whether they are held. Kept as a plain function so this package
   * needs no dependency on `@tahanabavi/type-permission`.
   */
  authorize: (
    perms: bigint,
    requirement: PermissionRequirement,
  ) => PermissionDecisionLike;

  /**
   * Called on every denial before the 403 is thrown — the audit-log seam.
   * Authorization denials are a security signal; log them here in production.
   */
  onDeny?: (info: {
    decision: PermissionDecisionLike;
    requirement: PermissionRequirement;
    context: ExecutionContext;
  }) => void;

  /**
   * Build the thrown exception. Defaults to a `ForbiddenException` whose body is
   * `{ message, code: "FORBIDDEN", missing, missingAny? }`.
   */
  onForbidden?: (info: {
    decision: PermissionDecisionLike;
    requirement: PermissionRequirement;
    context: ExecutionContext;
  }) => unknown;
}

/**
 * Build a NestJS guard that enforces the `permission` requirement declared on a
 * contract endpoint (or via `@RequirePermission()`), reusing the exact bit map
 * the frontend checks — so the route can't drift from the button.
 *
 * A route with no requirement (no `@RequirePermission` and no `endpoint.permission`)
 * always passes: enforcement is purely additive. `@RequirePermission()` metadata
 * wins over a contract's `permission` when both are present, so you can override
 * per-route.
 *
 * Register it per-route with `@UseGuards(PermissionGuard)`, or globally:
 *
 * @example
 * import { APP_GUARD } from "@nestjs/core";
 * import { createPermissionGuard } from "@tahanabavi/typewire-nestjs";
 * import { P } from "./permissions";
 *
 * export const PermissionGuard = createPermissionGuard({
 *   getPermissions: (req) => req.user.perms as bigint,
 *   authorize: P.authorize,
 *   onDeny: ({ decision, context }) =>
 *     logger.warn("permission denied", { missing: decision.missing }),
 * });
 *
 * ⁣@Module({ providers: [{ provide: APP_GUARD, useClass: PermissionGuard }] })
 * export class AppModule {}
 */
export function createPermissionGuard(
  config: PermissionGuardConfig,
): Type<CanActivate> {
  @Injectable()
  class PermissionGuard implements CanActivate {
    private readonly reflector: Reflector;

    // Reflector is provided by @nestjs/core; default keeps the guard usable when
    // instantiated by hand (e.g. in a unit test) without a DI container.
    constructor(@Optional() reflector?: Reflector) {
      this.reflector = reflector ?? new Reflector();
    }

    async canActivate(context: ExecutionContext): Promise<boolean> {
      const requirement = this.resolveRequirement(context);
      // No requirement on this route → nothing to enforce.
      if (!requirement || (!requirement.require?.length && !requirement.any?.length)) {
        return true;
      }

      const request = context.switchToHttp().getRequest();
      const perms = await config.getPermissions(request);
      const decision = config.authorize(perms, requirement);
      if (decision.granted) return true;

      config.onDeny?.({ decision, requirement, context });

      if (config.onForbidden) {
        const thrown = config.onForbidden({ decision, requirement, context });
        throw thrown instanceof Error
          ? thrown
          : new ForbiddenException(thrown as Record<string, unknown>);
      }

      throw new ForbiddenException({
        statusCode: 403,
        code: "FORBIDDEN",
        message: requirement.reason ?? "Insufficient permissions",
        ...(decision.missing?.length ? { missing: decision.missing } : {}),
        ...(decision.missingAny?.length ? { missingAny: decision.missingAny } : {}),
      });
    }

    /**
     * `@RequirePermission()` metadata (handler over class) takes precedence; a
     * contract endpoint's `permission` key is the fallback.
     */
    private resolveRequirement(
      context: ExecutionContext,
    ): PermissionRequirement | undefined {
      const explicit = this.reflector.getAllAndOverride<
        PermissionRequirement | undefined
      >(TYPEFETCH_PERMISSION_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (explicit) return explicit;

      const endpoint = this.reflector.get<EndpointDefZ | undefined>(
        TYPEFETCH_ENDPOINT_METADATA,
        context.getHandler(),
      );
      return endpoint?.permission;
    }
  }

  return PermissionGuard;
}
