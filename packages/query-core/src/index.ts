/**
 * @tahanabavi/typefetch-query-core
 * ================================
 * Framework-agnostic query engine for TypeFetch contracts.
 *
 * Scaffold — the full engine (QueryClient, QueryCache, QueryObserver,
 * MutationObserver, relations/invalidation) is built on the primitives below.
 * See ../../docs/ARCHITECTURE.md.
 */

/**
 * The universal reactivity contract. Everything the UI reads implements this;
 * framework adapters bind it natively (React `useSyncExternalStore`, Vue
 * `shallowRef`, Angular signals). The core never imports a framework.
 */
export interface Observable<T> {
  getSnapshot(): T;
  subscribe(listener: () => void): () => void;
}

/**
 * Deterministic serialization with sorted object keys, so two inputs that differ
 * only in key order hash to the same cache key. Used to derive query keys as
 * `[endpointId, hashKey(input)]`.
 */
export function hashKey(value: unknown): string {
  return JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce<Record<string, unknown>>((acc, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });
}

export const version = "0.0.0";
