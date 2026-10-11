// The sidebar's links: every page that can sit there, and which ones do, in what order (Settings → Sidebar).
// Settings itself is always one click away in the account menu at the foot of the rail, so any link can go.
import { createSetting } from './settings';

/** A sidebar destination; its label is the `rail.<key>` string in the nav namespace, its icon a mask image. */
export interface NavItem { to: string; key: string; icon: string; end?: boolean; match?: string }

export const NAV_ITEMS: readonly NavItem[] = [
  { to: '/', key: 'home', icon: 'art/nav/home.png', end: true },
  { to: '/story', key: 'story', icon: 'art/nav/explore.png', match: '/story' },
  { to: '/play/bots', key: 'play', icon: 'art/nav/play.png', match: '/play' },
  { to: '/puzzles', key: 'puzzles', icon: 'art/nav/puzzles.png', match: '/puzzles' },
  { to: '/arena', key: 'arena', icon: 'art/nav/train.png', match: '/arena' },
  { to: '/coach', key: 'coach', icon: 'art/nav/lessons.png', match: '/coach' },
  { to: '/profile', key: 'profile', icon: 'art/nav/awards.png', match: '/profile' },
  // Pages reached from others by default, which a player can pin to the sidebar.
  { to: '/games', key: 'games', icon: 'art/nav/games.png', match: '/games' },
  { to: '/explore', key: 'explore', icon: 'art/nav/explore.png', match: '/explore' },
  { to: '/train', key: 'train', icon: 'art/nav/train.png', match: '/train' },
  { to: '/openings', key: 'openings', icon: 'art/nav/lessons.png', match: '/openings' },
  { to: '/endgames', key: 'endgames', icon: 'art/nav/train.png', match: '/endgames' },
  { to: '/insights', key: 'insights', icon: 'art/nav/games.png', match: '/insights' },
  { to: '/awards', key: 'awards', icon: 'art/nav/awards.png', match: '/awards' },
  { to: '/import', key: 'import', icon: 'art/nav/games.png', match: '/import' },
  { to: '/settings', key: 'settings', icon: 'art/ui3d/settings.webp', match: '/settings' },
];

const KEYS = NAV_ITEMS.map(item => item.key);
/** One question per link: what now, what's next, who do I fight, let me drill, who wins, what to practise, how far have I come. */
export const DEFAULT_NAV = ['home', 'story', 'play', 'puzzles', 'arena', 'coach', 'profile'];

/** A stored list is known keys, each once, at least one. */
const validOrder = (value: string) => {
  const keys = value.split(',');
  return keys.length > 0 && keys.every(key => KEYS.includes(key)) && new Set(keys).size === keys.length;
};

/** The links shown, in order, as comma-separated keys. */
export const navOrder = createSetting<string>('chess-jd-nav', DEFAULT_NAV.join(','), validOrder);

const byKey = (key: string) => NAV_ITEMS.find(item => item.key === key)!;
/** The sidebar's links, in the chosen order. */
export const useNavItems = (): NavItem[] => navOrder.use().split(',').map(byKey);
/** The pages not in the sidebar, in catalogue order. */
export const hiddenNavItems = (shown: readonly string[]) => NAV_ITEMS.filter(item => !shown.includes(item.key));

/** The order with `key` moved by `step` places (−1 up, +1 down). */
export function moveNavItem(order: readonly string[], key: string, step: number): string[] {
  const from = order.indexOf(key), to = from + step;
  if (from < 0 || to < 0 || to >= order.length) return [...order];
  const next = [...order];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** The order with `key` placed before `before` (or at the end when null): a drag and drop. */
export function placeNavItem(order: readonly string[], key: string, before: string | null): string[] {
  const rest = order.filter(k => k !== key);
  const at = before === null ? rest.length : rest.indexOf(before);
  rest.splice(at < 0 ? rest.length : at, 0, key);
  return rest;
}
