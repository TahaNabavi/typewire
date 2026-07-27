import { CancelledError, isCancelledError } from "./errors";
import type { RetryDelayValue, RetryValue } from "./types";

/**
 * `true` is capped rather than infinite: an unbounded retry loop in a shared
 * engine is a footgun that turns one broken endpoint into a permanent request
 * storm. Callers who genuinely want more pass a number or a predicate.
 */
const RETRY_TRUE_ATTEMPTS = 3;

/**
 * Whether to make another attempt after `failureCount` consecutive failures.
 * `failureCount` is 1 on the first failure, so `retry: 2` allows attempts 2 and
 * 3 and stops after the third failure.
 */
export function shouldRetry<TError>(
  retry: RetryValue<TError> | undefined,
  failureCount: number,
  error: TError,
): boolean {
  if (retry === undefined || retry === false) return false;
  if (retry === true) return failureCount <= RETRY_TRUE_ATTEMPTS;
  if (typeof retry === "number") return failureCount <= retry;
  return retry(failureCount, error);
}

/** Resolve the delay before the next attempt. Defaults to no delay. */
export function resolveRetryDelay<TError>(
  retryDelay: RetryDelayValue<TError> | undefined,
  failureCount: number,
  error: TError,
): number {
  if (retryDelay === undefined) return 0;
  if (typeof retryDelay === "number") return retryDelay;
  return retryDelay(failureCount, error);
}

/**
 * `setTimeout` as an abortable promise, so cancelling a query interrupts the
 * gap between retries instead of waiting it out and firing a doomed attempt.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new CancelledError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A promise that rejects the moment `signal` aborts, plus its cleanup.
 *
 * Raced against the transport call so cancellation is immediate even when the
 * transport ignores the signal it was handed. typefetch forwards it to `fetch`
 * and does abort, but the engine cannot assume every source is cooperative —
 * without this, `cancelQueries` would silently wait out the full request.
 */
export function rejectOnAbort(signal: AbortSignal): {
  promise: Promise<never>;
  dispose: () => void;
} {
  let dispose = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new CancelledError());
      return;
    }
    const onAbort = () => reject(new CancelledError());
    signal.addEventListener("abort", onAbort, { once: true });
    dispose = () => signal.removeEventListener("abort", onAbort);
  });
  return { promise, dispose };
}

export { isCancelledError };
