import {
  selectEntries,
  type InspectorBridge,
  type InspectorEntry,
  type InspectorEvent,
  type QueryInspector,
  type QueryInspectorSnapshot,
} from "@tahanabavi/type-devtools-core";
import { useCallback, useMemo, useSyncExternalStore } from "react";

/** The raw event log, bound to React. */
export function useInspectorEvents(
  bridge: InspectorBridge,
): readonly InspectorEvent[] {
  const subscribe = useCallback(
    (onStoreChange: () => void) => bridge.subscribe(onStoreChange),
    [bridge],
  );
  const getSnapshot = useCallback(() => bridge.getSnapshot(), [bridge]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * The collapsed timeline, one row per call.
 *
 * Exported on its own so an app can build a custom inspector UI without the
 * bundled panel — the panel is one consumer of this hook, not the only way in.
 */
export function useInspectorEntries(bridge: InspectorBridge): InspectorEntry[] {
  const events = useInspectorEvents(bridge);
  // The bridge replaces its array on every change, so identity is a sound
  // dependency and re-grouping only happens when something actually arrived.
  return useMemo(() => selectEntries(events), [events]);
}

/**
 * A `QueryInspector`'s live snapshot, bound to React. Same store contract as the
 * bridge, so the cache view binds exactly like the timeline does.
 */
export function useQueryInspector(
  inspector: QueryInspector,
): QueryInspectorSnapshot {
  const subscribe = useCallback(
    (onStoreChange: () => void) => inspector.subscribe(onStoreChange),
    [inspector],
  );
  const getSnapshot = useCallback(() => inspector.getSnapshot(), [inspector]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
