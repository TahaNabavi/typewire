import { z } from "zod";
import type { ErrorKind } from "../types";

/**
 * Error classification
 * ====================
 * Maps a transport's own failure vocabulary onto the shared {@link ErrorKind}
 * taxonomy, so application code can handle failures without knowing which wire
 * produced them.
 *
 * This file owns the `http` mapping because `http` is the built-in transport.
 * Every other transport maps its own codes inside its own adapter package.
 */

/**
 * Classify an HTTP status.
 *
 * Deliberately **not** the official gRPC "HTTP to gRPC status" table, which is
 * written for proxies and maps `404` to `unimplemented` — correct when a gateway
 * cannot find a route, badly wrong for a REST client where `404` is the whole
 * point of the request. This maps REST intent instead, which is what an endpoint
 * declaring `path: "/users/:id"` actually means by each status.
 */
export function kindFromHttpStatus(status: number | undefined): ErrorKind {
  if (status === undefined) return "unknown";

  switch (status) {
    case 400:
      return "invalid_argument";
    case 401:
      return "unauthenticated";
    case 403:
      return "permission_denied";
    case 404:
      return "not_found";
    case 408:
      return "deadline_exceeded";
    case 409:
      return "already_exists";
    case 412:
      return "failed_precondition";
    case 416:
      return "out_of_range";
    case 429:
      return "resource_exhausted";
    // Nginx's "client closed request". Not an IANA status, but it is what a
    // cancelled request is logged as, and misreporting it as a client error
    // would make a user navigating away look like a bug.
    case 499:
      return "cancelled";
    case 501:
      return "unimplemented";
    case 503:
      return "unavailable";
    case 504:
      return "deadline_exceeded";
  }

  if (status >= 500) return "internal";
  if (status >= 400) return "invalid_argument";
  return "unknown";
}

/**
 * Classify a failure that never produced a response: a thrown `ZodError`, an
 * aborted request, or a network-level `TypeError` from `fetch`.
 *
 * The browser withholds the cause of a network failure for security reasons, so
 * `network` is as specific as this can honestly be — it covers DNS failure, TLS
 * failure, being offline, and a blocked CORS preflight alike.
 */
export function kindFromThrown(err: unknown): ErrorKind {
  if (err instanceof z.ZodError) return "validation";

  const name = (err as { name?: unknown } | null)?.name;
  if (name === "AbortError") return "cancelled";
  if (name === "TimeoutError") return "deadline_exceeded";
  if (err instanceof TypeError) return "network";

  return "unknown";
}
