import type {
  InspectorEvent,
  InspectorOverride,
  InspectorProgress,
  InspectorSource,
  Observable,
} from "./types";

/** Enough to see a page's traffic without letting a long session grow forever. */
const DEFAULT_LIMIT = 500;

/**
 * Event kinds that end a call, across both transports. Progress for that
 * correlation id is released when one arrives.
 */
const CONCLUDING_KINDS = new Set([
  "success",
  "error",
  "frame_error",
  "ack",
  "dropped",
]);

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

  /**
   * Latest progress per in-flight call, keyed `${source}:${id}`. Replaced
   * wholesale for the same identity-comparison reason as `events`.
   */
  private progress: ReadonlyMap<string, InspectorProgress> = new Map();

  constructor(options: InspectorBridgeOptions = {}) {
    this.limit = options.limit ?? DEFAULT_LIMIT;
  }

  getSnapshot(): readonly InspectorEvent[] {
    return this.events;
  }

  /**
   * Latest progress for every call still transferring.
   *
   * A second snapshot rather than a field on the event log, because progress
   * and events change at wildly different rates. Both are published through the
   * one `subscribe`, so a panel can bind either (or both) with
   * `useSyncExternalStore`.
   */
  getProgressSnapshot(): ReadonlyMap<string, InspectorProgress> {
    return this.progress;
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

    // A concluded call has nothing left to transfer. Dropping its progress here
    // is what keeps the map bounded over a long session — otherwise every
    // upload a page ever made would be retained at 100%.
    if (CONCLUDING_KINDS.has(event.kind)) {
      this.dropProgress(progressKey(event.source, event.id));
    }

    this.notify();
  }

  /**
   * Record the latest transfer progress for one call.
   *
   * Separate from `record` on purpose. Progress ticks arrive orders of
   * magnitude more often than lifecycle events, and routing them through the
   * event log would both flood the ring buffer and copy a 500-element array per
   * tick. Here each call keeps exactly one entry, replaced in place.
   */
  recordProgress(
    source: InspectorSource,
    id: string,
    progress: InspectorProgress,
  ): void {
    const next = new Map(this.progress);
    next.set(progressKey(source, id), progress);
    this.progress = next;
    this.notify();
  }

  clear(): void {
    this.events = [];
    this.progress = new Map();
    this.notify();
  }

  /** Remove one call's progress, if it has any. Does not notify on its own. */
  private dropProgress(key: string): void {
    if (!this.progress.has(key)) return;
    const next = new Map(this.progress);
    next.delete(key);
    this.progress = next;
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

/**
 * Keyed by correlation id, not label: progress belongs to one in-flight call,
 * and two concurrent uploads of the same endpoint must not overwrite each
 * other. This is the same key `selectEntries` builds for an `InspectorEntry`.
 */
function progressKey(source: InspectorSource, id: string): string {
  return `${source}:${id}`;
}
