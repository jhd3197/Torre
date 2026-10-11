// Spoken coaching: a pre-generated mp3 when it exists (or a run of them, for commentary built from
// recorded parts), the browser's speech synthesis otherwise. One narration plays at a time; speak() replaces it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createSetting } from '../lib/settings';
import { duckMusic } from '../lib/music';
import { speechRate, voiceGain } from '../lib/audio';
import { clearCaption, showCaption } from '../lib/captions';
import { coachVoice, recordedLines } from '../lib/voice';
import i18n from '../i18n';

const SOUND_CHOICES = ['on', 'off'] as const;
type SoundChoice = typeof SOUND_CHOICES[number];

/** Whether lesson narration is audible; shared so every toggle follows at once. */
export const lessonSound = createSetting<SoundChoice>('chess-jd-lesson-sound', 'on', SOUND_CHOICES);
export const useLessonSoundOn = () => lessonSound.use() === 'on';
export const setLessonSoundOn = (on: boolean) => lessonSound.set(on ? 'on' : 'off');

export interface Narration {
  /** The line to speak (and the fallback text when the audio file is missing). */
  narration?: string;
  /** A specific recording to play; by default the voice pack's recording of `narration` is used. */
  audioUrl?: string;
  /** Recorded lines said back to back (lib/commentary.ts): the voice pack's clips when it has every
   *  one, otherwise the browser reads them all as one line, so a sentence never mixes two voices. */
  parts?: string[];
  /** Playback speed (1 = as recorded); the review commentary plays a little faster. The speech
   *  speed chosen in Settings multiplies it. */
  rate?: number;
  /** Told which part is playing as each one starts (-1 when the browser reads the whole line at once). */
  onPart?: (index: number) => void;
}

/** Splits a narration into recorded pieces said back to back: the coach's generated lessons
 *  (coach_lessons.py PART) build a sentence out of separately recorded lines this way. */
export const NARRATION_PART = '|';
export const narrationParts = (narration = '') => narration.split(NARRATION_PART).map(part => part.trim()).filter(Boolean);
/** A narration as one readable line: its parts joined with spaces. */
export const narrationText = (narration = '') => narrationParts(narration).join(' ');

// Declared before the module-load loadVoices() call below, which reads VOICE_WAIT.
const READING_PACE = 65; // ms per word when the line can only be read, not heard
const MIN_NARRATION = 2500; // a narration never "finishes" faster than this
const SPEAK_DELAY = 80; // Chrome drops utterances spoken right after cancel(); let it settle
const VOICE_WAIT = 1500; // the longest an early line waits for the voice list
const PART_GAP = 110; // ms between recorded parts: the clips are trimmed of silence, so they need a breath

// Browsers load their voice list late: getVoices() is empty until 'voiceschanged' fires, and a line
// spoken before that gets the basic default voice (the robotic one). Ask for the list as soon as the
// app loads, and let an early line wait briefly for it.
let voicesReady: Promise<void> | null = null;
function loadVoices(): Promise<void> {
  if (voicesReady) return voicesReady;
  voicesReady = new Promise(resolve => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || synth.getVoices().length) { resolve(); return; }
    const done = () => { synth.removeEventListener?.('voiceschanged', done); resolve(); };
    synth.addEventListener?.('voiceschanged', done);
    setTimeout(done, VOICE_WAIT);
  });
  return voicesReady;
}
if (typeof window !== 'undefined' && window.speechSynthesis) void loadVoices();

// Browsers do not say a voice's gender, but male voices are recognizable by name ("Google UK English
// Male", "Microsoft Guy", "Jorge"...); the rest are taken as female.
const MALE_VOICE = /\b(male|guy|david|mark|james|george|christopher|eric|roger|andrew|brian|ryan|thomas|daniel|alex|fred|jorge|pablo|raul|alvaro|gonzalo|tomas|emilio|diego|juan|carlos|enrique)\b/i;
export const isMaleVoice = (voice: Pick<SpeechSynthesisVoice, 'name'>) => !/female/i.test(voice.name) && MALE_VOICE.test(voice.name);

/** The browser's best voice for the app's language and the chosen coach: a natural one first; for Spanish, a Latin American one. */
function pickVoice(): SpeechSynthesisVoice | null {
  const lang = (i18n.language || 'en').slice(0, 2);
  const inLanguage = window.speechSynthesis.getVoices().filter(v => v.lang.toLowerCase().startsWith(lang));
  // The chosen coach's gender when the browser has such a voice; any voice of the language otherwise.
  const male = coachVoice.get() === 'male';
  const matching = inLanguage.filter(v => isMaleVoice(v) === male);
  const voices = matching.length ? matching : inLanguage;
  const regional = lang === 'es' ? voices.filter(v => /-(mx|us|419|co|ar)/i.test(v.lang)) : voices;
  return regional.find(v => v.name.includes('Natural')) ?? voices.find(v => v.name.includes('Natural'))
    ?? voices.find(v => v.name.includes('Google')) ?? regional[0] ?? voices[0] ?? null;
}

/** How long the line takes to read, the fallback duration when nothing can play it. */
const readingTime = (text: string) => Math.max(MIN_NARRATION, text.split(/\s+/).filter(Boolean).length * READING_PACE);

export function useNarration() {
  const [speaking, setSpeaking] = useState(false);
  const tokenRef = useRef(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // This narrator's identity for the captions strip.
  const [owner] = useState(() => ({}));

  const stop = useCallback(() => {
    tokenRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch { /* speech unavailable */ }
    setSpeaking(false);
    clearCaption(owner);
  }, [owner]);

  const speak = useCallback((request: Narration | null, onEnd?: () => void) => {
    stop();
    const token = tokenRef.current;
    let finished = false;
    const finish = () => {
      if (finished || token !== tokenRef.current) return;
      finished = true;
      setSpeaking(false);
      clearCaption(owner);
      onEnd?.();
    };
    const given = request?.parts ?? (request?.narration?.includes(NARRATION_PART) ? narrationParts(request.narration) : []);
    const parts = given.map(part => part.trim()).filter(Boolean);
    const text = parts.length ? parts.join(' ') : request?.narration?.trim() ?? '';
    if (lessonSound.get() === 'off' || (!text && !request?.audioUrl)) { setTimeout(finish, 30); return; }

    // However the narration ends — genuinely, or by failing instantly (a 404 mp3, an
    // utterance the browser drops) — it lasts at least a reading of the line, so an
    // instant failure never reads as "narration over" and autoplay keeps a sane pace.
    const rate = (request?.rate ?? 1) * speechRate();
    const volume = voiceGain();
    showCaption(owner, text);
    const startedAt = Date.now();
    const estimate = readingTime(text) / rate;
    const finishNoSoonerThanEstimate = () => setTimeout(finish, Math.max(0, estimate - (Date.now() - startedAt)));

    const say = (attempt = 0): void => {
      if (finished || token !== tokenRef.current) return;
      request?.onPart?.(-1);
      if (!text || typeof window.speechSynthesis === 'undefined') { finishNoSoonerThanEstimate(); return; }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      const voice = pickVoice();
      if (voice) utterance.voice = voice;
      utterance.rate = rate;
      utterance.volume = volume;
      utterance.pitch = 1.05;
      utterance.onend = finishNoSoonerThanEstimate;
      utterance.onerror = () => {
        // An instant error is usually the cancel-then-speak race flushing the new utterance; retry once.
        if (attempt === 0 && Date.now() - startedAt < 1000) say(1);
        else finishNoSoonerThanEstimate();
      };
      setSpeaking(true);
      void loadVoices().then(() => setTimeout(() => {
        if (finished || token !== tokenRef.current) return;
        const voice = pickVoice();
        if (voice) utterance.voice = voice;
        try { window.speechSynthesis.speak(utterance); } catch { finishNoSoonerThanEstimate(); }
      }, SPEAK_DELAY));
      // A browser that never reports the utterance's end must not stall autoplay forever.
      setTimeout(finishNoSoonerThanEstimate, Math.max(estimate * 3, 20000));
    };

    // Recordings in order, each loaded up front so the next one starts without a gap.
    const play = (urls: string[]) => {
      const clips = urls.map(url => { const audio = new Audio(url); audio.preload = 'auto'; audio.playbackRate = rate; audio.volume = volume; return audio; });
      const next = (at: number) => {
        if (finished || token !== tokenRef.current) return;
        if (at >= clips.length) { audioRef.current = null; finishNoSoonerThanEstimate(); return; }
        const audio = clips[at];
        audioRef.current = audio;
        request?.onPart?.(at);
        // The mp3s are generated lazily; a missing first file falls back to speech, a later one is
        // skipped. A 404 fires both the error event and the play() rejection, so this runs once,
        // or the line is queued twice and heard twice.
        let failed = false;
        const fail = () => {
          if (failed) return;
          failed = true;
          if (at === 0) { audioRef.current = null; say(); } else next(at + 1);
        };
        audio.onended = () => (at + 1 < clips.length ? setTimeout(() => next(at + 1), PART_GAP / rate) : next(at + 1));
        audio.onerror = fail;
        const playing = audio.play();
        if (playing) playing.catch(fail);
      };
      setSpeaking(true);
      next(0);
    };
    if (request?.audioUrl) { play([request.audioUrl]); return; }
    // The installed voice pack's recording of each line, when it has them all; browser speech otherwise.
    setSpeaking(true);
    void recordedLines(parts.length ? parts : [text]).then(urls => {
      if (finished || token !== tokenRef.current) return;
      if (urls.every(Boolean)) play(urls as string[]);
      else say();
    });
  }, [stop, owner]);

  // The background music dips under the coach's voice.
  useEffect(() => { duckMusic(speaking); }, [speaking]);
  useEffect(() => () => { stop(); duckMusic(false); }, [stop]);

  return { speak, stop, speaking };
}
