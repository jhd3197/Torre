import { coachVoice, recordedLines, resetVoicePacks, spokenForm, voiceKey } from './voice';
import { isMaleVoice } from '../hooks/useNarration';

test('voice keys match narrate.py, so the app finds the recorded lines', () => {
  // The same vectors as test_packs.py.
  expect(voiceKey('Nice find!')).toBe('6ce42dc40718a532');
  expect(voiceKey('  ¡Muy bien!  ')).toBe('cbe9f098cd2180c4');
  expect(spokenForm(' One.\n Two. ')).toBe('One. Two.');
});

describe('the coach voice', () => {
  const pack = (folders: Record<string, string[]>) => vi.stubGlobal('fetch', (url: string) => {
    const folder = url.split('/')[1];
    const lines = Object.fromEntries((folders[folder] ?? []).map(text => [voiceKey(text), {}]));
    return Promise.resolve({ ok: folder in folders, json: () => Promise.resolve({ lines }) });
  });
  afterEach(() => resetVoicePacks());

  test('the chosen coach speaks from its own pack', async () => {
    pack({ en: ['Blunder!'], 'en-male': ['Blunder!'] });
    expect(await recordedLines(['Blunder!'])).toEqual([`audio/en/${voiceKey('Blunder!')}.mp3`]);
    coachVoice.set('male');
    resetVoicePacks();
    expect(await recordedLines(['Blunder!'])).toEqual([`audio/en-male/${voiceKey('Blunder!')}.mp3`]);
  });

  test('without the chosen pack, the other recorded voice says the whole line, never a mix', async () => {
    coachVoice.set('male');
    pack({ en: ['Blunder!', 'The best move was'], 'en-male': ['Blunder!'] });
    expect(await recordedLines(['Blunder!', 'The best move was'])).toEqual(
      [`audio/en/${voiceKey('Blunder!')}.mp3`, `audio/en/${voiceKey('The best move was')}.mp3`]);
    resetVoicePacks();
    pack({ en: ['Blunder!'], 'en-male': ['The best move was'] });
    expect(await recordedLines(['Blunder!', 'The best move was'])).toEqual([undefined, undefined]);
  });

  test('a browser voice is taken as male only when its name says so', () => {
    expect(['Google UK English Male', 'Microsoft Guy Online (Natural)', 'Jorge', 'Microsoft David'].map(name => isMaleVoice({ name }))).toEqual([true, true, true, true]);
    expect(['Google UK English Female', 'Microsoft Aria Online (Natural)', 'Paulina', 'Google español'].map(name => isMaleVoice({ name }))).toEqual([false, false, false, false]);
  });
});
