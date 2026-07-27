import type { InspectorEntry, InspectorEvent } from "./types";

/**
 * Collapse a flat event log into one row per call.
 *
 * A pure function rather than state on the bridge: the panel re-derives rows
 * from whatever slice of the log it is showing, and the grouping stays testable
 * without a transport.
 */
export function selectEntries(
  events: readonly InspectorEvent[],
): InspectorEntry[] {
  const byKey = new Map<string, InspectorEntry>();
  const ordered: InspectorEntry[] = [];

  for (const event of events) {
    const key = `${event.source}:${event.id}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        key,
        source: event.source,
        id: event.id,
        label: event.label,
        status: "info",
        startedAt: event.ts,
        events: [],
      };
      byKey.set(key, entry);
      ordered.push(entry);
    }
    entry.events.push(event);
    apply(entry, event);
  }

  return ordered;
}

function apply(entry: InspectorEntry, event: InspectorEvent): void {
  switch (event.kind) {
    // typefetch
    case "start":
      entry.status = "pending";
      entry.input = event.payload;
      entry.startedAt = event.ts;
      return;
    case "success":
      entry.status = "success";
      entry.output = event.payload;
      entry.durationMs = event.durationMs;
      return;
    case "error":
    case "frame_error":
      entry.status = "error";
      entry.error = event.payload;
      entry.durationMs = event.durationMs ?? entry.durationMs;
      return;

    // typesocket
    case "outbound":
      // A frame with no ack declared has nothing left to wait for, so it is
      // complete on send rather than perpetually pending.
      entry.status = event.meta?.expectsAck ? "pending" : "info";
      entry.input = event.payload;
      entry.startedAt = event.ts;
      return;
    case "ack":
      entry.status = "success";
      entry.output = event.payload;
      entry.durationMs = event.durationMs;
      return;
    case "inbound":
      entry.status = "info";
      entry.output = event.payload;
      return;
    case "dropped":
      entry.status = "dropped";
      return;

    default:
      // Lifecycle events (connect/disconnect/connect_error) and anything a
      // future source adds: recorded and shown, but they conclude nothing.
      return;
  }
}
