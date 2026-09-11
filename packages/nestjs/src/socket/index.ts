/**
 * `@tahanabavi/typewire-nestjs/socket`
 * ===================================
 * Bind a NestJS gateway to `@tahanabavi/typesocket` contracts: the wire event
 * name comes from the contract, inbound frames are validated against `request`,
 * acknowledgements against `ack`, and outbound pushes against `payload`.
 *
 * One contract object serves both ends. typesocket events declare their own
 * `direction`, so the client emits `client->server` and listens to
 * `server->client` while a gateway does the reverse — from the same file, with
 * no mirrored second declaration to drift.
 *
 * A separate entry point because it needs `@nestjs/websockets`, which an app
 * with no gateway should not have to install.
 */

export { bindSocketContracts, isInboundEvent } from './contract'
export {
  SocketEvent,
  SocketEventInfo,
  SocketPayload,
  getSocketEvent,
} from './socket-event.decorator'
export { SocketAckInterceptor } from './ack.interceptor'
export { SocketContractException } from './exceptions'
export { createSocketEmitter, emitSocketEvent } from './emitter'
export { createSocketPermissionGuard } from './permission.guard'
export type { SocketPermissionGuardConfig } from './permission.guard'
export { SOCKET_EVENT_METADATA, SOCKET_OPTIONS_METADATA } from './constants'
export type {
  BoundSocketContracts,
  BoundSocketEvent,
  InferSocketAck,
  InferSocketPayload,
  InferSocketRequest,
  SocketEmitTarget,
  SocketEventOptions,
} from './types'
