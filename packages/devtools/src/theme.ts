import { useEffect, useState } from "react";

/**
 * Theme lives here, not in a stylesheet: the panel is dropped into someone
 * else's app, so it ships no CSS and every color is resolved to an inline value.
 * Two palettes, chosen at runtime — `auto` follows the host's `prefers-color-scheme`.
 */
export type ThemeName = "dark" | "light";
export type ThemePreference = ThemeName | "auto";

/** Every color the panel draws, so a component never hard-codes a hex value. */
export interface Palette {
  bg: string;
  bgRaised: string;
  bgInset: string;
  border: string;
  borderSubtle: string;
  text: string;
  textMuted: string;
  textFaint: string;
  accent: string;
  accentText: string;
  rowActive: string;
  rowHover: string;
  // status
  pending: string;
  success: string;
  error: string;
  dropped: string;
  info: string;
  // sources
  http: string;
  ws: string;
  query: string;
  // json syntax
  jsonKey: string;
  jsonString: string;
  jsonNumber: string;
  jsonBoolean: string;
  jsonNull: string;
  jsonPunct: string;
  // search match highlight
  highlightBg: string;
  highlightText: string;
}

const DARK: Palette = {
  bg: "#0f172a",
  bgRaised: "#111c31",
  bgInset: "#020617",
  border: "#334155",
  borderSubtle: "#1e293b",
  text: "#e2e8f0",
  textMuted: "#94a3b8",
  textFaint: "#64748b",
  accent: "#38bdf8",
  accentText: "#0f172a",
  rowActive: "#1e293b",
  rowHover: "#172234",
  pending: "#f59e0b",
  success: "#22c55e",
  error: "#ef4444",
  dropped: "#a855f7",
  info: "#64748b",
  http: "#3b82f6",
  ws: "#8b5cf6",
  query: "#10b981",
  jsonKey: "#7dd3fc",
  jsonString: "#86efac",
  jsonNumber: "#fca5a5",
  jsonBoolean: "#c4b5fd",
  jsonNull: "#64748b",
  jsonPunct: "#64748b",
  highlightBg: "#78350f",
  highlightText: "#fef3c7",
};

const LIGHT: Palette = {
  bg: "#ffffff",
  bgRaised: "#f8fafc",
  bgInset: "#f1f5f9",
  border: "#cbd5e1",
  borderSubtle: "#e2e8f0",
  text: "#0f172a",
  textMuted: "#475569",
  textFaint: "#94a3b8",
  accent: "#0284c7",
  accentText: "#ffffff",
  rowActive: "#e2e8f0",
  rowHover: "#eef2f7",
  pending: "#b45309",
  success: "#15803d",
  error: "#b91c1c",
  dropped: "#7e22ce",
  info: "#64748b",
  http: "#1d4ed8",
  ws: "#6d28d9",
  query: "#047857",
  jsonKey: "#0369a1",
  jsonString: "#15803d",
  jsonNumber: "#b91c1c",
  jsonBoolean: "#6d28d9",
  jsonNull: "#94a3b8",
  jsonPunct: "#94a3b8",
  highlightBg: "#fde68a",
  highlightText: "#422006",
};

export const PALETTES: Record<ThemeName, Palette> = { dark: DARK, light: LIGHT };

/** Turn a preference into a concrete palette name, given the host's scheme. */
export function resolveThemeName(
  preference: ThemePreference,
  prefersDark: boolean,
): ThemeName {
  if (preference === "auto") return prefersDark ? "dark" : "light";
  return preference;
}

/**
 * A media-query listener, guarded for environments without `matchMedia`
 * (SSR, jsdom). Defaults to dark, matching the panel's original look.
 */
export function usePrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(() => queryPrefersDark());

  useEffect(() => {
    const media =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-color-scheme: dark)")
        : null;
    if (!media) return;
    const onChange = () => setPrefersDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return prefersDark;
}

/** Whether the host asked for reduced motion. Guarded like `usePrefersDark`. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    queryMedia("(prefers-reduced-motion: reduce)"),
  );

  useEffect(() => {
    const media =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    if (!media) return;
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

function queryPrefersDark(): boolean {
  // Absent `matchMedia`, keep the panel's historical dark default.
  return queryMedia("(prefers-color-scheme: dark)", true);
}

function queryMedia(query: string, fallback = false): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return fallback;
  }
  return window.matchMedia(query).matches;
}
