import {
  selectEntries,
  type InspectorBridge,
  type InspectorEntry,
  type InspectorEvent,
  type QueryInspector,
} from "@tahanabavi/type-devtools-core";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Cache } from "./cache";
import {
  Chip,
  ChromeProvider,
  IconButton,
  makeStyles,
  useChrome,
  type ChromeValue,
} from "./chrome";
import { ActiveOverrides, useOverrides } from "./overrides";
import {
  downloadText,
  safeStringify,
  safeStringifyInline,
} from "./serialize";
import { useSettings } from "./settings";
import { SettingsPanel } from "./settings-panel";
import { createSoundPlayer, type SoundPlayer } from "./sound";
import {
  PALETTES,
  resolveThemeName,
  usePrefersDark,
  usePrefersReducedMotion,
} from "./theme";
import { Timeline } from "./timeline";
import { useInspectorEvents } from "./use-inspector";

export interface TypeDevtoolsProps {
  /** The transport timeline (HTTP / WS). */
  bridge: InspectorBridge;
  /** Optional query cache. Provide it to unlock the Cache tab. */
  queries?: QueryInspector;
  /** Render expanded on first mount. Default `false`. */
  defaultOpen?: boolean;
  title?: string;
}

type Tab = "timeline" | "cache" | "settings";
type SourceFilter = "all" | "http" | "ws";
type StatusFilter = "all" | "pending" | "success" | "error";
type Size = "normal" | "large" | "full";

const SIZES: Record<Size, { width: string; height: string }> = {
  normal: {
    width: "min(820px, calc(100vw - 32px))",
    height: "min(460px, calc(100vh - 32px))",
  },
  large: {
    width: "min(1100px, calc(100vw - 32px))",
    height: "min(680px, calc(100vh - 32px))",
  },
  full: { width: "calc(100vw - 32px)", height: "calc(100vh - 32px)" },
};

/**
 * The inspector panel: one timeline for every transport, a live query cache, and
 * a settings tab — all rendered inline with no stylesheet, because it is dropped
 * into someone else's app.
 */
export function TypeDevtools({
  bridge,
  queries,
  defaultOpen = false,
  title = "TypeWire devtools",
}: TypeDevtoolsProps) {
  const [settings, updateSettings] = useSettings();
  const prefersDark = usePrefersDark();
  const reducedMotion = usePrefersReducedMotion();

  const palette = PALETTES[resolveThemeName(settings.theme, prefersDark)];
  const styles = useMemo(
    () => makeStyles(palette, settings.density),
    [palette, settings.density],
  );
  const motionOk = settings.animations && !reducedMotion;

  // The sound player is created once and kept in a ref; settings sync into it.
  const soundRef = useRef<SoundPlayer | null>(null);
  if (!soundRef.current) {
    soundRef.current = createSoundPlayer({
      enabled: settings.sound,
      volume: settings.soundVolume,
    });
  }
  useEffect(() => {
    soundRef.current?.setEnabled(settings.sound);
  }, [settings.sound]);
  useEffect(() => {
    soundRef.current?.setVolume(settings.soundVolume);
  }, [settings.soundVolume]);

  const events = useInspectorEvents(bridge);
  const entries = useMemo(() => selectEntries(events), [events]);
  const overrides = useOverrides(bridge);
  const cacheCount = useOptionalQueryCount(queries);

  const [open, setOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<Tab>("timeline");
  const [size, setSize] = useState<Size>("normal");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const [frozen, setFrozen] = useState<InspectorEntry[] | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  // Sound cue on new traffic — a tick, or a buzz if the arrivals include an error.
  const seenCount = useRef(events.length);
  useEffect(() => {
    if (events.length > seenCount.current) {
      const added = events.slice(seenCount.current);
      const errored = added.some(
        (e) => e.kind === "error" || e.kind === "frame_error",
      );
      if (errored) soundRef.current?.error();
      else soundRef.current?.tick();
    }
    seenCount.current = events.length;
  }, [events]);

  const source = paused && frozen ? frozen : entries;
  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    const rows = source.filter(
      (entry) =>
        (sourceFilter === "all" || entry.source === sourceFilter) &&
        (statusFilter === "all" || entry.status === statusFilter) &&
        (term === "" || matchesEntry(entry, term)),
    );
    // Newest first: the row you care about is the one that just happened.
    return [...rows].reverse();
  }, [source, sourceFilter, statusFilter, search]);

  const selected = entries.find((e) => e.key === selectedKey) ?? null;
  const stats = useMemo(() => summarize(entries), [entries]);
  const connection = useMemo(() => connectionState(events), [events]);

  const togglePause = useCallback(() => {
    setPaused((wasPaused) => {
      setFrozen(wasPaused ? null : entries);
      return !wasPaused;
    });
  }, [entries]);

  const chrome: ChromeValue = useMemo(
    () => ({
      palette,
      styles,
      settings,
      updateSettings,
      sound: soundRef.current as SoundPlayer,
      motionOk,
    }),
    [palette, styles, settings, updateSettings, motionOk],
  );

  if (!open) {
    return (
      <ChromeProvider value={chrome}>
        <button
          type="button"
          data-testid="typewire-devtools-toggle"
          onClick={() => setOpen(true)}
          style={styles.fab}
        >
          <span style={{ color: palette.accent }}>⚡</span>
          {entries.length}
          {stats.errors > 0 && (
            <span
              data-testid="typewire-fab-errors"
              style={{ ...dotStyle, background: palette.error }}
            />
          )}
        </button>
      </ChromeProvider>
    );
  }

  return (
    <ChromeProvider value={chrome}>
      <section
        style={{ ...styles.panel, ...SIZES[size] }}
        data-testid="typewire-devtools"
      >
        <header style={styles.header}>
          <div style={styles.headerLeft}>
            <span style={{ color: palette.accent }}>⚡</span>
            <span style={styles.title}>{title}</span>
          </div>
          <div style={styles.windowControls}>
            <IconButton title="Resize" testId="typewire-size" onClick={() => setSize(nextSize(size))}>
              ⤢
            </IconButton>
            <IconButton
              title="Close"
              testId="typewire-devtools-close"
              onClick={() => setOpen(false)}
            >
              ✕
            </IconButton>
          </div>
        </header>

        <div style={styles.tabRow}>
          <TabButton id="timeline" active={tab} onSelect={setTab} count={entries.length}>
            Timeline
          </TabButton>
          {queries && (
            <TabButton id="cache" active={tab} onSelect={setTab} count={cacheCount}>
              Cache
            </TabButton>
          )}
          <TabButton id="settings" active={tab} onSelect={setTab}>
            Settings
          </TabButton>
        </div>

        {tab !== "settings" && (
          <div style={styles.toolbar}>
            {tab === "timeline" && (
              <>
                <div style={styles.filters}>
                  {(["all", "http", "ws"] as const).map((value) => (
                    <Chip
                      key={value}
                      testId={`typewire-filter-${value}`}
                      active={sourceFilter === value}
                      onClick={() => setSourceFilter(value)}
                    >
                      {value}
                    </Chip>
                  ))}
                </div>
                <div style={styles.filters}>
                  {(["all", "pending", "success", "error"] as const).map((value) => (
                    <Chip
                      key={value}
                      testId={`typewire-status-${value}`}
                      active={statusFilter === value}
                      onClick={() => setStatusFilter(value)}
                    >
                      {value}
                    </Chip>
                  ))}
                </div>
              </>
            )}

            <div style={styles.searchWrap}>
              <input
                data-testid="typewire-search"
                placeholder="search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                style={styles.searchInput}
              />
            </div>

            {tab === "timeline" && (
              <>
                <Chip
                  testId="typewire-pause"
                  active={paused}
                  onClick={togglePause}
                  title={paused ? "Resume" : "Pause"}
                >
                  {paused ? "▶" : "⏸"}
                </Chip>
                <Chip
                  testId="typewire-export"
                  title="Download timeline as JSON"
                  onClick={() =>
                    downloadText("typewire-timeline.json", safeStringify(entries))
                  }
                >
                  export
                </Chip>
                <Chip
                  testId="typewire-clear"
                  onClick={() => {
                    bridge.clear();
                    setFrozen(null);
                    setPaused(false);
                    setSelectedKey(null);
                  }}
                >
                  clear
                </Chip>
              </>
            )}
          </div>
        )}

        {tab === "timeline" && <ActiveOverrides overrides={overrides} />}

        {tab === "timeline" && (
          <Timeline
            visible={visible}
            selected={selected}
            onSelect={setSelectedKey}
            overrides={overrides}
            search={search}
          />
        )}
        {tab === "cache" && queries && <Cache inspector={queries} search={search} />}
        {tab === "settings" && <SettingsPanel />}

        <footer style={styles.statusbar}>
          <span>{stats.total} calls</span>
          <span style={{ color: stats.errors ? palette.error : palette.textMuted }}>
            {stats.errors} errors
          </span>
          {stats.pending > 0 && <span>{stats.pending} pending</span>}
          {stats.avgMs !== null && <span>avg {stats.avgMs}ms</span>}
          {connection !== "none" && (
            <span style={{ ...styles.connDot, marginLeft: "auto" }}>
              <span
                style={{
                  ...dotStyle,
                  background:
                    connection === "connected" ? palette.success : palette.error,
                }}
              />
              ws {connection}
            </span>
          )}
          {paused && (
            <span
              style={{
                color: palette.pending,
                marginLeft: connection === "none" ? "auto" : 0,
              }}
            >
              paused
            </span>
          )}
        </footer>
      </section>
    </ChromeProvider>
  );
}

function TabButton({
  id,
  active,
  onSelect,
  count,
  children,
}: {
  id: Tab;
  active: Tab;
  onSelect: (tab: Tab) => void;
  count?: number;
  children: ReactNode;
}) {
  const { styles } = useChrome();
  return (
    <button
      type="button"
      data-testid={`typewire-tab-${id}`}
      onClick={() => onSelect(id)}
      style={{ ...styles.tab, ...(active === id ? styles.tabActive : null) }}
    >
      {children}
      {count !== undefined && <span style={styles.tabCount}>{count}</span>}
    </button>
  );
}

/** Count of cached queries, safe to call whether or not a client is attached. */
function useOptionalQueryCount(inspector?: QueryInspector): number {
  const subscribe = useCallback(
    (cb: () => void) => (inspector ? inspector.subscribe(cb) : () => {}),
    [inspector],
  );
  const getSnapshot = useCallback(
    () => (inspector ? inspector.getSnapshot().queries.length : 0),
    [inspector],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function matchesEntry(entry: InspectorEntry, term: string): boolean {
  if (entry.label.toLowerCase().includes(term)) return true;
  for (const value of [entry.input, entry.output, entry.error]) {
    if (
      value !== undefined &&
      safeStringifyInline(value).toLowerCase().includes(term)
    ) {
      return true;
    }
  }
  return false;
}

function summarize(entries: InspectorEntry[]): {
  total: number;
  errors: number;
  pending: number;
  avgMs: number | null;
} {
  let errors = 0;
  let pending = 0;
  let durationSum = 0;
  let durationCount = 0;
  for (const entry of entries) {
    if (entry.status === "error") errors++;
    if (entry.status === "pending") pending++;
    if (entry.durationMs !== undefined) {
      durationSum += entry.durationMs;
      durationCount++;
    }
  }
  return {
    total: entries.length,
    errors,
    pending,
    avgMs: durationCount === 0 ? null : Math.round(durationSum / durationCount),
  };
}

/** Latest WS connection state, from the lifecycle events on the timeline. */
function connectionState(
  events: readonly InspectorEvent[],
): "connected" | "disconnected" | "none" {
  let state: "connected" | "disconnected" | "none" = "none";
  for (const event of events) {
    if (event.kind === "connect") state = "connected";
    else if (event.kind === "disconnect" || event.kind === "connect_error") {
      state = "disconnected";
    }
  }
  return state;
}

function nextSize(size: Size): Size {
  return size === "normal" ? "large" : size === "large" ? "full" : "normal";
}

const dotStyle: CSSProperties = {
  display: "inline-block",
  width: 7,
  height: 7,
  borderRadius: "50%",
};
