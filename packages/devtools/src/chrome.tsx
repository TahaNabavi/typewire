import {
  createContext,
  useContext,
  useEffect,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { DevtoolsSettings, Density } from "./settings";
import type { SoundPlayer } from "./sound";
import type { Palette } from "./theme";

/**
 * Everything the panel's parts need to draw themselves, in one context so a
 * component reads `useChrome()` instead of threading palette, styles and
 * settings through every prop list.
 */
export interface ChromeValue {
  palette: Palette;
  styles: Styles;
  settings: DevtoolsSettings;
  updateSettings: (patch: Partial<DevtoolsSettings>) => void;
  sound: SoundPlayer;
  /** Animations allowed: the setting is on *and* the host isn't reduced-motion. */
  motionOk: boolean;
}

const ChromeContext = createContext<ChromeValue | null>(null);

export function ChromeProvider({
  value,
  children,
}: {
  value: ChromeValue;
  children: ReactNode;
}) {
  useKeyframes();
  return <ChromeContext.Provider value={value}>{children}</ChromeContext.Provider>;
}

export function useChrome(): ChromeValue {
  const value = useContext(ChromeContext);
  if (!value) throw new Error("useChrome must be used inside <ChromeProvider>");
  return value;
}

// ── the one injected stylesheet ──────────────────────────────────────────────
// Inline styles cannot express `@keyframes`, so the row-enter and pulse
// animations need a real stylesheet. It is injected once, globally, and every
// name is prefixed so it can't collide with the host app's own CSS.
const KEYFRAMES_ID = "typewire-devtools-keyframes";
const KEYFRAMES = `
@keyframes twdtRowIn { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@keyframes twdtPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
@keyframes twdtFadeIn { from { opacity: 0; } to { opacity: 1; } }
`;

function useKeyframes(): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (document.getElementById(KEYFRAMES_ID)) return;
    const style = document.createElement("style");
    style.id = KEYFRAMES_ID;
    style.textContent = KEYFRAMES;
    document.head.appendChild(style);
  }, []);
}

export const ANIM = {
  rowIn: "twdtRowIn 200ms ease",
  pulse: "twdtPulse 1.2s ease-in-out infinite",
  fadeIn: "twdtFadeIn 160ms ease",
} as const;

// ── shared primitives ────────────────────────────────────────────────────────

export function Chip({
  active,
  danger,
  onClick,
  title,
  children,
  testId,
}: {
  active?: boolean;
  danger?: boolean;
  onClick: () => void;
  title?: string;
  children: ReactNode;
  testId?: string;
}) {
  const { styles, palette } = useChrome();
  return (
    <button
      type="button"
      title={title}
      data-testid={testId}
      onClick={onClick}
      style={{
        ...styles.chip,
        ...(active ? styles.chipActive : null),
        ...(danger ? { color: palette.error } : null),
      }}
    >
      {children}
    </button>
  );
}

export function IconButton({
  onClick,
  title,
  children,
  testId,
  active,
}: {
  onClick: () => void;
  title: string;
  children: ReactNode;
  testId?: string;
  active?: boolean;
}) {
  const { styles } = useChrome();
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={onClick}
      style={{ ...styles.iconBtn, ...(active ? styles.chipActive : null) }}
    >
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  testId,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: ReactNode;
  testId?: string;
}) {
  const { palette } = useChrome();
  return (
    <label style={toggleStyles.wrap}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={typeof label === "string" ? label : undefined}
        data-testid={testId}
        onClick={() => onChange(!checked)}
        style={{
          ...toggleStyles.track,
          background: checked ? palette.accent : palette.border,
        }}
      >
        <span
          style={{
            ...toggleStyles.knob,
            background: checked ? palette.accentText : palette.textMuted,
            transform: checked ? "translateX(14px)" : "translateX(0)",
          }}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  testId,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (next: T) => void;
  testId?: string;
}) {
  const { styles } = useChrome();
  return (
    <div style={styles.seg} data-testid={testId} role="group">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          aria-pressed={option.value === value}
          style={{
            ...styles.segBtn,
            ...(option.value === value ? styles.segBtnActive : null),
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const toggleStyles = {
  wrap: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
  },
  track: {
    position: "relative",
    width: 30,
    minWidth: 30,
    height: 16,
    padding: 2,
    borderRadius: 999,
    border: "none",
    cursor: "pointer",
  },
  knob: {
    display: "block",
    width: 12,
    height: 12,
    borderRadius: "50%",
    transition: "transform 120ms ease",
  },
} satisfies Record<string, CSSProperties>;

// ── style factory ────────────────────────────────────────────────────────────

export type Styles = ReturnType<typeof makeStyles>;

/** Build every panel style from a palette. Rebuilt when the theme or density
 * changes, so a component never hard-codes a color or a spacing. */
export function makeStyles(palette: Palette, density: Density) {
  const dense = density === "compact";
  const rowPad = dense ? "3px 9px" : "6px 10px";
  const fontSize = dense ? 11 : 12;
  const mono = "12px ui-monospace, SFMono-Regular, Menlo, monospace";

  return {
    fab: {
      position: "fixed",
      right: 16,
      bottom: 16,
      zIndex: 2147483000,
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "8px 12px",
      borderRadius: 999,
      border: `1px solid ${palette.border}`,
      background: palette.bg,
      color: palette.text,
      font: mono,
      cursor: "pointer",
    },
    panel: {
      position: "fixed",
      right: 16,
      bottom: 16,
      zIndex: 2147483000,
      display: "flex",
      flexDirection: "column",
      borderRadius: 10,
      border: `1px solid ${palette.border}`,
      background: palette.bg,
      color: palette.text,
      font: `${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`,
      overflow: "hidden",
      boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
    },
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 8,
      padding: "7px 10px",
      borderBottom: `1px solid ${palette.borderSubtle}`,
      background: palette.bgRaised,
    },
    headerLeft: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
    title: { fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" },
    windowControls: { display: "flex", alignItems: "center", gap: 4 },
    tabRow: {
      display: "flex",
      gap: 2,
      padding: "4px 8px 0",
      borderBottom: `1px solid ${palette.borderSubtle}`,
      background: palette.bgRaised,
    },
    tab: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "5px 10px",
      border: "none",
      borderBottom: "2px solid transparent",
      background: "transparent",
      color: palette.textMuted,
      font: "inherit",
      cursor: "pointer",
    },
    tabActive: { color: palette.text, borderBottomColor: palette.accent },
    tabCount: {
      padding: "0 5px",
      borderRadius: 999,
      fontSize: 9,
      background: palette.rowActive,
      color: palette.textMuted,
    },
    toolbar: {
      display: "flex",
      alignItems: "center",
      gap: 6,
      padding: "6px 8px",
      borderBottom: `1px solid ${palette.borderSubtle}`,
      flexWrap: "wrap",
    },
    filters: { display: "flex", gap: 4 },
    chip: {
      padding: "3px 8px",
      borderRadius: 6,
      border: `1px solid ${palette.border}`,
      background: "transparent",
      color: palette.textMuted,
      font: "inherit",
      cursor: "pointer",
    },
    chipActive: { background: palette.rowActive, color: palette.text },
    searchWrap: { position: "relative", flex: 1, minWidth: 120 },
    searchInput: {
      width: "100%",
      boxSizing: "border-box",
      padding: "4px 8px",
      borderRadius: 6,
      border: `1px solid ${palette.border}`,
      background: palette.bgInset,
      color: palette.text,
      font: "inherit",
      outline: "none",
    },
    iconBtn: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minWidth: 26,
      height: 24,
      padding: "0 6px",
      borderRadius: 6,
      border: `1px solid ${palette.border}`,
      background: "transparent",
      color: palette.textMuted,
      font: "inherit",
      cursor: "pointer",
    },
    body: { display: "flex", flex: 1, minHeight: 0 },
    list: {
      flex: 1,
      margin: 0,
      padding: 0,
      listStyle: "none",
      overflowY: "auto",
      borderRight: `1px solid ${palette.borderSubtle}`,
    },
    row: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      width: "100%",
      padding: rowPad,
      border: "none",
      borderBottom: `1px solid ${palette.borderSubtle}`,
      background: "transparent",
      color: "inherit",
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
    },
    rowActive: { background: palette.rowActive },
    badge: {
      padding: "1px 6px",
      borderRadius: 4,
      color: palette.accentText,
      fontWeight: 700,
      fontSize: 10,
      whiteSpace: "nowrap",
    },
    label: {
      flex: 1,
      overflow: "hidden",
      textOverflow: "ellipsis",
      whiteSpace: "nowrap",
    },
    statusText: { fontWeight: 700, fontSize: 10 },
    duration: {
      color: palette.textFaint,
      minWidth: 46,
      textAlign: "right",
      fontSize: 10,
    },
    detail: {
      width: 320,
      minWidth: 320,
      padding: "8px 10px",
      overflowY: "auto",
      overflowX: "auto",
    },
    detailHead: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 6,
      marginBottom: 8,
    },
    field: { margin: "0 0 10px" },
    fieldLabel: {
      display: "block",
      marginBottom: 3,
      color: palette.textFaint,
      fontSize: 10,
      textTransform: "uppercase",
      letterSpacing: 0.4,
    },
    inset: {
      padding: 8,
      borderRadius: 6,
      background: palette.bgInset,
      overflowX: "auto",
    },
    statusbar: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "4px 10px",
      borderTop: `1px solid ${palette.borderSubtle}`,
      background: palette.bgRaised,
      color: palette.textMuted,
      fontSize: 10,
    },
    connDot: { display: "inline-flex", alignItems: "center", gap: 5 },
    dot: { width: 8, height: 8, borderRadius: "50%" },
    empty: { padding: 12, color: palette.textFaint },
    // settings
    setSection: { padding: "10px 12px" },
    setRow: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
      padding: "8px 0",
      borderBottom: `1px solid ${palette.borderSubtle}`,
    },
    setLabel: { display: "flex", flexDirection: "column", gap: 2 },
    setHint: { color: palette.textFaint, fontSize: 10 },
    seg: {
      display: "inline-flex",
      borderRadius: 6,
      border: `1px solid ${palette.border}`,
      overflow: "hidden",
    },
    segBtn: {
      padding: "3px 10px",
      border: "none",
      borderLeft: `1px solid ${palette.border}`,
      background: "transparent",
      color: palette.textMuted,
      font: "inherit",
      cursor: "pointer",
    },
    segBtnActive: { background: palette.accent, color: palette.accentText },
    // menu (override editor, row actions)
    menu: {
      position: "absolute",
      zIndex: 10,
      minWidth: 150,
      padding: 4,
      borderRadius: 8,
      border: `1px solid ${palette.border}`,
      background: palette.bgRaised,
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    },
    menuItem: {
      display: "block",
      width: "100%",
      padding: "5px 8px",
      borderRadius: 4,
      border: "none",
      background: "transparent",
      color: palette.text,
      font: "inherit",
      textAlign: "left",
      cursor: "pointer",
    },
    tag: {
      display: "inline-flex",
      alignItems: "center",
      gap: 4,
      padding: "1px 6px",
      borderRadius: 999,
      fontSize: 9,
      border: `1px solid ${palette.border}`,
      color: palette.textMuted,
    },
  } satisfies Record<string, CSSProperties>;
}
