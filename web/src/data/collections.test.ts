import { BOT_ROSTER, inCostume } from './bots';
import { mechanicsFor } from './botMechanics';
import { botCollections, collectionOf, eventLadder, lockOf, moveOf, type BotCollection } from './collections';
import { keepEventBot, loadEvents } from '../lib/events';

const [granny, tom] = BOT_ROSTER.everyday.filter(bot => ['granny-rose', 'old-tom'].includes(bot.id));
const event = (status: BotCollection['status']): BotCollection =>
  ({ id: 'halloween', kind: 'season', title: 'Halloween', bots: [granny, tom], status, start: 0, end: 1, need: 1 });

beforeEach(() => localStorage.clear());

test('every country is its own collection, flagged, and every always-on bot has a home outside the events', () => {
  const collections = botCollections();
  const countries = collections.filter(c => c.kind === 'country');
  expect(countries.length).toBeGreaterThanOrEqual(20);
  for (const country of countries) expect(country.flag?.length, country.id).toBeGreaterThan(0);
  for (const bot of BOT_ROSTER.everyday) expect(collectionOf(collections, bot.id)?.kind, bot.id).not.toBe('season');
});

test('event bots: open while it is on, locked before it starts, and after it ends only the ones you beat', () => {
  expect(lockOf(event('live'), granny)).toBeNull();
  expect(lockOf(event('soon'), granny)).toBe('soon');
  expect(lockOf(event('later'), granny)).toBe('soon');
  expect(lockOf(event('ended'), granny)).toBe('ended');
  keepEventBot('halloween', granny.id, 2);
  expect(lockOf(event('ended'), granny)).toBeNull();
  expect(lockOf(event('ended'), tom)).toBe('ended');
  // Collections outside the events never lock.
  expect(lockOf({ ...event('ended'), kind: 'core' }, tom)).toBeNull();
});

test('beating enough of an event\'s bots earns its crest, once a year', () => {
  const now = new Date(2026, 9, 25).getTime();
  expect(keepEventBot('halloween', 'a', 2, now)).toEqual({ kept: true, crest: false, count: 1 });
  expect(keepEventBot('halloween', 'a', 2, now)).toEqual({ kept: false, crest: false, count: 1 });
  expect(keepEventBot('halloween', 'b', 2, now)).toEqual({ kept: true, crest: true, count: 2 });
  expect(keepEventBot('halloween', 'c', 2, now).crest).toBe(false);
  expect(loadEvents().crests).toEqual({ halloween: [2026] });
});

test('Venezuela is one page, home and abroad; a Venezuelan abroad is on it and on their new country, nowhere else', () => {
  const collections = botCollections();
  const venezuela = collections.find(c => c.id === 'venezuela')!;
  expect(collections.some(c => c.id.startsWith('venezuela-'))).toBe(false);
  expect(venezuela.abroad?.length).toBeGreaterThan(0);
  for (const id of venezuela.abroad!) {
    const pages = collections.filter(c => c.kind !== 'season' && c.bots.some(b => b.id === id)).map(c => c.id);
    expect(pages, id).toHaveLength(2);
    expect(collectionOf(collections, id)?.movedHere, id).toContain(id);
  }
  const leo = venezuela.bots.find(b => b.name === 'Leonardo Arismendi')!;
  expect(moveOf(leo)).toEqual({ from: 'Valencia', to: 'Berlin' });
  // One of the home crowd who moved: abroad on Venezuela's page, and in the United States beside its neighbour.
  expect(venezuela.abroad).toContain('juan-denis');
  expect(collections.find(c => c.id === 'usa')?.movedHere).toEqual(['juan-denis']);
  // A neighbour with no move stays home: on Venezuela's page only, not abroad.
  expect(venezuela.bots.some(b => b.id === 'oriana-castillo')).toBe(true);
  expect(venezuela.abroad).not.toContain('oriana-castillo');
  expect(collections.find(c => c.id === 'usa')?.bots.some(b => b.id === 'oriana-castillo')).toBe(false);
});

test('event bots play on a ladder around your rating, easiest first, and keep their own rating elsewhere', () => {
  const masters = BOT_ROSTER.everyday.filter(bot => bot.elo >= 1500).slice(0, 8);
  const ladder = eventLadder(masters, 756);
  expect(ladder.map(bot => bot.elo)).toEqual([410, 510, 610, 710, 810, 910, 1010, 1110]);
  expect(ladder[0].name).toBe(masters[0].name);
  expect(masters[0].elo).toBeGreaterThanOrEqual(1500);
  // No rating yet: a ladder for a new player; never below the weakest bot's floor.
  expect(eventLadder(masters, null)[0].elo).toBe(600);
  expect(eventLadder(masters, 400)[0].elo).toBe(300);
});

test('in Venezuelan legends the regulars go by their legend: El Silbón, La Sayona…', () => {
  const leyendas = botCollections().find(c => c.id === 'leyendas')!;
  const silbon = leyendas.bots.find(bot => bot.regular === 'Iron Wall Ivo')!;
  expect(silbon.name).toBe('El Silbón');
  expect(silbon.hello).toMatch(/Fi-fi-fi/);
  expect(leyendas.bots.map(bot => bot.name)).toContain('La Sayona');
  // Everywhere else, Ivo is still Ivo.
  expect(BOT_ROSTER.everyday.find(bot => bot.id === silbon.id)?.name).toBe('Iron Wall Ivo');
  // The costume is a character of its own: its mechanics go by its id.
  expect(silbon.costumeId).toBe('el-silbo-n');
  expect(mechanicsFor(silbon.costumeId)?.ambience).toBe('night');
});

test('a game started in costume finds the character again from the regular and the name it kept', () => {
  const ivo = BOT_ROSTER.everyday.find(bot => bot.name === 'Iron Wall Ivo')!;
  const silbon = inCostume(ivo, 'El Silbón', 'art/bots/seasonal/leyendas/08-6.webp');
  expect(silbon).toMatchObject({ id: 'iron-wall-ivo', name: 'El Silbón', regular: 'Iron Wall Ivo', costumeId: 'el-silbo-n',
    avatar: 'art/bots/seasonal/leyendas/08-6.webp' });
  expect(silbon.hello).toMatch(/Fi-fi-fi/);
  expect(ivo.name).toBe('Iron Wall Ivo');
});
