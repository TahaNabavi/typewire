import type { EndpointCallOptions, QueryEndpoint, QueryEvent } from "../types";

/** A source that records every input it was called with. */
export type Recording<T> = T & { readonly calls: unknown[] };

function attach<T extends object>(
  fn: T,
  idKey: "endpointId" | "eventId",
  id: string,
  calls: unknown[],
): Recording<T> {
  Object.defineProperty(fn, idKey, { value: id, enumerable: true });
  Object.defineProperty(fn, "calls", { value: calls, enumerable: false });
  return fn as Recording<T>;
}

/** A fake typefetch endpoint member (`.endpointId`). */
export function makeEndpoint<TInput = unknown, TOutput = unknown>(
  endpointId: string,
  impl: (input: TInput, options?: EndpointCallOptions) => Promise<TOutput>,
): Recording<QueryEndpoint<TInput, TOutput>> {
  const calls: unknown[] = [];
  const fn = async (input: TInput, options?: EndpointCallOptions) => {
    calls.push(input);
    return impl(input, options);
  };
  return attach(fn, "endpointId", endpointId, calls) as Recording<
    QueryEndpoint<TInput, TOutput>
  >;
}

/** A fake typesocket acked event member (`.eventId`). */
export function makeEvent<TInput = unknown, TOutput = unknown>(
  eventId: string,
  impl: (input: TInput, options?: EndpointCallOptions) => Promise<TOutput>,
): Recording<QueryEvent<TInput, TOutput>> {
  const calls: unknown[] = [];
  const fn = async (input: TInput, options?: EndpointCallOptions) => {
    calls.push(input);
    return impl(input, options);
  };
  return attach(fn, "eventId", eventId, calls) as Recording<
    QueryEvent<TInput, TOutput>
  >;
}

/** Resolve after `ms`, for endpoints that should not settle instantly. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll until `predicate` holds. Preferred over a fixed sleep: the engine
 * settles across several microtask turns, and a hard-coded wait is the usual
 * source of flaky query-engine tests.
 */
export async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2000,
): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await delay(5);
  }
}

/** A promise plus its resolve/reject, for driving an endpoint by hand. */
export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
