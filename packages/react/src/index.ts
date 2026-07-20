/**
 * @tahanabavi/typefetch-react
 * ===========================
 * Thin React adapter over @tahanabavi/typefetch-query-core.
 *
 * Scaffold — the public surface (TypeFetchProvider, useQuery, useMutation,
 * useQueryClient) will bind the core's `Observable` to `useSyncExternalStore`.
 * See ../../docs/ARCHITECTURE.md.
 */

export { hashKey } from "@tahanabavi/typefetch-query-core";
export type { Observable } from "@tahanabavi/typefetch-query-core";

export const version = "0.0.0";
