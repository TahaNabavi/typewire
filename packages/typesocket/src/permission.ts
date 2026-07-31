import type { OutboundAuthorizer, PermissionRequirement } from "./types";

/**
 * The decision shape the guard needs from `authorize`. Declared structurally so
 * typesocket keeps **no dependency** on `@tahanabavi/type-permission` — pass that
 * package's `P.authorize`, whose `AuthorizeDecision` satisfies this. The same
 * seam typefetch's `createPermissionMiddleware` and the NestJS guard use.
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
  eventId: string;
  event: string;
  requirement: PermissionRequirement;
  decision: PermissionDecisionLike;
};

/**
 * Thrown from the emit call when an outbound frame is blocked **client-side**,
 * before it reaches the wire. For an ack'd event the emit's promise rejects with
 * it; for a fire-and-forget event the emit throws synchronously. Distinct from a
 * validation/ack error so callers can `instanceof`-check it.
 */
export class PermissionDeniedError extends Error {
  readonly code = "PERMISSION_DENIED";
  readonly eventId: string;
  readonly event: string;
  readonly missing: string[];
  readonly missingAny?: string[];

  constructor(info: PermissionDenyInfo) {
    super(
      info.requirement.reason ??
        `Blocked by permission: emit "${info.eventId}"`,
    );
    this.name = "PermissionDeniedError";
    this.eventId = info.eventId;
    this.event = info.event;
    this.missing = info.decision.missing ?? [];
    if (info.decision.missingAny?.length) {
      this.missingAny = info.decision.missingAny;
    }
  }
}

export type PermissionMiddlewareConfig = {
  /**
   * The actor's current permission bits, from an in-memory source (a store
   * snapshot, a decoded token). **Synchronous on purpose:** a fire-and-forget
   * emit resolves synchronously, so the check must too. Keep it cheap — it runs
   * on every outbound frame that declares a `permission`.
   */
  getPermissions: () => bigint;

  /**
   * Evaluate the event's requirement against the actor's bits. Pass your
   * permission instance's `P.authorize`. Kept a plain function so typesocket
   * needs no dependency on `@tahanabavi/type-permission`.
   */
  authorize: (
    perms: bigint,
    requirement: PermissionRequirement,
  ) => PermissionDecisionLike;

  /** Called on every client-side denial before the error is thrown. */
  onDeny?: (info: PermissionDenyInfo) => void;
};

/**
 * Build a pre-emit guard that enforces a `client->server` event's contract
 * [`permission`](./types) requirement **client-side** — the mirror of typefetch's
 * `createPermissionMiddleware` and the NestJS `createPermissionGuard`. It reads
 * `def.permission`, evaluates it with your injected `authorize`, and throws
 * {@link PermissionDeniedError} when the actor lacks the flags. Events without a
 * `permission` key pass through untouched.
 *
 * Register it via the `authorizeOutbound` client option (or
 * `client.setOutboundAuthorizer(...)`) — **not** `client.use()`, whose
 * middlewares can't throw to the caller. The check is **UX only**; a server-side
 * gateway guard is the real enforcement point.
 *
 * @example
 * import { P } from "./permissions";
 *
 * const client = new SocketClient(config, contracts, {
 *   authorizeOutbound: createPermissionMiddleware({
 *     getPermissions: () => store.getSnapshot().global,
 *     authorize: P.authorize,
 *   }),
 * });
 */
export function createPermissionMiddleware(
  config: PermissionMiddlewareConfig,
): OutboundAuthorizer {
  return ({ eventId, event, def }) => {
    const requirement = def.permission;
    // No requirement on this event → nothing to enforce.
    if (
      !requirement ||
      (!requirement.require?.length && !requirement.any?.length)
    ) {
      return;
    }

    const decision = config.authorize(config.getPermissions(), requirement);
    if (decision.granted) return;

    const info: PermissionDenyInfo = { eventId, event, requirement, decision };
    config.onDeny?.(info);
    throw new PermissionDeniedError(info);
  };
}
