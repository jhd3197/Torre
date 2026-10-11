// Tiny UI sounds, synthesized with WebAudio so no assets have to ship. They follow
// the Sound effects setting; inside a lesson they also follow the lesson's mute
// button (useNarration's lessonSound), which silences the whole lesson. Browsers
// without WebAudio (jsdom, old engines) simply stay quiet.
import { useEffect } from 'react';
import type { Verdict } from '../components/VerdictBar';
import { createSetting } from '../lib/settings';
import { effectsGain, hiddenQuiet, moveSoundStyle, type MoveSoundStyle } from '../lib/audio';
import { lessonSound } from './useNarration';

export const soundEffects = createSetting('chess-jd-sound-effects', 'on', ['on', 'off'] as const);

/** Where a sound plays: anywhere, or inside a lesson (where the lesson's mute applies too). */
export type SoundScope = 'app' | 'lesson';

interface Tone {
  freq: number;
  /** Start offset in seconds. */
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  /** Pitch slide target (Hz) over the tone's duration. */
  slide?: number;
  /** A burst of noise through a band-pass filter at `freq` (with this Q) instead of a pitched tone:
   *  the click of wood on wood. */
  noise?: number;
}

// A piece set down on a wooden board: a short band-passed click for the contact, and a low thump
// under it for the board's body. `pitch` shifts the click a little, so each piece sounds its own.
const knock = (at = 0, gain = 1, pitch = 1): Tone[] => [
  { freq: 1900 * pitch, noise: 1.6, at, dur: 0.045, gain: 0.32 * gain },
  { freq: 190 * pitch, slide: 120, at, dur: 0.09, type: 'sine', gain: 0.16 * gain },
];

// The Soft style: a short rounded tap instead of the wooden knock.
const tap = (at = 0, gain = 1, pitch = 1): Tone[] => [
  { freq: 660 * pitch, slide: 520 * pitch, at, dur: 0.08, type: 'sine', gain: 0.06 * gain },
];

/** The move sounds built on one kind of hit (a knock or a tap). */
const moveSet = (hit: typeof knock): Record<MoveSound, Tone[]> => ({
  // A move landing on the board.
  move: hit(),
  // A capture: the piece lands hard, and the captured one is knocked off a beat later.
  capture: [...hit(0, 1.35, 1.15), ...hit(0.05, 0.6, 0.85)],
  // Check: the hit, then a short bright ping.
  check: [...hit(), { freq: 1318.5, at: 0.06, dur: 0.18, type: 'sine', gain: 0.035 }],
  // Castling: king, then rook, two quick hits.
  castle: [...hit(0, 1, 0.95), ...hit(0.11, 0.85, 1.08)],
  // Promotion: the hit, then a little rising chime.
  promote: [
    ...hit(),
    { freq: 783.99, at: 0.07, dur: 0.12, type: 'triangle', gain: 0.045 },
    { freq: 1174.66, at: 0.16, dur: 0.22, type: 'triangle', gain: 0.045 },
  ],
});

export type MoveSound = 'move' | 'capture' | 'check' | 'castle' | 'promote';

/** Which sound a move makes, read from its SAN: a check over a capture, castling and promotion their own. */
export function moveSound(san?: string): MoveSound {
  if (!san) return 'move';
  if (/[+#]/.test(san)) return 'check';
  if (san.includes('=')) return 'promote';
  if (san.startsWith('O-O')) return 'castle';
  return san.includes('x') ? 'capture' : 'move';
}
const MOVE_TONES: Record<Exclude<MoveSoundStyle, 'none'>, Record<MoveSound, Tone[]>> = { wood: moveSet(knock), soft: moveSet(tap) };
// Two rising notes for a correct verdict.
const CORRECT: Tone[] = [
  { freq: 659.25, dur: 0.09, gain: 0.05 },
  { freq: 987.77, at: 0.09, dur: 0.16, gain: 0.05 },
];
// A short low buzz sliding down for a wrong verdict.
const WRONG: Tone[] = [{ freq: 164.81, slide: 110, dur: 0.2, type: 'sawtooth', gain: 0.03 }];
// A little C-major arpeggio when a lesson (or node) completes.
const COMPLETE: Tone[] = [
  { freq: 523.25, dur: 0.12, type: 'triangle', gain: 0.055 },
  { freq: 659.25, at: 0.1, dur: 0.12, type: 'triangle', gain: 0.055 },
  { freq: 783.99, at: 0.2, dur: 0.12, type: 'triangle', gain: 0.055 },
  { freq: 1046.5, at: 0.3, dur: 0.3, type: 'triangle', gain: 0.055 },
];

// Bot cues (data/botMechanics.ts): sounds a custom bot plays at moments of its game.
/** El Silbón's whistle: do, re, mi, fa, sol, la, si, each note bending up as it is whistled. */
const WHISTLE: Tone[] = [1046.5, 1174.66, 1318.51, 1396.91, 1567.98, 1760, 1975.53].map((freq, i) => (
  { freq, slide: freq * 1.03, at: i * 0.2, dur: i === 6 ? 0.5 : 0.19, type: 'sine', gain: 0.06 }));
/** A sack of bones shaken: dry, uneven clicks. */
const BONES: Tone[] = [0, 0.05, 0.08, 0.14, 0.19, 0.27, 0.31, 0.4].map((at, i) => (
  { freq: 2400 - (i % 3) * 500, noise: 6, at, dur: 0.035, gain: 0.22 - (i % 2) * 0.08 }));
/** A low gust of wind across the plains. */
const WIND: Tone[] = [0, 0.18, 0.36, 0.54, 0.72].map((at, i) => (
  { freq: 420 + i * 60, noise: 0.7, at, dur: 0.3, gain: 0.05 + (i === 2 ? 0.04 : 0) }));
/** A distant bell, one stroke. */
const TOLL: Tone[] = [{ freq: 196, dur: 2.2, type: 'triangle', gain: 0.07 }, { freq: 392.6, dur: 1.6, type: 'sine', gain: 0.025 }];

export const SYNTH_CUES = { whistle: WHISTLE, bones: BONES, wind: WIND, toll: TOLL } as const;
export type SynthCue = keyof typeof SYNTH_CUES;

let shared: AudioContext | null = null;

/** The one shared context, created lazily inside a user gesture so autoplay rules allow it. */
function audioContext(): AudioContext | null {
  try {
    const Ctor = window.AudioContext
      ?? (window as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    shared ??= new Ctor();
    if (shared.state === 'suspended') void shared.resume().catch(() => undefined);
    return shared;
  } catch {
    return null;
  }
}

let noiseBuffer: AudioBuffer | null = null;

/** A quarter second of white noise, made once and reused for every click. */
function noise(ctx: AudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  noiseBuffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.25), ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function play(tones: Tone[], scope: SoundScope, level = 1) {
  if (soundEffects.get() === 'off' || (scope === 'lesson' && lessonSound.get() === 'off') || hiddenQuiet()) return;
  const volume = level * effectsGain();
  if (volume <= 0) return;
  const ctx = audioContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    for (const tone of tones) {
      const amp = ctx.createGain();
      const at = now + (tone.at ?? 0);
      // Pitched tones swell in over 12 ms; a click hits at once (2 ms), as wood does.
      amp.gain.setValueAtTime(0.0001, at);
      amp.gain.exponentialRampToValueAtTime(Math.max(0.0002, (tone.gain ?? 0.05) * volume), at + (tone.noise ? 0.002 : 0.012));
      amp.gain.exponentialRampToValueAtTime(0.0001, at + tone.dur);
      amp.connect(ctx.destination);
      let source: AudioScheduledSourceNode;
      if (tone.noise) {
        const burst = ctx.createBufferSource();
        burst.buffer = noise(ctx);
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.frequency.setValueAtTime(tone.freq, at);
        band.Q.setValueAtTime(tone.noise, at);
        burst.connect(band);
        band.connect(amp);
        source = burst;
      } else {
        const osc = ctx.createOscillator();
        osc.type = tone.type ?? 'sine';
        osc.frequency.setValueAtTime(tone.freq, at);
        if (tone.slide) osc.frequency.exponentialRampToValueAtTime(tone.slide, at + tone.dur);
        osc.connect(amp);
        source = osc;
      }
      source.start(at);
      source.stop(at + tone.dur + 0.05);
    }
  } catch { /* audio unavailable */ }
}

/** A bot's cue: a built-in synth sound, or an audio file under web/public (an mp3 or ogg), at a
 *  volume from 0 to 1. It follows the Sound effects setting like every other sound. */
export function playCue(cue: { synth?: SynthCue; file?: string }, volume = 1) {
  if (soundEffects.get() === 'off') return;
  const level = Math.max(0, Math.min(1, volume));
  if (cue.synth) { play([...SYNTH_CUES[cue.synth]], 'app', level); return; }
  if (!cue.file || hiddenQuiet()) return;
  try {
    const audio = new Audio(cue.file);
    audio.volume = level * effectsGain();
    void audio.play().catch(() => undefined);
  } catch { /* audio unavailable */ }
}

/** Forget the cached context (tests stub AudioContext per test). */
export const resetSounds = () => { shared = null; noiseBuffer = null; };

const soundsFor = (scope: SoundScope) => ({
  /** A piece moving; given the move's SAN, a capture, check, castling or promotion sounds its own. */
  move: (san?: string) => {
    const style = moveSoundStyle.get();
    if (style !== 'none') play(MOVE_TONES[style][moveSound(san)], scope);
  },
  correct: () => play(CORRECT, scope),
  wrong: () => play(WRONG, scope),
  complete: () => play(COMPLETE, scope),
});
const SOUNDS: Record<SoundScope, ReturnType<typeof soundsFor>> = { app: soundsFor('app'), lesson: soundsFor('lesson') };

/** The sounds as stable callbacks, safe in effect dependency lists. */
export function useSounds(scope: SoundScope = 'app') {
  return SOUNDS[scope];
}

/** Chimes or buzzes whenever the verdict bar commits; neutral stays silent. */
export function useVerdictSound(verdict: Verdict, scope: SoundScope = 'app') {
  useEffect(() => {
    if (verdict === 'correct') SOUNDS[scope].correct();
    else if (verdict === 'wrong') SOUNDS[scope].wrong();
  }, [verdict, scope]);
}
