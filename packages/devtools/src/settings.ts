import { useCallback, useState } from "react";
import type { ThemePreference } from "./theme";

/** Row height / font scale. `compact` fits more traffic on screen. */
export type Density = "comfortable" | "compact";

/** User-tunable panel behaviour, persisted per browser session. */
export interface DevtoolsSettings {
  theme: ThemePreference;
  /** Play a blip on new traffic. Off by default — a devtools that beeps on
   * install is hostile. */
  sound: boolean;
  /** 0–1. Applied to every generated tone. */
  soundVolume: number;
  /** Row enter/flash animations. Still gated by `prefers-reduced-motion`. */
  animations: boolean;
  density: Density;
}

export const DEFAULT_SETTINGS: DevtoolsSettings = {
  theme: "auto",
  sound: false,
  soundVolume: 0.2,
  animations: true,
  density: "comfortable",
};

const STORAGE_KEY = "typewire-devtools-settings";

/**
 * Load persisted settings, merged onto the defaults so a newly added field is
 * populated rather than `undefined`. Any storage or parse failure falls back to
 * defaults — a debug panel must never throw on read.
 */
export function loadSettings(): DevtoolsSettings {
  try {
    const raw = getStorage()?.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<DevtoolsSettings>;
    return sanitize(parsed);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: DevtoolsSettings): void {
  try {
    getStorage()?.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private-mode or a full quota: losing persistence is acceptable.
  }
}

/** Settings state bound to `sessionStorage`, with a partial updater. */
export function useSettings(): [
  DevtoolsSettings,
  (patch: Partial<DevtoolsSettings>) => void,
] {
  const [settings, setSettings] = useState<DevtoolsSettings>(loadSettings);

  const update = useCallback((patch: Partial<DevtoolsSettings>) => {
    setSettings((previous) => {
      const next = sanitize({ ...previous, ...patch });
      saveSettings(next);
      return next;
    });
  }, []);

  return [settings, update];
}

/** Clamp/whitelist every field so a hand-edited blob can't poison the panel. */
function sanitize(input: Partial<DevtoolsSettings>): DevtoolsSettings {
  return {
    theme: isTheme(input.theme) ? input.theme : DEFAULT_SETTINGS.theme,
    sound: typeof input.sound === "boolean" ? input.sound : DEFAULT_SETTINGS.sound,
    soundVolume:
      typeof input.soundVolume === "number" && Number.isFinite(input.soundVolume)
        ? Math.min(1, Math.max(0, input.soundVolume))
        : DEFAULT_SETTINGS.soundVolume,
    animations:
      typeof input.animations === "boolean"
        ? input.animations
        : DEFAULT_SETTINGS.animations,
    density:
      input.density === "compact" || input.density === "comfortable"
        ? input.density
        : DEFAULT_SETTINGS.density,
  };
}

function isTheme(value: unknown): value is ThemePreference {
  return value === "auto" || value === "dark" || value === "light";
}

function getStorage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    // Accessing `sessionStorage` can throw in sandboxed iframes.
    return null;
  }
}
