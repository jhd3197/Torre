import { act, renderHook } from '@testing-library/react';
import { useNarration } from './useNarration';
import { resetVoicePacks, voiceKey } from '../lib/voice';
import { masterVolume, speechSpeed, voiceVolume } from '../lib/audio';
import { useCaption } from '../lib/captions';

describe('useNarration', () => {
  const spoken: string[] = [];
  beforeEach(() => {
    spoken.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(text: string) { this.text = text; } });
    vi.stubGlobal('speechSynthesis', {
      getVoices: () => [], cancel: () => {}, speak: (u: { text: string }) => spoken.push(u.text),
    });
    // A missing mp3: the element reports an error and play() rejects, as browsers do for a 404.
    vi.stubGlobal('Audio', class {
      onerror: (() => void) | null = null;
      onended: (() => void) | null = null;
      pause() {}
      play() {
        setTimeout(() => this.onerror?.(), 0);
        return Promise.reject(new Error('404'));
      }
    });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  test('a missing mp3 falls back to speech once, not once per failure signal', async () => {
    const { result } = renderHook(() => useNarration());
    await act(async () => {
      result.current.speak({ narration: 'Meet the rook.', audioUrl: 'art/audio/lessons/the-rook/intro.mp3' });
      await vi.advanceTimersByTimeAsync(2000); // past the wait for the voice list (this browser has no voices)
    });
    expect(spoken).toEqual(['Meet the rook.']);
  });

  test('recorded parts play back to back; one missing part reads the whole line instead', async () => {
    const played: string[] = [];
    const rates: number[] = [];
    vi.stubGlobal('Audio', class {
      onerror: (() => void) | null = null;
      onended: (() => void) | null = null;
      constructor(public src: string) {}
      pause() {}
      playbackRate = 1;
      play() { played.push(this.src); rates.push(this.playbackRate); setTimeout(() => this.onended?.(), 100); return Promise.resolve(); }
    });
    const lines = { [voiceKey('Blunder!')]: {}, [voiceKey('The best move was')]: {}, [voiceKey('knight to f5')]: {} };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ lines }) }));
    resetVoicePacks();
    const { result } = renderHook(() => useNarration());
    await act(async () => {
      result.current.speak({ parts: ['Blunder!', 'The best move was', 'knight to f5'] });
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(played).toEqual([`audio/en/${voiceKey('Blunder!')}.mp3`, `audio/en/${voiceKey('The best move was')}.mp3`, `audio/en/${voiceKey('knight to f5')}.mp3`]);
    expect(rates.every(rate => rate === 1)).toBe(true);
    expect(spoken).toEqual([]);

    played.length = 0;
    await act(async () => {
      result.current.speak({ parts: ['Blunder!', 'The best move was', 'queen to h5'] });
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(played).toEqual([]);
    expect(spoken).toEqual(['Blunder! The best move was queen to h5']);
    resetVoicePacks();
  });

  test('the review commentary plays faster, recorded or read', async () => {
    const rates: number[] = [];
    vi.stubGlobal('Audio', class {
      onerror: (() => void) | null = null;
      onended: (() => void) | null = null;
      playbackRate = 1;
      constructor(public src: string) {}
      pause() {}
      play() { rates.push(this.playbackRate); setTimeout(() => this.onended?.(), 50); return Promise.resolve(); }
    });
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ lines: { [voiceKey('Blunder!')]: {} } }) }));
    resetVoicePacks();
    const { result } = renderHook(() => useNarration());
    await act(async () => {
      result.current.speak({ parts: ['Blunder!'], rate: 1.25 });
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(rates).toEqual([1.25]);
    resetVoicePacks();
  });

  test('a narration built from recorded parts plays them in turn and says which part is on', async () => {
    const played: string[] = [];
    vi.stubGlobal('Audio', class {
      onerror: (() => void) | null = null;
      onended: (() => void) | null = null;
      constructor(public src: string) {}
      pause() {}
      playbackRate = 1;
      play() { played.push(this.src); setTimeout(() => this.onended?.(), 100); return Promise.resolve(); }
    });
    const lines = { [voiceKey('On move 14, you played')]: {}, [voiceKey('knight to e7')]: {} };
    vi.stubGlobal('fetch', () => Promise.resolve({ ok: true, json: () => Promise.resolve({ lines }) }));
    resetVoicePacks();
    const parts: number[] = [];
    const { result } = renderHook(() => useNarration());
    await act(async () => {
      result.current.speak({ narration: 'On move 14, you played|knight to e7', onPart: i => parts.push(i) });
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(played).toEqual([`audio/en/${voiceKey('On move 14, you played')}.mp3`, `audio/en/${voiceKey('knight to e7')}.mp3`]);
    expect(parts).toEqual([0, 1]);
    resetVoicePacks();
  });

  test('the speech speed and voice volume from Settings reach every clip, and the caption shows the line', async () => {
    const heard: { rate: number; volume: number }[] = [];
    vi.stubGlobal('Audio', class {
      onerror: (() => void) | null = null;
      onended: (() => void) | null = null;
      constructor(public src: string) {}
      pause() {}
      playbackRate = 1;
      volume = 1;
      play() { heard.push({ rate: this.playbackRate, volume: this.volume }); setTimeout(() => this.onended?.(), 100); return Promise.resolve(); }
    });
    speechSpeed.set('fast');
    voiceVolume.set(50);
    masterVolume.set(80);
    const caption = renderHook(() => useCaption());
    const { result } = renderHook(() => useNarration());
    await act(async () => {
      result.current.speak({ narration: 'Well played.', audioUrl: 'audio/en/well.mp3', rate: 1.25 });
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(heard).toEqual([{ rate: 1.25 * 1.2, volume: 0.4 }]);
    expect(caption.result.current).toBe('Well played.');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(caption.result.current).toBeNull();
  });
});
