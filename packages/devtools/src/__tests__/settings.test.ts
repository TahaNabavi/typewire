import { createSoundPlayer } from "../sound";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../settings";
import { PALETTES, resolveThemeName } from "../theme";

const KEY = "typewire-devtools-settings";

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("settings persistence", () => {
  it("returns defaults with an empty store", () => {
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", () => {
    saveSettings({ ...DEFAULT_SETTINGS, theme: "light", sound: true, soundVolume: 0.5 });
    const loaded = loadSettings();
    expect(loaded.theme).toBe("light");
    expect(loaded.sound).toBe(true);
    expect(loaded.soundVolume).toBe(0.5);
  });

  it("sanitizes a hand-edited blob", () => {
    window.sessionStorage.setItem(
      KEY,
      JSON.stringify({ theme: "nope", soundVolume: 5, density: "weird", sound: "yes" }),
    );
    const loaded = loadSettings();
    expect(loaded.theme).toBe("auto"); // unknown → default
    expect(loaded.soundVolume).toBe(1); // clamped to [0,1]
    expect(loaded.density).toBe("comfortable"); // unknown → default
    expect(loaded.sound).toBe(false); // non-boolean → default
  });

  it("survives malformed JSON", () => {
    window.sessionStorage.setItem(KEY, "{not json");
    expect(loadSettings()).toEqual(DEFAULT_SETTINGS);
  });
});

describe("resolveThemeName", () => {
  it("follows the host scheme for auto", () => {
    expect(resolveThemeName("auto", true)).toBe("dark");
    expect(resolveThemeName("auto", false)).toBe("light");
  });

  it("honors an explicit choice", () => {
    expect(resolveThemeName("light", true)).toBe("light");
    expect(resolveThemeName("dark", false)).toBe("dark");
  });

  it("exposes a palette per theme", () => {
    expect(PALETTES.dark.bg).not.toBe(PALETTES.light.bg);
  });
});

describe("sound player", () => {
  it("is a silent no-op without AudioContext (jsdom)", () => {
    const player = createSoundPlayer({ enabled: true, volume: 0.5 });
    expect(() => {
      player.tick();
      player.error();
      player.success();
      player.setEnabled(false);
      player.setVolume(0.1);
    }).not.toThrow();
  });
});
