import type { AnyQuerySource } from "./types";

/**
 * Read the cross-package `"module.member"` key off a source.
 *
 * typefetch spells it `endpointId`, typesocket spells it `eventId`. They carry
 * the same value in the same format on purpose, so the engine accepts either
 * and normalises here rather than making every caller care which transport it
 * is holding.
 */
export function resolveSourceId(source: AnyQuerySource): string {
  const id =
    (source as { endpointId?: unknown }).endpointId ??
    (source as { eventId?: unknown }).eventId;
  if (typeof id !== "string" || id.length === 0) {
    throw new TypeError(
      "Query source is missing a string `endpointId` (typefetch) or `eventId` " +
        "(typesocket). Pass a generated client member, not a bare function.",
    );
  }
  return id;
}

/** Whether a value is a callable source carrying a usable id. */
export function hasSourceId(value: unknown): value is AnyQuerySource {
  if (typeof value !== "function") return false;
  const id =
    (value as { endpointId?: unknown }).endpointId ??
    (value as { eventId?: unknown }).eventId;
  return typeof id === "string" && id.length > 0;
}

/**
 * Walk one or more client `.modules` trees and collect every leaf that carries
 * a source id, keyed by that id. This is the map a client's `sources` option
 * wants: it lets the inbound half of cross-tab sync turn an `endpointId` back
 * into the endpoint to write through — even for one this tab has not mounted.
 *
 * ```ts
 * new QueryClient({ sources: collectSources(api.modules, socket.modules) });
 * ```
 *
 * A later tree wins a collision, so pass the more specific client last. Members
 * are the leaves (they are functions); only plain object nodes are descended.
 */
export function collectSources(
  ...trees: unknown[]
): Record<string, AnyQuerySource> {
  const out: Record<string, AnyQuerySource> = {};
  const visit = (node: unknown): void => {
    if (hasSourceId(node)) {
      out[resolveSourceId(node)] = node;
      return;
    }
    if (node && typeof node === "object") {
      for (const value of Object.values(node)) visit(value);
    }
  };
  for (const tree of trees) visit(tree);
  return out;
}
