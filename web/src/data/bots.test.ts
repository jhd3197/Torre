import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_BOTS, BOT_ROSTER, botById, botForEngine, isPlayable, mergeEngineBots, inWindow, seasonRun, weekIndex, weeklyCollections } from './bots';
import { SEASON_ROWS } from './characters';
import { STORY_CHAPTERS } from './story';
import COLLECTIONS from './botCollections.json';
import { BOT_FIGURES } from './botFigures';
import { DIASPORA_ROWS } from './characters';
import { STOCKFISH, engineEntry } from '../test/harness';
import type { EngineInfo } from '../types';

const asEngine = (entry: Record<string, unknown>) => entry as unknown as EngineInfo;

test('every bot has a unique id', () => {
  const ids = ALL_BOTS.map(bot => bot.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('every character has a portrait, a place in the roster and its three lines', () => {
  const characters = ALL_BOTS.filter(bot => bot.avatar);
  expect(characters.length).toBeGreaterThan(200);
  for (const bot of characters) {
    // The images are on the art release, not in git: checked once they are fetched (.\dev.ps1 art fetch).
    if (existsSync(resolve(__dirname, '../../public/art'))) expect(existsSync(resolve(__dirname, '../../public', bot.avatar!)), bot.avatar).toBe(true);
    expect(bot.hello && bot.win && bot.lose, bot.name).toBeTruthy();
  }
  // Each character is always on, out this week, or under More bots: exactly one of the three.
  const placed = [...BOT_ROSTER.everyday, ...BOT_ROSTER.week, ...BOT_ROSTER.more];
  expect(placed).toHaveLength(characters.length);
  expect(new Set(placed).size).toBe(characters.length);
});

test('the always-on bots run from beginner to grandmaster and include every story boss', () => {
  // Rooky the coach leads the row; the characters after it climb in rating.
  expect(BOT_ROSTER.everyday[0].coach).toBe(true);
  const characters = BOT_ROSTER.everyday.slice(1);
  expect(characters).toHaveLength(24);
  expect(characters.filter(bot => bot.coach)).toEqual([]);
  expect(characters[0].elo).toBeLessThan(500);
  expect(characters.at(-1)!.elo).toBeGreaterThanOrEqual(2500);
  for (const chapter of STORY_CHAPTERS) expect(BOT_ROSTER.everyday.map(bot => bot.id), chapter.id).toContain(chapter.bossBotId);
});

test('each week brings a profession and a country of eight, in turn', () => {
  const monday = Date.UTC(2026, 9, 5);
  expect(weekIndex(monday - 1)).toBe(0);
  expect(weekIndex(monday + 7 * 864e5)).toBe(1);
  const first = weeklyCollections(monday);
  expect(first.map(group => group.id)).toEqual(['schoolyard', 'japan']);
  expect(first.map(group => group.bots.length)).toEqual([8, 9]);  // Japan's week ends with its Venezuelan
  expect(weeklyCollections(monday + 7 * 864e5).map(group => group.id)).toEqual(['outdoors', 'russia']);
  // Every country sheet fills a full week; once its figurine exists, the Venezuelan who lives there closes it.
  for (let week = 0; week < 11; week++) {
    const country = weeklyCollections(monday + week * 7 * 864e5)[1];
    const diaspora = DIASPORA_ROWS.find(([id, row]) => id === country.id && BOT_FIGURES.has(row[0]));
    expect(country.bots).toHaveLength(diaspora ? 9 : 8);
    if (diaspora) expect(country.bots.at(-1)!.name).toBe(diaspora[1][1]);
  }
});

test('at most one Venezuelan lives in each country collection, never in Venezuela itself', () => {
  // A neighbour may be drawn ahead of their country (`waitingCountries`); they join once it exists.
  const countries = new Set([...COLLECTIONS.countries.map(c => c.id).filter(id => !id.startsWith('venezuela')),
    ...((COLLECTIONS as { waitingCountries?: string[] }).waitingCountries ?? [])]);
  const ids = DIASPORA_ROWS.map(([id]) => id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const [id, row] of DIASPORA_ROWS) {
    expect(countries.has(id), id).toBe(true);
    expect(row[0]).toBe(`diaspora-${id}`);
  }
  // Every diaspora sheet cell names a country that has a Venezuelan written for it.
  for (const cells of Object.values(COLLECTIONS.diasporaSheets)) for (const id of cells) expect(ids, id).toContain(id);
});

test('Stockfish 18 and Leela map to registry engines', () => {
  expect(botById('sf18')?.engineId).toBe('stockfish');
  expect(botById('leela')?.engineId).toBe('lc0');
  expect(botById('random')?.engineId).toBeUndefined();
});

test('playability follows the registry, with Stockfish playable before it loads', () => {
  expect(isPlayable(botById('sf18')!)).toBe(true); // registry still loading
  expect(isPlayable(botById('sf18')!, [])).toBe(false);
  expect(isPlayable(botById('sf18')!, ['stockfish'])).toBe(true);
  expect(isPlayable(botById('leela')!)).toBe(false);
  expect(isPlayable(botById('leela')!, ['stockfish', 'lc0'])).toBe(true);
  expect(isPlayable(botById('random')!, ['stockfish'])).toBe(false); // stays a preview
  const granny = ALL_BOTS.find(bot => bot.avatar)!;
  expect(isPlayable(granny, [])).toBe(true); // characters need no engine
});

test('installed engines without a card join the engines category as playable bots', () => {
  const lc0 = asEngine(engineEntry('lc0', 'Leela Chess Zero', { type: 'neural' }));
  // lc0 has a card (leela), so nothing is synthesized for it; an unknown engine gets one.
  expect(mergeEngineBots([asEngine({ ...lc0, installed: true })])).toHaveLength(BOT_ROSTER.engines.length);
  const merged = mergeEngineBots([asEngine(engineEntry('berserk', 'Berserk', { installed: true }))]);
  const berserk = merged.find(bot => bot.id === 'engine-berserk');
  expect(berserk).toMatchObject({ name: 'Berserk', engineId: 'berserk', engine: true });
  expect(isPlayable(berserk!, ['berserk'])).toBe(true);
  // Engines that are not installed never appear.
  expect(mergeEngineBots([asEngine(engineEntry('reckless', 'Reckless'))])).toHaveLength(BOT_ROSTER.engines.length);
});

test('the Engine Lab Play button points at each engine\'s bot card', () => {
  expect(botForEngine(asEngine(STOCKFISH))).toBe('sf18');
  expect(botForEngine(asEngine(engineEntry('lc0', 'Leela Chess Zero')))).toBe('leela');
  expect(botForEngine(asEngine(engineEntry('berserk', 'Berserk')))).toBe('engine-berserk');
});

test('installed Maia models join the lobby as human-strength bots', () => {
  const maia = { id: 'maia-1500', name: 'Maia 1500', installed: true, rating_target: 1500, style: 'human' };
  const lc0 = asEngine(engineEntry('lc0', 'Leela Chess Zero', {
    installed: true, type: 'neural',
    models: [maia, { ...maia, id: 'maia-1900', name: 'Maia 1900', installed: false, rating_target: 1900 }],
  }));
  const merged = mergeEngineBots([lc0]);
  const bot = merged.find(b => b.id === 'model-lc0-maia-1500');
  expect(bot).toMatchObject({ name: 'Maia 1500', elo: 1500, engineId: 'lc0', modelId: 'maia-1500', engine: true });
  expect(isPlayable(bot!, ['lc0'])).toBe(true);
  // A model that is not installed gets no card.
  expect(merged.some(b => b.id === 'model-lc0-maia-1900')).toBe(false);
  // Nor does any model while its engine is missing.
  expect(mergeEngineBots([asEngine({ ...lc0, installed: false })]).some(b => b.modelId)).toBe(false);
});

test('an event run is the one on now, or else the next, ending at midnight after its last day', () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime();
  expect(seasonRun({ from: '10-20', to: '10-31' }, at(2026, 10, 25))).toEqual({ start: at(2026, 10, 20, 0), end: at(2026, 11, 1, 0), on: true });
  expect(seasonRun({ from: '10-20', to: '10-31' }, at(2026, 11, 2))).toEqual({ start: at(2027, 10, 20, 0), end: at(2027, 11, 1, 0), on: false });
  // Across New Year: on Jan 2 the run started the December before.
  expect(seasonRun({ from: '12-27', to: '01-03' }, at(2027, 1, 2))).toEqual({ start: at(2026, 12, 27, 0), end: at(2027, 1, 4, 0), on: true });
});

test('festival windows repeat every year, including across New Year', () => {
  const on = (m: number, d: number) => new Date(2026, m - 1, d, 12).getTime();
  expect(inWindow('10-20', '10-31', on(10, 25))).toBe(true);
  expect(inWindow('10-20', '10-31', on(11, 1))).toBe(false);
  expect(inWindow('12-28', '01-05', on(1, 3))).toBe(true);
  expect(inWindow('12-28', '01-05', on(12, 30))).toBe(true);
  expect(inWindow('12-28', '01-05', on(6, 1))).toBe(false);
});

test('a festival has four bots (plus any specials) or none (outfits only), each sheet cell names a real bot', () => {
  for (const season of COLLECTIONS.seasons) expect(SEASON_ROWS.filter(([id]) => id === season.id).length, season.id).not.toBeOneOf([1, 2, 3]);
  const keys = new Set(SEASON_ROWS.map(([, row]) => row[0]));
  for (const cells of Object.values(COLLECTIONS.seasonSheets)) for (const key of cells) expect(keys.has(key), key).toBe(true);
});
