/**
 * `@tahanabavi/typewire-nestjs/grpc`
 * =================================
 * Serve gRPC contracts from NestJS over Connect's JSON protocol — the same wire
 * `@tahanabavi/typefetch-grpc` speaks by default.
 *
 * It is a separate entry point for the reason every transport is: the main
 * entry stays free of a peer dependency an HTTP-only app would never install.
 * `@tahanabavi/typefetch-grpc` is what augments typefetch's `TransportRegistry`
 * with `transport: "grpc"`, so any app that has a gRPC contract to serve has it
 * already.
 */

export { GrpcEndpoint } from "./grpc-endpoint.decorator";
export { ConnectExceptionFilter } from "./connect-exception.filter";
export {
  ConnectDeadlineInterceptor,
  GrpcDeadline,
  GRPC_DEADLINE_KEY,
  parseDeadline,
} from "./deadline";
export {
  GrpcException,
  codeFromThrownStatus,
  toConnectError,
} from "./errors";
export type { ConnectErrorPayload } from "./errors";
export type {
  GrpcContractEndpoint,
  GrpcDeadlineInfo,
  GrpcEndpointOptions,
} from "./types";

// Re-exported so a handler can name a code without a second import; the source
// of truth stays the transport package.
export { GrpcCode, codeName, statusFromGrpcCode } from "@tahanabavi/typefetch-grpc";
