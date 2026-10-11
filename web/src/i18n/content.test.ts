// locales/en/content.json is generated from the data files' translatable fields, so the translator
// always works from the real English. Regenerate after editing content:
//   UPDATE_CONTENT=1 npx vitest run src/i18n/content.test.ts
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONTENT_REGISTRY } from './content';
import '../data/bots';
import '../data/botMechanics';
import '../data/story';
import '../data/openings';
import i18n, { language } from './index';
import { STORY_CHAPTERS } from '../data/story';

const FILE = join(__dirname, 'locales', 'en', 'content.json');

function nested() {
  const out: Record<string, unknown> = {};
  for (const [key, value] of [...CONTENT_REGISTRY.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const parts = key.split('.');
    let node = out;
    for (const part of parts.slice(0, -1)) node = (node[part] ??= {}) as Record<string, unknown>;
    node[parts.at(-1)!] = value;
  }
  return out;
}

test('locales/en/content.json matches the data files', () => {
  const expected = JSON.stringify(nested(), null, 1) + '\n';
  if (process.env.UPDATE_CONTENT) writeFileSync(FILE, expected, 'utf8');
  expect(readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n')).toBe(expected);
});

test('content follows the language, falling back to English', async () => {
  // A bundle with only the title translated, in place of the real Spanish one for this test.
  const real = i18n.getResourceBundle('es', 'content');
  i18n.removeResourceBundle('es', 'content');
  i18n.addResourceBundle('es', 'content', { story: { 'first-moves': { title: 'Primeros pasos' } } });
  try {
    language.set('es');
    expect(STORY_CHAPTERS[0].title).toBe('Primeros pasos');
    expect(STORY_CHAPTERS[0].tagline).toBe('Meet the pieces, learn the rules, and see how a game is won.');
    language.set('en');
    expect(STORY_CHAPTERS[0].title).toBe('First Moves');
  } finally {
    i18n.removeResourceBundle('es', 'content');
    if (real) i18n.addResourceBundle('es', 'content', real);
  }
});
