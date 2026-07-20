import { MiddlewareContext, MiddlewareNext } from "@/types";

/**
 * CacheOptions
 * ============
 * Options for configuring the cache middleware.
 * - `ttl` (Time To Live): Duration (in milliseconds) to keep cached GET responses.
 *   After this time, cached data expires and a fresh network call is performed.
 */
export type CacheOptions = { ttl?: number };

/**
 * cacheMiddleware
 * ===============
 * A generic caching middleware for GET requests in the ApiClient.
 * It stores successful responses in memory based on URL and method,
 * returning cached data for subsequent identical requests until the TTL expires.
 *
 * Purpose:
 * --------
 * - Reduces redundant network calls
 * - Improves performance for frequently fetched resources
 * - Useful for lightweight front-end caching (not suitable for sensitive data)
 *
 * Behavior:
 * ---------
 * 1. Only applies to `GET` requests; all other HTTP methods bypass caching.
 * 2. Caches the parsed JSON response in a simple in-memory Map.
 * 3. On subsequent requests:
 *    - If the cache entry exists and hasn’t expired, returns a synthetic
 *      `Response` object built from cached JSON.
 *    - Otherwise performs the network call and refreshes the cache.
 *
 * @param options - Optional cache configuration (TTL in ms)
 *
 * @returns Middleware function compatible with the ApiClient pipeline.
 *
 * @example
 * client.use(
 *   cacheMiddleware({ ttl: 120000 }) // cache GET results for 2 minutes
 * );
 *
 * @note Each middleware instance maintains its own internal cache
 *       and is memory-scoped (not persistent between reloads).
 */
export const cacheMiddleware = (options: CacheOptions = {}) => {
  // Default TTL = 60 seconds, unless overridden
  const { ttl = 60000 } = options;

  /**
   * Internal cache store.
   * Keys are composed as `"METHOD:URL"`.
   * Values include cached response data and expiration timestamp.
   */
  const cache = new Map<string, { data: any; expires: number }>();

  // Return an asynchronous middleware function conforming to the standard signature
  return async (ctx: MiddlewareContext, next: MiddlewareNext) => {
    // Caching only applies to GET requests
    if (ctx.init.method === "GET") {
      const key = `${ctx.init.method}:${ctx.url}`;
      const cached = cache.get(key);
      const now = Date.now();

      // Check if valid cached response exists and hasn't expired
      if (cached && cached.expires > now) {
        // Return a new synthetic Response containing cached data
        return new Response(JSON.stringify(cached.data), {
          headers: { "Content-Type": "application/json" },
        });
      }

      // Perform the actual network request via the next middleware/fetcher
      const res = await next();

      // Attempt to read JSON data from the response (clone avoids stream lock)
      const data = await res
        .clone()
        .json()
        .catch(() => null);

      // Store parsed data with expiration if successfully obtained
      if (data) {
        cache.set(key, { data, expires: now + ttl });
      }

      // Return original response to caller
      return res;
    }

    // For all non‑GET requests, just forward the call with no caching logic
    return next();
  };
};
