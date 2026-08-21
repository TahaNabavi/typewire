import type { AnyEndpointDefZ } from "@tahanabavi/typefetch";
import type { GrpcEndpointFields } from "@tahanabavi/typefetch-grpc";
import type { ContractEndpointOptions } from "../types";

/**
 * A contract endpoint declared for the gRPC transport.
 *
 * `GrpcEndpointFields` comes from `@tahanabavi/typefetch-grpc`, which is also
 * what augments typefetch's `TransportRegistry` — so this entry point's peer
 * dependency is not an extra cost: without that package installed, the contract
 * this decorator binds could not have been written in the first place.
 */
export type GrpcContractEndpoint = AnyEndpointDefZ & GrpcEndpointFields;

export interface GrpcEndpointOptions extends ContractEndpointOptions {
  /**
   * Serve this RPC under a different service name than the contract declares.
   *
   * The escape hatch for a proxy that rewrites the path; the contract stays the
   * source of truth for the client. Rarely needed.
   */
  service?: string;
}

/**
 * What a handler learns about the deadline the caller asked for.
 *
 * A gRPC deadline is not the same thing as a client-side timeout: it asks the
 * *server* to stop working. Which is worth nothing unless the work can hear it,
 * so the `signal` is here to be handed to the database driver, the outbound
 * `fetch`, or anything else that accepts one.
 */
export type GrpcDeadlineInfo = {
  /** Milliseconds the caller allowed, from when the request arrived. */
  timeoutMs: number;
  /** `Date.now()` value the deadline expires at. */
  expiresAt: number;
  /** Aborts when the deadline passes. */
  signal: AbortSignal;
  /** Milliseconds left, never negative. */
  remaining(): number;
};
