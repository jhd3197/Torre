// Searching Settings: every row's name and description, by section, so a word finds its setting in
// whichever section holds it. A plain key stands for `<key>` and `<key>Note`; a pair names both.
// SettingsPage.test checks each entry exists and its row is on its section's page.
import type { TFunction } from 'i18next';

export const SETTINGS_SECTIONS = ['general', 'sidebar', 'display', 'sound', 'voice', 'learning', 'analysis', 'ai', 'engines', 'accessibility', 'data', 'about'] as const;
export type SectionId = typeof SETTINGS_SECTIONS[number];

type Entry = string | readonly [label: string, note: string | null];

export const SEARCH_INDEX: Record<SectionId, readonly Entry[]> = {
  general: [['language.title', 'language.note'], 'general.startPage', 'general.notes'],
  sidebar: [['sidebar.shown', 'sidebar.shownNote'], ['sidebar.hidden', null], 'sidebar.rail', 'sidebar.reset'],
  display: [['pieces.label', null], ['board.title', null], 'board.coordinates', 'board.lastMove', 'board.legalDots', 'board.animation',
    'board.drag', 'board.autoQueen'],
  sound: ['sound.mute', 'sound.master', 'sound.effects', 'sound.effectsVolume', 'sound.moveSound', 'sound.music', 'sound.musicVolume', 'sound.hidden'],
  voice: ['voice.speaks', 'voice.coach', 'voice.speed', 'voice.volume', 'voice.dip', 'voice.captions', 'voice.rooky', 'voice.review', 'voice.quiet',
    ['voice.heading', 'voice.note']],
  learning: ['learning.hard', 'learning.help', 'learning.autoNext', 'learning.ratings', 'learning.blindfold', 'learning.playBlindfold'],
  analysis: ['analysis.background', 'analysis.auto', 'analysis.depth', 'analysis.lines', 'analysis.evalBar', 'analysis.best', 'analysis.next', 'analysis.control'],
  ai: [['ai.provider', 'ai.providerNote'], ['ai.key', 'ai.keyNote'], ['ai.model', null]],
  engines: [],
  accessibility: ['accessibility.size', 'accessibility.motion', 'accessibility.contrast', 'accessibility.palette', 'accessibility.announce', 'accessibility.typed'],
  data: [['progress.stars', null], 'data.reset', 'data.backup', 'data.restore', ['data.storage', null]],
  about: [['about.version', null], ['about.whatsNew', null], 'about.data', ['about.engines', null], ['about.shortcuts', null], ['about.credits', null]],
};

export interface SearchHit { section: SectionId; label: string; labelKey: string; note: string | null }

/** Lowercase, without accents, so "musica" finds "Música". */
export const folded = (text: string) => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Every entry as words to search. */
export function searchEntries(t: TFunction): SearchHit[] {
  return SETTINGS_SECTIONS.flatMap(section => [
    { section, label: t(`${section}.title`), labelKey: '', note: null },
    ...SEARCH_INDEX[section].map(entry => {
      const [labelKey, noteKey] = typeof entry === 'string' ? [entry, `${entry}Note`] : entry;
      return { section, label: t(labelKey), labelKey, note: noteKey ? t(noteKey, { count: 0, size: 0, date: '' }) : null };
    }),
  ]);
}

/** The entries whose name, description or section match every word of the query. */
export function searchSettings(t: TFunction, query: string): SearchHit[] {
  const words = folded(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return searchEntries(t).filter(hit => {
    const text = folded(`${hit.label} ${hit.note ?? ''} ${t(`${hit.section}.title`)}`);
    return words.every(word => text.includes(word));
  });
}
