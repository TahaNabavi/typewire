import type { QueryEndpoint } from "@tahanabavi/typefetch-query-core";

/** A fake typefetch endpoint member that records the inputs it was called with. */
export function makeEndpoint<TInput = unknown, TOutput = unknown>(
  endpointId: string,
  impl: (input: TInput) => Promise<TOutput>,
): QueryEndpoint<TInput, TOutput> & { readonly calls: unknown[] } {
  const calls: unknown[] = [];
  const fn = async (input: TInput) => {
    calls.push(input);
    return impl(input);
  };
  Object.defineProperty(fn, "endpointId", { value: endpointId, enumerable: true });
  Object.defineProperty(fn, "calls", { value: calls, enumerable: false });
  return fn as QueryEndpoint<TInput, TOutput> & { readonly calls: unknown[] };
}

/** A promise plus its resolvers, for driving an endpoint by hand. */
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
