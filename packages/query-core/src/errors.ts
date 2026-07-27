/**
 * Thrown when an in-flight fetch is aborted by `cancel()` / `cancelQueries()`.
 *
 * A cancellation is not a failure: the engine catches this, leaves the last
 * good data in place, and returns `fetchStatus` to `"idle"` without ever moving
 * the query to `status: "error"`. It is exported so callers awaiting
 * `fetchQuery` can tell "you cancelled this" from "the request failed".
 */
export class CancelledError extends Error {
  constructor(message = "Query was cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

/** Whether a thrown value represents a cancellation rather than a failure. */
export function isCancelledError(error: unknown): boolean {
  if (error instanceof CancelledError) return true;
  // `AbortController.abort()` surfaces as a DOMException in browsers and as an
  // Error with the same `name` under Node's undici — match on the name so both
  // runtimes agree, without referencing DOMException (absent in some runtimes).
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "AbortError"
  );
}
