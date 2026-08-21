export { grpcTransport } from "./transport";

export {
  GrpcCode,
  codeName,
  parseCode,
  kindFromGrpcCode,
  statusFromGrpcCode,
  codeFromHttpStatus,
} from "./codes";

export { encodeFrame, decodeFrames, parseTrailer, trailerFromHeaders } from "./frames";
export type { GrpcFrame } from "./frames";

export type {
  GrpcCodec,
  GrpcEndpointFields,
  GrpcTransportConfig,
  ConnectErrorBody,
} from "./types";

// The module augmentation that adds `transport: "grpc"` to typefetch's registry
// lives in ./types — importing it for its side effect on the type system is what
// makes installing this package enough to unlock the contract shape.
import "./types";
