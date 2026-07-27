import type {
  InspectorEvent,
  InspectorOverride,
  InspectorSource,
  Observable,
} from "./types";

/** Enough to see a page's traffic without letting a long session grow forever. */
const DEFAULT_LIMIT = 500;

export interface InspectorBridgeOptions {
  /** Maximum retained events; the oldest are dropped first. Default 500. */
  limit?: number;
}

/**
 * The inspector's store: one ring buffer of source-tagged events, plus an
 * override registry keyed by `(source, label)`.
 *
 * Knows nothing about HTTP or WS. Connectors translate a transport's events in
 * and its overrides out, which is what lets one panel render both without a
 * branch per transport.
 */
export class InspectorBridge implements Observable<readonly InspectorEvent[]> {
  private readonly limit: number;
  private readonly listeners = new Set<() => void>();
  private readonly overrides = new Map<string, InspectorOverride>();

  /**
   * Replaced, never mutated in place: `getSnapshot` feeds
   * `useSyncExternalStore`, which compares by identity.
   */
  private events: readonly InspectorEvent[] = [];

  constructor(options: InspectorBridgeOptions = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
  }

  getSnapshot(): readonly InspectorEvent[] {
    return this.events;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Append an event, trimming the oldest once the buffer is full. */
  record(event: InspectorEvent): void {
    const next =
      this.events.length >= this.limit
        ? [...this.events.slice(this.events.length - this.limit + 1), event]
        : [...this.events, event];
    this.events = next;
    this.notify();
  }

  clear(): void {
    this.events = [];
    this.notify();
  }

  /**
   * Force behaviour for every future call of one endpoint/event.
   *
   * Keyed by `label` (the `endpointId`/`eventId`), not by correlation id — a
   * `requestId` is minted per call, so keying on it could never match anything
   * that has not already happened.
   */
  setOverride(
    source: InspectorSource,
    label: string,
    override: InspectorOverride,
  ): void {
    this.overrides.set(overrideKey(source, label), override);
    this.notify();
  }

  removeOverride(source: InspectorSource, label: string): void {
    if (this.overrides.delete(overrideKey(source, label))) this.notify();
  }

  getOverride(
    source: InspectorSource,
    label: string,
  ): InspectorOverride | undefined {
    return this.overrides.get(overrideKey(source, label));
  }

  /** Every active override, for rendering the panel's override list. */
  listOverrides(): Array<{
    source: InspectorSource;
    label: string;
    override: InspectorOverride;
  }> {
    return [...this.overrides.entries()].map(([key, override]) => {
      const separator = key.indexOf(":");
      return {
        source: key.slice(0, separator),
        label: key.slice(separator + 1),
        override,
      };
    });
  }

  clearOverrides(): void {
    if (this.overrides.size === 0) return;
    this.overrides.clear();
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

/**
 * `source` never contains a colon, so splitting on the first one recovers both
 * halves even when the label contains colons of its own.
 */
function overrideKey(source: InspectorSource, label: string): string {
  return `${source}:${label}`;
}
