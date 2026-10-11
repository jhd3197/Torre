// Recorded coach lines. A voice pack (narrate.py) holds one mp3 per spoken sentence, named by a
// hash of the sentence, so any fixed line the app says (lesson narration, praise, puzzle coach
// lines...) finds its recording without ids; anything without one falls back to browser speech.
// Packs are served at audio/<voice>/ by the studio once installed (see the packs API): each language
// has a female and a male coach, and the player picks one in Settings.
import i18n from '../i18n';
import { createSetting } from './settings';

export const COACH_VOICES = ['female', 'male'] as const;
export type CoachVoice = typeof COACH_VOICES[number];
/** Which coach speaks: the female voice (the packs that came first) or the male one. */
export const coachVoice = createSetting<CoachVoice>('chess-jd-coach-voice', 'female', COACH_VOICES);

/** A pack's folder under audio/: "en" for the female English voice, "en-male" for the male one (narrate.py pack_folder). */
export const voiceFolder = (lang: string, voice: CoachVoice) => (voice === 'female' ? lang : `${lang}-${voice}`);

/** The text as recorded: trimmed, single-spaced. narrate.py normalizes the same way. */
export const spokenForm = (text: string) => text.replace(/\s+/g, ' ').trim();

/** 64-bit FNV-1a of the UTF-8 text, as 16 hex digits (narrate.py voice_key). */
export function voiceKey(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(spokenForm(text))) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

const manifests = new Map<string, Promise<Set<string>>>();

/** The keys an installed pack has (empty when that pack is not installed). */
function manifest(folder: string): Promise<Set<string>> {
  let found = manifests.get(folder);
  if (!found) {
    found = fetch(`audio/${folder}/manifest.json`)
      .then(response => (response.ok ? response.json() : { lines: {} }))
      .then((data: { lines?: Record<string, unknown> }) => new Set(Object.keys(data.lines ?? {})))
      .catch(() => new Set<string>());
    manifests.set(folder, found);
  }
  return found;
}

/** Forget cached manifests (after a pack is installed or removed). */
export const resetVoicePacks = () => manifests.clear();

/**
 * Recordings of lines said together, all in one voice: the chosen coach's pack when it has every
 * line, else the other coach's (a recorded voice beats the browser's), else none of them.
 */
export async function recordedLines(texts: string[]): Promise<(string | undefined)[]> {
  const lang = i18n.language || 'en';
  const chosen = coachVoice.get();
  const keys = texts.map(voiceKey);
  for (const voice of [chosen, ...COACH_VOICES.filter(v => v !== chosen)]) {
    const folder = voiceFolder(lang, voice), have = await manifest(folder);
    if (keys.every(key => have.has(key))) return keys.map(key => `audio/${folder}/${key}.mp3`);
  }
  return texts.map(() => undefined);
}
