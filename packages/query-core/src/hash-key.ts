/**
 * Deterministic serialization with sorted object keys, so two inputs that differ
 * only in key order hash to the same cache key. Used to derive query keys as
 * `[endpointId, hashKey(input)]`.
 *
 * Only JSON-representable input is supported. A `Date`, `Map`, `Set` or class
 * instance collapses to whatever `JSON.stringify` makes of it, so two distinct
 * values can collide — keep query input to plain data, which is what a Zod
 * contract's `request` schema produces anyway.
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

/**
 * The cache key for one endpoint + input pair.
 *
 * A string rather than a tuple so it can key a `Map` directly. The `endpointId`
 * is kept as a readable prefix, which makes both devtools output and
 * endpoint-scoped invalidation (`startsWith`-free, see `QueryCache.find`)
 * straightforward.
 */
export type QueryKey = string;

/** Build the canonical key for an endpoint call. */
export function buildQueryKey(endpointId: string, input: unknown): QueryKey {
  return `${endpointId}|${hashKey(input)}`;
}
