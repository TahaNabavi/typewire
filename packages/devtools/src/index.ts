/**
 * @tahanabavi/type-devtools
 * =========================
 * React inspector panel for any bridge from @tahanabavi/type-devtools-core.
 *
 * The panel renders whatever sources are attached and tags each row by source,
 * so adding typesocket alongside typefetch is one more `connect*` call — not a
 * change in here. Attach a `QueryClient` and the Cache tab lights up too.
 *
 * It ships no stylesheet: every color is inline and theme-aware, with the sole
 * exception of an injected `@keyframes` block for the row animations.
 */

export { TypeDevtools } from "./panel";
export type { TypeDevtoolsProps } from "./panel";

export { useInspectorEntries, useInspectorEvents, useQueryInspector } from "./use-inspector";

export { JsonTree } from "./json-tree";
export type { JsonTreeProps } from "./json-tree";

export { createSoundPlayer } from "./sound";
export type { SoundPlayer, SoundPlayerOptions } from "./sound";

export {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  useSettings,
} from "./settings";
export type { DevtoolsSettings, Density } from "./settings";

export { PALETTES, resolveThemeName } from "./theme";
export type { Palette, ThemeName, ThemePreference } from "./theme";

// Re-exported so an app needs one dependency to set devtools up.
export {
  InspectorBridge,
  QueryInspector,
  connectQueryClient,
  connectTypeFetch,
  connectTypeSocket,
  selectEntries,
} from "@tahanabavi/type-devtools-core";

export type {
  InspectorEntry,
  InspectorEvent,
  InspectorOverride,
  InspectorSource,
  MutationSnapshot,
  QueryClientLike,
  QueryInspectorSnapshot,
  QuerySnapshot,
  QueryStateLike,
} from "@tahanabavi/type-devtools-core";
