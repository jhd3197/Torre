// Background music: a quiet loop under the whole app. A track at MUSIC_URL is
// played when it exists; otherwise a gentle music-box loop is synthesized with
// WebAudio (soft plucks over slow pad chords), so nothing has to ship. Browsers
// only allow sound after a click or key, so it starts on the first one. It dips
// while the coach speaks (as far as Settings says) and pauses while the tab is hidden.
import { createLevel, createSetting } from './settings';
import { duckedShare, mainGain, masterVolume, musicDip, muteAll, quietWhenHidden } from './audio';

export const MUSIC_URL = 'art/audio/music/theme.mp3';

const ON_OFF = ['on', 'off'] as const;
const TRACK_GAIN = 0.32; // a track at full level, before the volume choice
const SYNTH_GAIN = 0.55; // the synthesized loop's master level, before the volume choice
const LEVEL_KEY = 'chess-jd-music-level';

// The volume was once Low / Medium / High; a stored choice becomes the same level on the slider.
const OLD_LEVELS: Record<string, number> = { low: 35, medium: 65, high: 100 };
try {
  const old = localStorage.getItem('chess-jd-music-volume');
  if (old !== null) {
    if (old in OLD_LEVELS && localStorage.getItem(LEVEL_KEY) === null) localStorage.setItem(LEVEL_KEY, String(OLD_LEVELS[old]));
    localStorage.removeItem('chess-jd-music-volume');
  }
} catch { /* storage unavailable */ }

export const backgroundMusic = createSetting('chess-jd-music', 'on', ON_OFF, value => (value === 'on' ? start() : stop()));
/** The music's own volume, 0 to 100, under the main volume. */
export const musicLevel = createLevel(LEVEL_KEY, 35, () => applyLevel());
for (const setting of [masterVolume, muteAll, musicDip]) setting.subscribe(() => applyLevel());

let ducked = false;
let unlocked = false;
let track: HTMLAudioElement | null = null;
let trackMissing = false;
let synth: Synth | null = null;

const level = () => musicLevel.get() / 100 * mainGain() * (ducked ? duckedShare() : 1);

function applyLevel() {
  if (track) track.volume = Math.min(1, TRACK_GAIN * level());
  synth?.setLevel(SYNTH_GAIN * level());
}

/** Lower the music under the coach's voice, and bring it back after. */
export function duckMusic(on: boolean) {
  if (ducked === on) return;
  ducked = on;
  applyLevel();
}

function start() {
  if (!unlocked || backgroundMusic.get() === 'off' || (document.hidden && quietWhenHidden.get())) return;
  if (!trackMissing) {
    if (!track) {
      track = new Audio(MUSIC_URL);
      track.loop = true;
      track.onerror = () => { trackMissing = true; track = null; start(); };
    }
    applyLevel();
    track.play().catch(() => undefined);
    return;
  }
  synth ??= Synth.create();
  synth?.start(SYNTH_GAIN * level());
}

function stop() {
  track?.pause();
  synth?.stop();
}

/** Call once at start-up: music begins with the first click or key, if it is switched on. */
export function initMusic() {
  if (typeof window === 'undefined') return;
  const unlock = () => {
    unlocked = true;
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
    start();
  };
  window.addEventListener('pointerdown', unlock);
  window.addEventListener('keydown', unlock);
  // A hidden tab pauses the music unless Settings asks to keep it playing.
  document.addEventListener('visibilitychange', () => (document.hidden ? quietWhenHidden.get() && stop() : start()));
}

// ── The synthesized loop ─────────────────────────────────────────────────────

const BEAT = 60 / 66; // seconds per beat: an unhurried 66 bpm
const BAR = BEAT * 4;
// C major, two bars per chord: C, A minor, F, G. Pad tones and the melody's chord tones.
const CHORDS = [
  { pad: [130.81, 196.0, 261.63], tones: [523.25, 659.25, 783.99, 1046.5] },
  { pad: [110.0, 164.81, 220.0], tones: [440.0, 523.25, 659.25, 880.0] },
  { pad: [87.31, 130.81, 174.61], tones: [349.23, 440.0, 523.25, 698.46] },
  { pad: [98.0, 146.83, 196.0], tones: [392.0, 493.88, 587.33, 783.99] },
];
// Which beats of a bar carry a pluck, in a few rhythms the loop cycles through.
const RHYTHMS = [[0, 1.5, 2, 3], [0, 2, 2.5], [0, 1, 2, 3.5], [0, 2.5, 3]];

class Synth {
  private bar = 0;
  private nextBar = 0;
  private timer: ReturnType<typeof setInterval> | null = null;

  private constructor(private ctx: AudioContext, private master: GainNode, private out: AudioNode) {}

  static create(): Synth | null {
    try {
      const Ctor = window.AudioContext ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return null;
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0;
      // A soft lowpass and a short echo stand in for a room.
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2600;
      const echo = ctx.createDelay();
      echo.delayTime.value = BEAT * 0.75;
      const feedback = ctx.createGain();
      feedback.gain.value = 0.28;
      tone.connect(master);
      tone.connect(echo);
      echo.connect(feedback);
      feedback.connect(echo);
      echo.connect(master);
      master.connect(ctx.destination);
      return new Synth(ctx, master, tone);
    } catch {
      return null;
    }
  }

  setLevel(value: number) {
    const now = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(value, now, 0.6);
  }

  start(value: number) {
    void this.ctx.resume().catch(() => undefined);
    this.setLevel(value);
    if (this.timer) return;
    this.nextBar = this.ctx.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 250);
    this.schedule();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.setLevel(0);
    setTimeout(() => { if (!this.timer) void this.ctx.suspend().catch(() => undefined); }, 1500);
  }

  /** Queue the bars that start within the next second. */
  private schedule() {
    while (this.nextBar < this.ctx.currentTime + 1) {
      const chord = CHORDS[Math.floor(this.bar / 2) % CHORDS.length];
      if (this.bar % 2 === 0) chord.pad.forEach(freq => this.pad(freq, this.nextBar, BAR * 2));
      const rhythm = RHYTHMS[this.bar % RHYTHMS.length];
      rhythm.forEach((beat, i) => {
        // A gentle walk through the chord tones rather than random jumps.
        const freq = chord.tones[(this.bar + i * 2) % chord.tones.length];
        this.pluck(freq, this.nextBar + beat * BEAT);
      });
      this.bar += 1;
      this.nextBar += BAR;
    }
  }

  private pluck(freq: number, at: number) {
    for (const [mult, gain, type] of [[1, 0.05, 'sine'], [2, 0.012, 'triangle']] as const) {
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq * mult;
      amp.gain.setValueAtTime(0.0001, at);
      amp.gain.exponentialRampToValueAtTime(gain, at + 0.008);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + 1.9);
      osc.connect(amp);
      amp.connect(this.out);
      osc.start(at);
      osc.stop(at + 2);
    }
  }

  private pad(freq: number, at: number, length: number) {
    for (const detune of [-6, 6]) {
      const osc = this.ctx.createOscillator();
      const amp = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.detune.value = detune;
      amp.gain.setValueAtTime(0.0001, at);
      amp.gain.exponentialRampToValueAtTime(0.011, at + length * 0.3);
      amp.gain.exponentialRampToValueAtTime(0.0001, at + length);
      osc.connect(amp);
      amp.connect(this.out);
      osc.start(at);
      osc.stop(at + length + 0.1);
    }
  }
}
