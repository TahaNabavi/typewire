import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  type Type,
} from '@nestjs/common'
import type { PermissionRequirement } from '@tahanabavi/typesocket'
import type { PermissionDecisionLike } from '../guards/permission.guard'
import { SOCKET_EVENT_METADATA } from './constants'
import { SocketContractException } from './exceptions'
import type { BoundSocketEvent } from './types'

export interface SocketPermissionGuardConfig {
  /**
   * Read the actor's effective bitfield off the connected socket — whatever the
   * handshake put there (`client.data.user.perms`, a decoded token). May be
   * async. Authentication is assumed to have happened at connect time; this
   * guard only authorizes.
   */
  getPermissions: (client: any) => bigint | Promise<bigint>

  /**
   * Evaluate a requirement against the actor's bits. Pass your permission
   * instance's `P.authorize` — kept a plain function so this package needs no
   * dependency on `@tahanabavi/type-permission`, the same seam typefetch,
   * typesocket and the HTTP guard all use.
   */
  authorize: (
    perms: bigint,
    requirement: PermissionRequirement
  ) => PermissionDecisionLike

  /** Called on every denial before the frame is rejected — the audit-log seam. */
  onDeny?: (info: {
    event: BoundSocketEvent
    requirement: PermissionRequirement
    decision: PermissionDecisionLike
    context: ExecutionContext
  }) => void
}

/**
 * Enforce a `client->server` event's contract `permission` **server-side**.
 *
 * typesocket ships `createPermissionMiddleware` for the client, and says of it
 * that the check is UX only — a gateway guard is the real enforcement point.
 * This is that point, reading the same requirement off the same contract with
 * the same bit map.
 *
 * An event with no requirement always passes: enforcement is per-event and
 * purely additive.
 *
 * @example
 * export const SocketPermissionGuard = createSocketPermissionGuard({
 *   getPermissions: (client) => client.data.perms as bigint,
 *   authorize: P.authorize,
 * });
 *
 * ⁣@WebSocketGateway()
 * ⁣@UseGuards(SocketPermissionGuard)
 * class ChatGateway { … }
 */
export function createSocketPermissionGuard(
  config: SocketPermissionGuardConfig
): Type<CanActivate> {
  @Injectable()
  class SocketPermissionGuard implements CanActivate {
    async canActivate(context: ExecutionContext): Promise<boolean> {
      const event: BoundSocketEvent | undefined = Reflect.getMetadata(
        SOCKET_EVENT_METADATA,
        context.getHandler()
      )

      const requirement = (
        event?.def as { permission?: PermissionRequirement } | undefined
      )?.permission

      if (
        !requirement ||
        (!requirement.require?.length && !requirement.any?.length)
      ) {
        return true
      }

      const client = context.switchToWs().getClient()
      const perms = await config.getPermissions(client)
      const decision = config.authorize(perms, requirement)
      if (decision.granted) return true

      config.onDeny?.({ event: event!, requirement, decision, context })

      throw new SocketContractException(
        event!.eventId,
        requirement.reason ?? 'Insufficient permissions',
        'FORBIDDEN',
        {
          ...(decision.missing?.length ? { missing: decision.missing } : {}),
          ...(decision.missingAny?.length
            ? { missingAny: decision.missingAny }
            : {}),
        }
      )
    }
  }

  return SocketPermissionGuard
}
