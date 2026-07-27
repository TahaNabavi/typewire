import type {
  InspectorBridge,
  InspectorOverride,
  InspectorSource,
} from "@tahanabavi/type-devtools-core";
import { useCallback, useMemo, useReducer, useState } from "react";
import { Chip, useChrome } from "./chrome";

/**
 * A reactive mirror of the bridge's override registry.
 *
 * The bridge notifies on `setOverride`, but its event snapshot keeps the same
 * identity, so `useSyncExternalStore` bails out — override changes wouldn't
 * re-render. Every mutation therefore goes through this hook, which bumps a
 * version and re-reads `listOverrides()`. Panel-driven changes (the only way to
 * edit overrides from the UI) always reflect immediately.
 */
export interface OverridesApi {
  list: Array<{ source: InspectorSource; label: string; override: InspectorOverride }>;
  set: (source: InspectorSource, label: string, override: InspectorOverride) => void;
  remove: (source: InspectorSource, label: string) => void;
  clear: () => void;
  get: (source: InspectorSource, label: string) => InspectorOverride | undefined;
}

export function useOverrides(bridge: InspectorBridge): OverridesApi {
  const [version, bump] = useReducer((n: number) => n + 1, 0);

  const list = useMemo(
    () => bridge.listOverrides(),
    // `version` is the intended dependency: it changes whenever we mutate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, version],
  );

  const set = useCallback(
    (source: InspectorSource, label: string, override: InspectorOverride) => {
      bridge.setOverride(source, label, override);
      bump();
    },
    [bridge],
  );
  const remove = useCallback(
    (source: InspectorSource, label: string) => {
      bridge.removeOverride(source, label);
      bump();
    },
    [bridge],
  );
  const clear = useCallback(() => {
    bridge.clearOverrides();
    bump();
  }, [bridge]);
  const get = useCallback(
    (source: InspectorSource, label: string) => bridge.getOverride(source, label),
    // Re-read on every version bump too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bridge, version],
  );

  return { list, set, remove, clear, get };
}

/** One-line description of what an override does, for the active list. */
export function summarizeOverride(override: InspectorOverride): string {
  const parts: string[] = [];
  if ("mock" in override) parts.push("mock");
  if (override.error) {
    parts.push(`error ${override.error.status ?? override.error.code ?? ""}`.trim());
  }
  if (override.latencyMs !== undefined) parts.push(`+${override.latencyMs}ms`);
  if (override.drop) parts.push("drop");
  return parts.join(" · ") || "override";
}

/**
 * The per-endpoint override editor, shown in the detail pane. Turns the fully
 * wired-but-previously-hidden override engine into buttons: force a mock, an
 * error, latency, or (for WS) a dropped frame — no code, no contract change.
 */
export function OverrideControls({
  source,
  label,
  overrides,
}: {
  source: InspectorSource;
  label: string;
  overrides: OverridesApi;
}) {
  const { palette, styles } = useChrome();
  const [mockOpen, setMockOpen] = useState(false);
  const [mockText, setMockText] = useState("{\n  \n}");
  const [mockError, setMockError] = useState<string | null>(null);

  const active = overrides.get(source, label);
  const isWs = source === "ws";

  const patch = (next: InspectorOverride) =>
    overrides.set(source, label, { ...active, ...next });

  const applyMock = () => {
    try {
      const value = JSON.parse(mockText) as unknown;
      overrides.set(source, label, { ...active, mock: value });
      setMockError(null);
      setMockOpen(false);
    } catch (error) {
      setMockError(error instanceof Error ? error.message : "Invalid JSON");
    }
  };

  return (
    <div style={{ marginTop: 4 }}>
      <span style={styles.fieldLabel}>overrides</span>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
        <Chip onClick={() => patch({ error: { status: 500, message: "Forced by devtools" } })}>
          force error
        </Chip>
        <Chip onClick={() => patch({ latencyMs: 1000 })}>+1s</Chip>
        <Chip onClick={() => patch({ latencyMs: 2000 })}>+2s</Chip>
        <Chip active={mockOpen} onClick={() => setMockOpen((v) => !v)}>
          mock…
        </Chip>
        {isWs && <Chip onClick={() => patch({ drop: true })}>drop</Chip>}
        {active && (
          <Chip danger onClick={() => overrides.remove(source, label)}>
            clear
          </Chip>
        )}
      </div>

      {active && (
        <p style={{ ...styles.setHint, margin: "0 0 6px" }}>
          active: {summarizeOverride(active)} — steers every future{" "}
          <code>{label}</code> call.
        </p>
      )}

      {mockOpen && (
        <div>
          <textarea
            value={mockText}
            onChange={(e) => setMockText(e.target.value)}
            spellCheck={false}
            rows={4}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: 6,
              borderRadius: 6,
              border: `1px solid ${mockError ? palette.error : palette.border}`,
              background: palette.bgInset,
              color: palette.text,
              font: "11px ui-monospace, SFMono-Regular, Menlo, monospace",
              resize: "vertical",
            }}
          />
          {mockError && (
            <p style={{ color: palette.error, fontSize: 10, margin: "3px 0" }}>
              {mockError}
            </p>
          )}
          <div style={{ display: "flex", gap: 4, marginTop: 4 }}>
            <Chip onClick={applyMock}>apply mock</Chip>
            <Chip onClick={() => setMockOpen(false)}>cancel</Chip>
          </div>
        </div>
      )}
    </div>
  );
}

/** The panel-wide list of active overrides, with per-item and bulk removal. */
export function ActiveOverrides({ overrides }: { overrides: OverridesApi }) {
  const { palette, styles } = useChrome();
  if (overrides.list.length === 0) return null;

  return (
    <div
      data-testid="typewire-active-overrides"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        padding: "5px 8px",
        borderBottom: `1px solid ${palette.borderSubtle}`,
        background: palette.bgInset,
      }}
    >
      <span style={{ ...styles.setHint, textTransform: "uppercase" }}>
        overrides
      </span>
      {overrides.list.map(({ source, label, override }) => (
        <span key={`${source}:${label}`} style={styles.tag}>
          <span style={{ color: source === "ws" ? palette.ws : palette.http }}>
            {source}
          </span>
          <span style={{ color: palette.text }}>{label}</span>
          <span>{summarizeOverride(override)}</span>
          <button
            type="button"
            title="Remove override"
            aria-label={`Remove override for ${label}`}
            onClick={() => overrides.remove(source, label)}
            style={{
              border: "none",
              background: "transparent",
              color: palette.textFaint,
              cursor: "pointer",
              padding: 0,
              font: "inherit",
            }}
          >
            ✕
          </button>
        </span>
      ))}
      <button
        type="button"
        onClick={overrides.clear}
        style={{
          marginLeft: "auto",
          border: "none",
          background: "transparent",
          color: palette.textFaint,
          cursor: "pointer",
          font: "inherit",
          fontSize: 10,
        }}
      >
        clear all
      </button>
    </div>
  );
}
