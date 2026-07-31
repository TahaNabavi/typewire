import type { Middleware, PermissionRequirement } from "@/types";

/**
 * The decision shape the middleware needs from `authorize`. Declared structurally
 * so typefetch keeps **no dependency** on `@tahanabavi/type-permission` — pass
 * that package's `P.authorize`, whose `AuthorizeDecision` satisfies this. Same
 * seam the NestJS `createPermissionGuard` uses on the server.
 */
export type PermissionDecisionLike = {
  granted: boolean;
  /** Flags demanded by `require` that the actor lacks. */
  missing?: string[];
  /** The `any` set, when it was the failing condition. */
  missingAny?: string[];
  reason?: string;
};

/** Context handed to `onDeny` and carried by {@link PermissionDeniedError}. */
export type PermissionDenyInfo = {
  method: string;
  path: string;
  requirement: PermissionRequirement;
  decision: PermissionDecisionLike;
};

/**
 * Thrown by {@link createPermissionMiddleware} when a call is blocked **before it
 * leaves the browser**. Distinct from a network/validation error so callers can
 * `instanceof`-check it, and shaped like the server's 403 (`status`, `missing`)
 * so both failures read the same.
 */
export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly status = 403;
  readonly method: string;
  readonly path: string;
  readonly missing: string[];
  readonly missingAny?: string[];

  constructor(info: PermissionDenyInfo) {
    super(
      info.requirement.reason ??
        `Blocked by permission: ${info.method} ${info.path}`,
    );
    this.name = "PermissionDeniedError";
    this.method = info.method;
    this.path = info.path;
    this.missing = info.decision.missing ?? [];
    if (info.decision.missingAny?.length) {
      this.missingAny = info.decision.missingAny;
    }
  }
}

export type PermissionMiddlewareConfig = {
  /**
   * The actor's current permission bits — from wherever your app keeps them
   * (a store snapshot, a decoded JWT). **Keep it cheap:** it runs on every
   * request that declares a `permission`. May be async.
   */
  getPermissions: () => bigint | Promise<bigint>;

  /**
   * Evaluate the endpoint's requirement against the actor's bits. Pass your
   * permission instance's `P.authorize` — it maps flag names to bits and returns
   * whether they are held. Kept a plain function so typefetch needs no dependency
   * on `@tahanabavi/type-permission`.
   */
  authorize: (
    perms: bigint,
    requirement: PermissionRequirement,
  ) => PermissionDecisionLike;

  /**
   * Called on every client-side denial before the error is thrown — the audit
   * seam. Denials are worth logging even when they never reach the server.
   */
  onDeny?: (info: PermissionDenyInfo) => void;
};

/**
 * A middleware that enforces an endpoint's contract [`permission`](../types)
 * requirement **client-side**, before the request is sent — the mirror of the
 * server's `createPermissionGuard`. It reads `ctx.endpoint.permission`,
 * evaluates it with your injected `authorize`, and throws
 * {@link PermissionDeniedError} when the actor lacks the flags. Endpoints without
 * a `permission` key pass straight through, so it is safe to register globally.
 *
 * The client check is **UX only** — the server recomputes from the session and
 * is the real enforcement point. This just skips a request that would 403 and
 * lets the UI disable what it shouldn't offer.
 *
 * @example
 * import { P } from "./permissions";
 *
 * client.use(createPermissionMiddleware({
 *   getPermissions: () => store.getSnapshot().global,
 *   authorize: P.authorize,
 *   onDeny: ({ decision }) => console.warn("denied", decision.missing),
 * }));
 */
export function createPermissionMiddleware(
  config: PermissionMiddlewareConfig,
): Middleware {
  return async (ctx, next) => {
    const requirement = ctx.endpoint.permission;
    // No requirement on this endpoint → nothing to enforce.
    if (
      !requirement ||
      (!requirement.require?.length && !requirement.any?.length)
    ) {
      return next();
    }

    const perms = await config.getPermissions();
    const decision = config.authorize(perms, requirement);
    if (decision.granted) return next();

    const info: PermissionDenyInfo = {
      method: ctx.endpoint.method,
      path: ctx.endpoint.path,
      requirement,
      decision,
    };
    config.onDeny?.(info);
    throw new PermissionDeniedError(info);
  };
}
