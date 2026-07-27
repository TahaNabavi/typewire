import { Chip, Segmented, Toggle, useChrome } from "./chrome";
import { usePrefersReducedMotion } from "./theme";

/**
 * The settings tab. Every control writes straight through `updateSettings`,
 * which persists to `sessionStorage`, so a preference survives a reload within
 * the session. Sound is off by default and gated here.
 */
export function SettingsPanel() {
  const { styles, palette, settings, updateSettings, sound } = useChrome();
  const reducedMotion = usePrefersReducedMotion();

  return (
    <div style={{ ...styles.setSection, overflowY: "auto", width: "100%" }}>
      <div style={styles.setRow}>
        <span style={styles.setLabel}>
          <span>Theme</span>
          <span style={styles.setHint}>auto follows the host's color scheme</span>
        </span>
        <Segmented
          testId="typewire-set-theme"
          value={settings.theme}
          onChange={(theme) => updateSettings({ theme })}
          options={[
            { value: "auto", label: "auto" },
            { value: "dark", label: "dark" },
            { value: "light", label: "light" },
          ]}
        />
      </div>

      <div style={styles.setRow}>
        <span style={styles.setLabel}>
          <span>Density</span>
          <span style={styles.setHint}>compact fits more rows on screen</span>
        </span>
        <Segmented
          testId="typewire-set-density"
          value={settings.density}
          onChange={(density) => updateSettings({ density })}
          options={[
            { value: "comfortable", label: "comfortable" },
            { value: "compact", label: "compact" },
          ]}
        />
      </div>

      <div style={styles.setRow}>
        <span style={styles.setLabel}>
          <span>Animations</span>
          <span style={styles.setHint}>
            {reducedMotion
              ? "the OS requests reduced motion — animations stay off"
              : "row enter and pending pulse"}
          </span>
        </span>
        <Toggle
          testId="typewire-set-animations"
          checked={settings.animations}
          onChange={(animations) => updateSettings({ animations })}
          label={settings.animations ? "on" : "off"}
        />
      </div>

      <div style={styles.setRow}>
        <span style={styles.setLabel}>
          <span>Sound</span>
          <span style={styles.setHint}>a blip on new traffic, a buzz on error</span>
        </span>
        <Toggle
          testId="typewire-set-sound"
          checked={settings.sound}
          onChange={(on) => {
            updateSettings({ sound: on });
            sound.setEnabled(on);
            if (on) sound.success();
          }}
          label={settings.sound ? "on" : "off"}
        />
      </div>

      {settings.sound && (
        <div style={styles.setRow}>
          <span style={styles.setLabel}>
            <span>Volume</span>
            <span style={styles.setHint}>{Math.round(settings.soundVolume * 100)}%</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.soundVolume}
              aria-label="Sound volume"
              data-testid="typewire-set-volume"
              onChange={(e) => {
                const soundVolume = Number(e.target.value);
                updateSettings({ soundVolume });
                sound.setVolume(soundVolume);
              }}
              style={{ accentColor: palette.accent }}
            />
            <Chip onClick={() => sound.tick()}>test</Chip>
          </div>
        </div>
      )}

      <p style={{ ...styles.setHint, marginTop: 12 }}>
        Settings persist for this browser session. The panel ships no stylesheet —
        every color above is an inline value, and only the row animations use an
        injected <code>@keyframes</code> block.
      </p>
    </div>
  );
}
