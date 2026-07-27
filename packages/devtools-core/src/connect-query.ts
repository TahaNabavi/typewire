import { QueryInspector, type QueryInspectorOptions } from "./query-inspector";
import type { QueryClientLike } from "./types";

export type { QueryClientLike } from "./types";

/**
 * Mirror a `QueryClient`'s cache into a `QueryInspector` the panel can render.
 *
 * The timeline connectors return a detach function because they only *observe*.
 * The cache view also *drives* the client (refetch / invalidate / remove), so
 * this returns the store itself — `inspector.dispose()` is the detach.
 *
 * ```ts
 * const queries = connectQueryClient(queryClient);
 * // ...later
 * queries.dispose();
 * ```
 */
export function connectQueryClient(
  client: QueryClientLike,
  options?: QueryInspectorOptions,
): QueryInspector {
  const inspector = new QueryInspector(client, options);
  inspector.connect();
  return inspector;
}
