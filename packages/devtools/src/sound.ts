/**
 * Sound cues, synthesized with the Web Audio API so the package ships no audio
 * asset. Each cue is a short envelope on an oscillator — a soft tick for new
 * traffic, a low buzz for an error, a two-note rise for a success.
 *
 * Everything is lazy and guarded: the `AudioContext` is created on first play
 * (browsers require a user gesture, which opening the panel satisfies), and if
 * the API is missing — jsdom, older engines — every method is a silent no-op.
 */
export interface SoundPlayer {
  tick(): void;
  error(): void;
  success(): void;
  setEnabled(enabled: boolean): void;
  setVolume(volume: number): void;
}

type AudioContextCtor = typeof AudioContext;

function getAudioContextCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

export interface SoundPlayerOptions {
  enabled?: boolean;
  volume?: number;
}

export function createSoundPlayer(options: SoundPlayerOptions = {}): SoundPlayer {
  const Ctor = getAudioContextCtor();
  let enabled = options.enabled ?? false;
  let volume = clampVolume(options.volume ?? 0.2);
  let context: AudioContext | null = null;

  function ensureContext(): AudioContext | null {
    if (!Ctor) return null;
    if (!context) {
      try {
        context = new Ctor();
      } catch {
        return null;
      }
    }
    // A context can be suspended until a gesture resumes it.
    if (context.state === "suspended") void context.resume();
    return context;
  }

  /** One oscillator with a quick attack/decay, so cues never linger or click. */
  function play(notes: number[], type: OscillatorType, noteMs: number): void {
    if (!enabled || volume <= 0) return;
    const ctx = ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const step = noteMs / 1000;
    notes.forEach((frequency, index) => {
      const start = now + index * step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = frequency;
      // Attack to the target then exponential decay to near-silence.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + step);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + step);
    });
  }

  return {
    tick: () => play([880], "sine", 60),
    error: () => play([220, 160], "square", 120),
    success: () => play([660, 990], "sine", 90),
    setEnabled: (next) => {
      enabled = next;
      if (next) ensureContext();
    },
    setVolume: (next) => {
      volume = clampVolume(next);
    },
  };
}

function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  return Math.min(1, Math.max(0, volume));
}
