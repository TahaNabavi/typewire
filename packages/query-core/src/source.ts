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
