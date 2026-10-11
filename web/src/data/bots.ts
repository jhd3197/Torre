// The bot roster. Character bots and Stockfish 18 (sf18) are always playable; engines
// become playable when /api/engines reports them installed (see mergeEngineBots).
import { BOT_FIGURES } from './botFigures';
import { BOT_OUTFITS } from './botOutfits';
import COLLECTIONS from './botCollections.json';
import { CHARACTER_ROWS, DIASPORA_ROWS, SEASON_ROWS } from './characters';
import { translatable, translatableRecord } from '../i18n/content';
import { HISTORY_NAMES, historyArt } from '../lib/art';
import { byHistory, legendFigure } from './legends';
import type { EngineInfo, EngineModel, MasterInfo } from '../types';

export type BotCategory = 'everyday' | 'week' | 'legends' | 'engines' | 'more' | 'yours' | 'seasonal';

export interface Bot {
  id: string;
  icon: string;
  name: string;
  elo: number;
  kind: string;
  desc: string;
  tags: string[];
  /** Aggression, accuracy, endgame, in percent. */
  style: [number, number, number];
  record: string;
  source?: string;
  season?: string;
  /** The event whose outfit an always-on bot is wearing (botCollections.json `seasons`). */
  outfit?: string;
  /** In an event where the outfit is a character of its own (El Silbón), the regular underneath. */
  regular?: string;
  /** That character's id (the slug of its name, 'el-silbo-n'): its mechanics and voice go by it. */
  costumeId?: string;
  locked?: string;
  engine?: boolean;
  /** The registry engine that plays the moves (engines.py id); Stockfish when absent. */
  engineId?: string;
  /** A model running on that engine (Maia on Lc0); its weights are the bot's strength. */
  modelId?: string;
  /** Search this many nodes per move instead of a fixed movetime: a smoother strength curve
   *  than Skill Level (see lib/nodeStrength for approximate ratings). */
  nodes?: number;
  /** Portrait, for character bots. */
  avatar?: string;
  /** A legend (masters.py id): opens with the moves they played in their own games. */
  masterId?: string;
  /** The legend's record and ratings, for the lobby's detail panel. */
  master?: MasterInfo;
  /** An emblem shown like a portrait (legends), without making the bot a character. */
  portrait?: string;
  /** The coach (Rooky): plays near your rating and coaches you through the game. */
  coach?: boolean;
  /** Lines: at the start, when it beats you, when you beat it. */
  hello?: string;
  win?: string;
  lose?: string;
}

/** The words of a bot that follow the reader's language (names stay as they are). */
const BOT_TEXT: (keyof Bot & string)[] = ['kind', 'desc', 'tags', 'hello', 'win', 'lose', 'source', 'season', 'locked'];

const slug = (name: string) => name.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Events: festivals and holidays on a yearly "MM-DD" window (botCollections.json `seasons`). During
 * one, the always-on bots that have its outfit wear it everywhere (art/bots/seasonal/<event>/, cut by
 * the seasonal art stage), and the festival's own bots come out. Moving holidays get their dates
 * nudged each year.
 */
export interface Season {
  id: string; title: string; country?: string; from: string; to: string; theme: string;
  /** Regulars who dress up as a character with a name and an opening line of their own, by bot name. */
  costumes?: Record<string, { name: string; hello: string }>;
}
const SEASONS: Season[] = (COLLECTIONS as { seasons?: Season[] }).seasons ?? [];
const DAY = 24 * 3600 * 1000;
const monthDay = (text: string) => { const [m, d] = text.split('-').map(Number); return m * 100 + d; };

/** The run of a yearly window that is on at `now`, or else the next one: local midnight to midnight. */
export function seasonRun(season: Pick<Season, 'from' | 'to'>, now = Date.now()) {
  const [fromMonth, fromDay] = season.from.split('-').map(Number);
  const [toMonth, toDay] = season.to.split('-').map(Number);
  const crosses = monthDay(season.to) < monthDay(season.from);
  for (let year = new Date(now).getFullYear() - 1; ; year++) {
    const start = new Date(year, fromMonth - 1, fromDay).getTime();
    const end = new Date(crosses ? year + 1 : year, toMonth - 1, toDay + 1).getTime();
    if (now < end) return { start, end, on: now >= start };
  }
}

/**
 * The outfit each always-on bot wears at `now`, by avatar key. When two events overlap, the one that
 * started last wins; a bot with two outfits for an event changes between them day by day.
 */
function outfitsOn(now: number) {
  const worn = new Map<string, { event: string; avatar: string; since: number }>();
  for (const season of SEASONS) {
    const run = seasonRun(season, now);
    if (!run.on) continue;
    for (const [key, count] of Object.entries(BOT_OUTFITS[season.id] ?? {})) {
      if ((worn.get(key)?.since ?? -Infinity) >= run.start) continue;
      worn.set(key, { event: season.id, avatar: outfitPath(season.id, key, Math.floor((now - run.start) / DAY) % count), since: run.start });
    }
  }
  return worn;
}
const outfitPath = (event: string, key: string, variant = 0) => `art/bots/seasonal/${event}/${key}${variant ? '-alt' : ''}.webp`;
const WORN = outfitsOn(Date.now());

type CharacterRow = (typeof CHARACTER_ROWS)[number];
const character = ([avatar, name, elo, kind, desc, tags, style, hello, win, lose]: CharacterRow): Bot => translatable({
  id: slug(name), icon: '', name, elo, kind, desc, tags: [...tags], style, record: '–',
  avatar: WORN.get(avatar)?.avatar ?? (BOT_FIGURES.has(avatar) ? `art/bots/${avatar}.webp` : `art/avatars/${avatar}.webp`), hello, win, lose,
  ...(WORN.has(avatar) ? { outfit: WORN.get(avatar)!.event } : {}),
} as Bot, `bots.${slug(name).replace(/\./g, '_')}`, BOT_TEXT);
/** Each character bot's avatar key, by bot id: where its outfits live. */
const KEY_OF = new Map(CHARACTER_ROWS.map(row => [slug(row[1]), row[0]]));
/**
 * The Venezuelan who closes each country's collection, by country. All are built, so their text is
 * always registered for translation; only those with a figurine join.
 */
const DIASPORA = new Map(DIASPORA_ROWS.map(([country, row]) => [country, character(row), BOT_FIGURES.has(row[0])] as const)
  .filter(([, , made]) => made).map(([country, bot]) => [country, bot]));
const CHARACTERS: Bot[] = [...CHARACTER_ROWS.map(character), ...DIASPORA.values()];

/**
 * Festival bots: a festival's own characters come out during its window each year (art/prompts/bots.md),
 * then wait for next year. Like the diaspora, a bot needs its figurine before it appears.
 */
const SEASON_BOTS = new Map<string, Bot[]>();
for (const [season, row] of SEASON_ROWS) {
  const bot = character(row);  // built either way, so its text is registered for translation
  if (BOT_FIGURES.has(row[0])) SEASON_BOTS.set(season, [...(SEASON_BOTS.get(season) ?? []), bot]);
}
const SEASON_TITLES: Record<string, string> = translatableRecord(Object.fromEntries(SEASONS.map(s => [s.id, s.title])), 'botSeasons');

/** Whether a date falls in a yearly "MM-DD" window; a window may cross New Year ("12-28" to "01-05"). */
export function inWindow(from: string, to: string, now = Date.now()) {
  const date = new Date(now);
  const today = (date.getMonth() + 1) * 100 + date.getDate();
  const start = monthDay(from), end = monthDay(to);
  return start <= end ? today >= start && today <= end : today >= start || today <= end;
}

/** An event as the lobby shows it: its bots, and when this run of it starts and ends (the next run, when it is off). */
export interface SeasonGroup { id: string; title: string; theme: string; start: number; end: number; on: boolean; bots: Bot[] }

const byElo = (a: Bot, b: Bot) => a.elo - b.elo;
const seasonGroup = (season: Season, now: number, bots: Bot[]): SeasonGroup =>
  ({ id: season.id, title: SEASON_TITLES[season.id], theme: season.theme, ...seasonRun(season, now), bots });

/** Costumes that are characters of their own: the name stays a name, the opening line follows the language. */
const COSTUMES = new Map(SEASONS.flatMap(season => Object.entries(season.costumes ?? {}).map(([name, costume]) =>
  [`${season.id}/${name}`, translatable({ ...costume }, `botCostumes.${season.id}.${slug(name)}`, ['hello'])] as const)));

/** A regular in an event's outfit: the outfit worn today while the event is on, else its first. */
function dressed(bot: Bot, event: string, worn: ReturnType<typeof outfitsOn>) {
  const key = KEY_OF.get(bot.id)!;
  const today = worn.get(key);
  const copy = Object.assign(Object.create(bot) as Bot, { avatar: today?.event === event ? today.avatar : outfitPath(event, key), outfit: event });
  const costume = COSTUMES.get(`${event}/${bot.name}`);
  return costume ? wear(copy, bot.name, costume) : copy;
}

/** A regular as the character it dresses up as: the character's name, id and opening line. */
function wear(copy: Bot, regular: string, costume: { name: string; hello: string }) {
  Object.assign(copy, { regular, name: costume.name, costumeId: slug(costume.name) });
  // A getter, so the opening line follows the reader's language.
  Object.defineProperty(copy, 'hello', { get: () => costume.hello, enumerable: true });
  return copy;
}

/**
 * A regular in the costume a game was started in (the game keeps the character's name): its name,
 * opening line and id, so the game page and the bot's mechanics know who is playing. When no event
 * dresses the bot as `name`, only the name changes.
 */
export function inCostume(bot: Bot, name: string, avatar?: string): Bot {
  const regular = bot.regular ?? bot.name;
  const costume = [...COSTUMES].find(([key, c]) => key.endsWith(`/${regular}`) && c.name === name)?.[1];
  const copy = Object.assign(Object.create(bot) as Bot, avatar ? { avatar } : {});
  return costume ? wear(copy, regular, costume) : Object.assign(copy, { name });
}

/**
 * Every event with something to show, in calendar order from the next to end: the regulars in its
 * outfits and its festival bots with figurines. Off events carry their next run.
 */
export function eventCollections(now = Date.now()): SeasonGroup[] {
  const worn = outfitsOn(now);
  return SEASONS.map(season => seasonGroup(season, now, [
    ...EVERYDAY.filter(bot => BOT_OUTFITS[season.id]?.[KEY_OF.get(bot.id) ?? '']).map(bot => dressed(bot, season.id, worn)),
    ...(SEASON_BOTS.get(season.id) ?? []),
  ].sort(byElo))).filter(group => group.bots.length).sort((a, b) => a.end - b.end);
}

/** The events on at `now`, ending soonest first: the regulars wearing each one's outfit, and its festival bots. */
export function activeSeasons(now = Date.now()) {
  const worn = outfitsOn(now);
  return SEASONS.filter(season => seasonRun(season, now).on)
    .map(season => seasonGroup(season, now, [...EVERYDAY.filter(bot => worn.get(KEY_OF.get(bot.id) ?? '')?.event === season.id),
      ...(SEASON_BOTS.get(season.id) ?? [])].sort(byElo)))
    .filter(season => season.bots.length).sort((a, b) => a.end - b.end);
}

/**
 * The roster's shape (art/prompts/bots.md): 24 bots are always on, two collections of 8 rotate in
 * each week (a profession and a country), and the rest wait under More bots, still found by search.
 */
const WEEK_ZERO = Date.UTC(2026, 9, 5);  // a Monday: the first week of the schedule
const WEEK = 7 * 24 * 3600 * 1000;
export const weekIndex = (now = Date.now()) => Math.max(0, Math.floor((now - WEEK_ZERO) / WEEK));

const byName = new Map(CHARACTERS.map(bot => [bot.name, bot]));
const named = (names: string[]) => names.map(name => byName.get(name)).filter((bot): bot is Bot => !!bot);
/** A country's collection: its sheet by rating, then the Venezuelan who made a home there. */
const ofSheet = (sheet: string) => [...CHARACTERS.filter(bot => bot.avatar?.match(/\/([\w-]+)-\d+\.webp$/)?.[1] === sheet)
  .sort((a, b) => a.elo - b.elo), ...(DIASPORA.has(sheet) ? [DIASPORA.get(sheet)!] : [])];

export const COLLECTION_TITLES: Record<string, string> = translatableRecord(Object.fromEntries(
  [...COLLECTIONS.weekly, ...COLLECTIONS.countries].map(group => [group.id, group.title])), 'botCollections');

/** This week's two collections: a profession and a country, in turn. */
export function weeklyCollections(now = Date.now()) {
  const n = weekIndex(now);
  const profession = COLLECTIONS.weekly[n % COLLECTIONS.weekly.length];
  const country = COLLECTIONS.countries[n % COLLECTIONS.countries.length];
  return [
    { id: profession.id, title: COLLECTION_TITLES[profession.id], bots: named(profession.bots).sort((a, b) => a.elo - b.elo) },
    { id: country.id, title: COLLECTION_TITLES[country.id], bots: ofSheet(country.id) },
  ];
}

/** Every character collection: the themed groups and the countries (each closed by its Venezuelan neighbour). */
export function characterCollections() {
  return {
    themes: COLLECTIONS.weekly.map(group => ({ id: group.id, title: COLLECTION_TITLES[group.id], bots: named(group.bots).sort(byElo) })),
    countries: COLLECTIONS.countries.map(country => ({ id: country.id, title: COLLECTION_TITLES[country.id], bots: ofSheet(country.id), neighbour: DIASPORA.get(country.id) })),
  };
}

/** Rooky, the one coach: plays at about your rating (set when the game starts, never changed during
 *  it) and talks you through the game: hints when you ask, what the other side threatens, a word
 *  before a mistake, take-backs. Its games are practice: no stars. */
export const COACH_BOT: Bot = translatable({
  id: 'coach-rooky', icon: '♜', name: 'Rooky', elo: 900, kind: 'your coach · plays at your level', coach: true,
  desc: 'Plays at about your rating and talks you through the game: a hint when you ask, what your opponent threatens, and a word before a mistake. You can take moves back.',
  tags: ['coach', 'hints', 'take-backs'], style: [45, 60, 55], record: '–', avatar: 'art/mascot/host.webp',
  hello: 'Let us play one together. I will speak up when something matters.',
  win: 'Good game. Want to look at the moment it turned?', lose: 'You beat your coach! That is the whole idea.',
} as Bot, 'bots.coach-rooky', BOT_TEXT);

/** The rating Rooky plays at: yours (from your games), rounded, within what a bot can play. */
export const coachRating = (rating: number | null) => Math.max(400, Math.min(2400, Math.round((rating ?? 900) / 50) * 50));

const EVERYDAY = [COACH_BOT, ...named(COLLECTIONS.core.flatMap(group => group.bots)).sort((a, b) => a.elo - b.elo)];
const THIS_WEEK = weeklyCollections().flatMap(group => group.bots);
const MORE = CHARACTERS.filter(bot => !EVERYDAY.includes(bot) && !THIS_WEEK.includes(bot)).sort((a, b) => a.elo - b.elo);

const ROSTER: Record<string, Bot[]> = {yours:[
    { id: 'v2026.09', icon: '\u265B', name: 'Present You', elo: 1612, kind: 'snapshot · Sep 2026',
      desc: 'Your current habits mirrored back. Solid until the clock drops under a minute.',
      tags: ['clock trouble', 'drifts'], style: [40, 62, 48], record: '5\u20136\u20131', source: '727 of your games',
      portrait: 'art/yours/present-you.webp' },
    { id: 'v2025.01', icon: '\u265E', name: 'Reckless Attacker', elo: 1487, kind: 'snapshot · Jan 2025',
      desc: 'Sacrifices on h7 without counting defenders. Sharp, fast, occasionally brilliant.',
      tags: ['loves h7 sacs', 'weak endings'], style: [88, 46, 30], record: '11\u20138\u20133', source: '512 of your games',
      portrait: 'art/yours/reckless-attacker.webp' },
    { id: 'v2024.02', icon: '\u265D', name: 'The Trader', elo: 1318, kind: 'snapshot · Feb 2024',
      desc: 'Takes every trade on offer and simplifies straight out of good positions.',
      tags: ['trades early', 'passive'], style: [24, 40, 52], record: '14\u20134\u20132', source: '389 of your games',
      portrait: 'art/yours/the-trader.webp' },
    { id: 'v2023.06', icon: '\u265F', name: 'Opening Tourist', elo: 1141, kind: 'snapshot · Jun 2023',
      desc: 'Four moves of theory, then pure improvisation. Leaves pieces where they land.',
      tags: ['hangs pieces', 'no plan'], style: [55, 22, 18], record: '9\u20131\u20130', source: '214 of your games',
      portrait: 'art/yours/opening-tourist.webp' }
  ],seasonal:[
  ],engines:[
    { id: 'sf18', icon: '\u265B', name: 'Stockfish 18', elo: 1400, kind: 'engine · handicapped',
      desc: 'Current release with a level cap. Clean strength test, no personality, no commentary.',
      tags: ['reference', 'no chat'], style: [50, 100, 100], record: '1\u20139\u20132', engine: true, engineId: 'stockfish',
      portrait: 'art/engines/sf18.webp' },
    { id: 'sf11', icon: '\u265C', name: 'Stockfish 11', elo: 2680, kind: 'engine · 2019 build',
      desc: 'The pre-neural version. Materialistic, brutal in tactics, beatable positionally.',
      tags: ['classical eval', 'tactical'], style: [70, 96, 88], record: '0\u20134\u20130', portrait: 'art/engines/sf11.webp' },
    { id: 'leela', icon: '\u265D', name: 'Leela Zero', elo: 2610, kind: 'engine · policy net',
      desc: 'Neural net that plays like a very strong human. Long plans, quiet sacrifices.',
      tags: ['human-like', 'positional'], style: [62, 94, 96], record: '0\u20132\u20131', engine: true, engineId: 'lc0',
      portrait: 'art/engines/leela.webp' },
    { id: 'random', icon: '\u265F', name: 'Random Mover', elo: 180, kind: 'engine · warm-up',
      desc: 'Picks a legal move at random. Useful for testing a new opening line safely.',
      tags: ['warm-up', 'harmless'], style: [50, 0, 0], record: '22\u20130\u20130', portrait: 'art/engines/random.webp' }
  ]};

for (const bots of Object.values(ROSTER)) for (const bot of bots) translatable(bot, `bots.${bot.id.replace(/\./g, '_')}`, BOT_TEXT);

export const BOT_ROSTER: Record<BotCategory, Bot[]> = {
  everyday: EVERYDAY, week: THIS_WEEK, legends: [], engines: ROSTER.engines, more: MORE, yours: ROSTER.yours,
  // Only the festivals' own characters: the regulars in costume are already under everyday.
  seasonal: activeSeasons().flatMap(season => season.bots).filter(bot => !EVERYDAY.includes(bot)),
};

export const CATEGORY_TITLES: Record<BotCategory, string> = translatableRecord({
  everyday: 'Always here', week: 'Bots of the week', legends: 'Legends', engines: 'Engines', more: 'More bots',
  yours: 'Your bots', seasonal: 'Seasonal',
}, 'botCategories.titles');
export const ALL_BOTS = Object.values(BOT_ROSTER).flat();

export const botById = (id: string) => ALL_BOTS.find(bot => bot.id === id);

/**
 * A bot's figure: its own, or for one without (an engine added by path, a model, a new kind of bot)
 * one of the eight robots (art/robots/), always the same robot for the same bot.
 */
export function botPicture(bot: Bot): string {
  return bot.avatar ?? bot.portrait ?? robotFor(bot.id);
}

/** One of the eight robots for anything without a figure, always the same one for the same id. */
export function robotFor(id: string): string {
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `art/robots/robot-${hash % 8 + 1}.webp`;
}

/** The figure for an engine seat: Stockfish, Leela, Maia and the random mover have their own. */
export function engineFigure(engineId: string, modelId?: string | null): string {
  if (modelId?.startsWith('maia')) return 'art/engines/maia.webp';
  return ({ stockfish: 'art/engines/sf18.webp', lc0: 'art/engines/leela.webp', random: 'art/engines/random.webp' } as Record<string, string>)[engineId]
    ?? robotFor(`engine-${engineId}`);
}

/**
 * Character bots are always playable; an engine bot is playable when its engine is
 * installed. Without the registry's `installed` ids (still loading), Stockfish keeps
 * its old behavior and stays playable.
 */
export const isPlayable = (bot: Bot, installed?: readonly string[]) =>
  !!bot.avatar || (bot.masterId ? (installed ? installed.includes('stockfish') : true) : false) || (bot.engineId ? (installed ? installed.includes(bot.engineId) : bot.engineId === 'stockfish') : false);

/** A bot for an installed engine that has no card of its own yet. */
function engineBot(engine: EngineInfo): Bot {
  return {
    id: `engine-${engine.id}`, icon: engine.type === 'neural' ? '♝' : '♞', name: engine.name,
    elo: engine.strength_ccrl ?? 0, kind: `engine · ${engine.type}`, desc: engine.description,
    tags: [engine.type, engine.license], style: [50, 90, 90], record: '–', engine: true, engineId: engine.id,
  };
}

/** A bot for an installed model: human-trained weights at a human rating. */
function modelBot(engine: EngineInfo, model: EngineModel): Bot {
  return {
    id: `model-${engine.id}-${model.id}`, icon: '♟', name: model.name, elo: model.rating_target ?? 0,
    kind: `${engine.name} · human-like`,
    desc: `A neural net trained on human games at this level: it plays like a ${model.rating_target} human, mistakes included. Runs on ${engine.name}.`,
    tags: ['human-like', model.style ?? 'neural'], style: [50, 70, 60], record: '–',
    engine: true, engineId: engine.id, modelId: model.id,
    portrait: model.id.startsWith('maia') ? 'art/engines/maia.webp' : undefined,
  };
}

/**
 * The engines category, driven by the registry: the static cards keep their flavor
 * text, every installed engine without one joins as a playable bot, and so does
 * every installed model (the Maia bots).
 */
export function mergeEngineBots(engines: EngineInfo[]): Bot[] {
  const mapped = new Set(BOT_ROSTER.engines.map(bot => bot.engineId));
  const merged = [...BOT_ROSTER.engines, ...engines.filter(engine => engine.installed && !mapped.has(engine.id)).map(engineBot)];
  for (const engine of engines) {
    if (!engine.installed) continue;
    for (const model of engine.models ?? []) {
      if (model.installed) merged.push(modelBot(engine, model));
    }
  }
  return merged;
}

/** The bot card that plays with a registry engine, for the Engine Lab's Play button. */
export function botForEngine(engine: EngineInfo): string {
  return BOT_ROSTER.engines.find(bot => bot.engineId === engine.id)?.id ?? `engine-${engine.id}`;
}

/** A legend's figurine, or the history lessons' emblem for a master downloaded by hand ('PolgarJ' -> polgar). */
function legendArt(masterId: string): string | undefined {
  const name = masterId.toLowerCase().replace(/j$/, '');
  return legendFigure(masterId) ?? ((HISTORY_NAMES as readonly string[]).includes(name) ? historyArt(name) : undefined);
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * A bot for every master whose games are on disk (GET /api/masters): it plays the moves
 * they chose in their own games while it can, then Stockfish at their peak rating.
 * `t` is the play namespace's translator, so the card text follows the language.
 */
export function legendBots(masters: MasterInfo[], t: Translate): Bot[] {
  return [...masters].sort((a, b) => byHistory(a.id, b.id)).map(master => ({
    id: `legend-${master.id}`, icon: '♚', name: master.name, elo: master.elo,
    kind: t('legend.kind', { count: master.games, games: master.games.toLocaleString() }),
    desc: t(master.rated ? 'legend.desc' : 'legend.descUnrated', { name: master.name, elo: master.elo }),
    tags: [...(master.years ? [master.years[0] === master.years[1] ? `${master.years[0]}` : `${master.years[0]}–${master.years[1]}`] : []),
      master.peak ? t('legend.peak', { elo: master.peak }) : t('legend.preRating')],
    style: [50, 50, 50], record: '–', masterId: master.id, master, portrait: legendArt(master.id),
  }));
}
