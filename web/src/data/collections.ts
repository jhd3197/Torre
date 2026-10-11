// The bot lobby's collections (/play/bots and /play/bots/:id): seasonal events, countries, themed
// groups, and the always-on sets (the regulars, legends, engines, your bots). Every bot lives in one.
import { BOT_ROSTER, CATEGORY_TITLES, characterCollections, eventCollections, type Bot, type SeasonGroup } from './bots';
import { isKept, loadEvents, type EventProgress } from '../lib/events';

export type CollectionKind = 'season' | 'country' | 'theme' | 'core';
/** On now; starting within weeks; over (its bots you beat stay); or further off. */
export type EventStatus = 'live' | 'soon' | 'ended' | 'later';

export interface BotCollection {
  id: string;
  kind: CollectionKind;
  title: string;
  bots: Bot[];
  /** Countries: the flag, as an ISO country code. */
  flag?: string;
  /** Countries: the Venezuelan who made a home there (the last of `bots`). */
  neighbour?: Bot;
  /** Venezuela: the ids of its people who moved abroad (also on their new country's page). */
  abroad?: string[];
  /** Countries: the ids of the Venezuelans who live here now (the neighbour, and any who moved from home). */
  movedHere?: string[];
  /** Events: the colour theme, whether it is on, and its run (or the next one). */
  theme?: string;
  status?: EventStatus;
  start?: number;
  end?: number;
  /** Events: how many bots to beat during it for its crest. */
  need?: number;
}

/** An event shows as coming soon this many days before it starts; earlier it shows as ended. */
const SOON_DAYS = 45;
const DAY = 24 * 3600 * 1000;
/** Events began here: an event whose last run ended before this never ran in the app, so it is coming, not over. */
const EVENTS_BEGAN = new Date(2026, 9, 1).getTime();

/** Each country's flag, as its ISO code (components/bots/Flag draws it). The groupings without a flag
 *  of their own fly the one of the place their Venezuelan neighbour lives. */
const FLAGS: Record<string, string> = {
  albania: 'AL', arabia: 'AE', argentina: 'AR', brazil: 'BR', canada: 'CA', chile: 'CL', china: 'CN', colombia: 'CO',
  'el-salvador': 'SV', france: 'FR', germany: 'DE', hawaii: 'US', hungary: 'HU', india: 'IN', japan: 'JP', korea: 'KR',
  mexico: 'MX', nordic: 'NO', russia: 'RU', serbia: 'RS', spain: 'ES', sweden: 'SE', turkey: 'TR', ukraine: 'UA', usa: 'US',
  peru: 'PE', italy: 'IT', armenia: 'AM', netherlands: 'NL', philippines: 'PH', panama: 'PA', portugal: 'PT',
};
export const VENEZUELA_FLAG = 'VE';
const flagOf = (id: string) => FLAGS[id];

/**
 * The countries, with Venezuela's two sheets as one page: the people at home, then every Venezuelan
 * who moved abroad. Those neighbours are the only bots on two pages: home, and where they live now.
 */
function countriesWithVenezuela(countries: ReturnType<typeof characterCollections>['countries']): BotCollection[] {
  const home = countries.filter(c => c.id.startsWith('venezuela'));
  // A neighbour whose description names no move stays home, so a country can wait for someone else.
  const moved = (bot?: Bot): bot is Bot => !!bot && !!moveOf(bot);
  const stayed: Bot[] = countries.flatMap(c => c.neighbour && !moved(c.neighbour) ? [c.neighbour] : []);
  const people = [...home.flatMap(c => c.bots), ...stayed];
  // Anyone at home whose description has a move lives abroad, in the country of their city.
  const cityOf = new Map<string, string>([...Object.entries(CITY_COUNTRY),
    ...countries.flatMap(c => moved(c.neighbour) ? [[moveOf(c.neighbour)!.to, c.id] as [string, string]] : [])]);
  const movedOut = people.filter(bot => cityOf.has(moveOf(bot)?.to ?? ''));
  const abroad = [...countries.flatMap(c => moved(c.neighbour) ? [c.neighbour] : []), ...movedOut];
  const venezuela: BotCollection = { id: 'venezuela', kind: 'country', title: home[0]?.title ?? 'Venezuela', flag: VENEZUELA_FLAG,
    bots: [...people.filter(bot => !movedOut.includes(bot)), ...abroad], abroad: abroad.map(bot => bot.id) };
  return countries.flatMap((country): BotCollection[] => {
    if (country.id === home[0]?.id) return [venezuela];
    if (country.id.startsWith('venezuela')) return [];
    const arrived = movedOut.filter(bot => cityOf.get(moveOf(bot)!.to) === country.id);
    const here = [...(moved(country.neighbour) ? [country.neighbour] : []), ...arrived];
    return [{ ...country, kind: 'country', flag: flagOf(country.id), neighbour: here[0],
      bots: [...country.bots.filter(bot => !stayed.includes(bot)), ...arrived], movedHere: here.map(bot => bot.id) }];
  });
}

/** The country of a city someone at home moved to, where no neighbour there names it yet. */
const CITY_COUNTRY: Record<string, string> = { Miami: 'usa' };

function statusOf(group: SeasonGroup, now: number): EventStatus {
  if (group.on) return 'live';
  if (group.start - now <= SOON_DAYS * DAY) return 'soon';
  const lastEnd = new Date(group.end);
  lastEnd.setFullYear(lastEnd.getFullYear() - 1);
  return lastEnd.getTime() > EVENTS_BEGAN ? 'ended' : 'later';
}

/** Whether an event is still to come (soon or later): its bots wait for it. */
export const upcoming = (collection: BotCollection) => collection.status === 'soon' || collection.status === 'later';

/** Where a Venezuelan abroad came from and where they live now, from their description ("chef · Valencia → Madrid"). */
export function moveOf(bot: Bot): { from: string; to: string } | null {
  const match = bot.kind.match(/([^·]+?)\s*→\s*([^·]+)$/);
  return match ? { from: match[1].trim(), to: match[2].trim() } : null;
}

/**
 * An event's bots play on a ladder around your rating, easiest first, whoever is in costume: an event
 * made from the Masters would otherwise be out of reach for most players. Without a rating, a ladder
 * for a new player. Their own ratings stay as they are everywhere else.
 */
export const EVENT_SPREAD = 350;
export function eventLadder(bots: Bot[], rating: number | null): Bot[] {
  const middle = rating ?? 950;
  const low = Math.max(300, middle - EVENT_SPREAD), high = Math.min(2600, middle + EVENT_SPREAD);
  return bots.map((bot, i) => Object.assign(Object.create(bot) as Bot, {
    elo: Math.round((low + (bots.length > 1 ? i / (bots.length - 1) : 0.5) * (high - low)) / 10) * 10,
  }));
}

/** Every collection, in the order the picker lists them. Legends and engines come from the server; `rating` sets the event ladders. */
export function botCollections({ legends = [], engines = BOT_ROSTER.engines, now = Date.now(), rating = null }:
  { legends?: Bot[]; engines?: Bot[]; now?: number; rating?: number | null } = {}): BotCollection[] {
  const { themes, countries } = characterCollections();
  const events = eventCollections(now).map((group): BotCollection => ({
    id: group.id, kind: 'season', title: group.title, bots: eventLadder(group.bots, rating), theme: group.theme,
    status: statusOf(group, now), start: group.start, end: group.end, need: Math.ceil(group.bots.length / 2),
  }));
  const order: Record<EventStatus, number> = { live: 0, soon: 1, later: 2, ended: 3 };
  return [
    ...events.sort((a, b) => order[a.status!] - order[b.status!] || a.start! - b.start!),
    ...countriesWithVenezuela(countries),
    ...themes.map((theme): BotCollection => ({ ...theme, kind: 'theme' })),
    { id: 'always', kind: 'core', title: CATEGORY_TITLES.everyday, bots: BOT_ROSTER.everyday },
    { id: 'legends', kind: 'core', title: CATEGORY_TITLES.legends, bots: legends },
    { id: 'engines', kind: 'core', title: CATEGORY_TITLES.engines, bots: engines },
    { id: 'yours', kind: 'core', title: CATEGORY_TITLES.yours, bots: BOT_ROSTER.yours },
  ];
}

/** The collection a bot is in: a Venezuelan abroad's new country, a regular's own set (not an event it dresses up for). */
export const collectionOf = (collections: BotCollection[], botId: string) =>
  collections.find(c => c.movedHere?.includes(botId))
  ?? collections.find(c => c.kind !== 'season' && c.bots.some(b => b.id === botId)) ?? collections.find(c => c.bots.some(b => b.id === botId));

/** The country a Venezuelan abroad lives in now. */
export const newHomeOf = (collections: BotCollection[], botId: string) => collections.find(c => c.movedHere?.includes(botId));

/**
 * Why an event bot can't be played, or null when it can: a coming event's bots wait for it, and once an
 * event ends only the bots you beat during it stay.
 */
export function lockOf(collection: BotCollection, bot: Bot, progress: EventProgress = loadEvents()): 'soon' | 'ended' | null {
  if (collection.kind !== 'season' || collection.status === 'live') return null;
  if (upcoming(collection)) return 'soon';
  return isKept(collection.id, bot.id, progress) ? null : 'ended';
}

/** How many of an event's bots you beat during it. */
export const keptCount = (collection: BotCollection, progress: EventProgress = loadEvents()) =>
  collection.bots.filter(bot => isKept(collection.id, bot.id, progress)).length;

/** An event's collection while it is on, by id (for the game screen, which has the event but not its collection). */
export const liveEvent = (event: string, now = Date.now()) => botCollections({ now }).find(c => c.id === event && c.status === 'live');

/** An event's title, by id, whether or not it is on. */
export const eventTitle = (event: string) => botCollections().find(c => c.id === event)?.title ?? event;
