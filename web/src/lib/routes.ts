// Every screen has a URL (served under any proxy prefix, see lib/base.ts):
//   /                      Home
//   /play                  your game against Stockfish (saved in this browser)
//   /play/bots             choose a bot and start a new game
//   /play/bots/:collection one collection of bots (an event, a country...); ?bot= picks one
//   /games                 the game library (opens the latest game)
//   /games/:id/:ply        a saved game at a move
//   /import                bring games in from chess.com, Lichess or PGN files
//   /explore?fen&moves     a free board; `base` moves come from `from`, the page to return to
//   /train                 drills from your mistakes
//   /openings              your opening repertoire, drilled with spaced repetition
//   /endgames/:id          theoretical endgames against Stockfish; /endgames lists them
//   /train/mistakes/:id    walk through one analyzed game, finding better moves at your errors
//   /train/guess/:master/:game  guess a legend's moves in one of their games
//   /puzzles/:theme/:id    puzzles by theme (or mixed, missed); /puzzles is the overview
//   /insights/:section     overview, openings, learn, blunders
//   /arena                 two players (engines, Maia models, legends) fight a match; /engines/arena redirects
//   /settings/:section     one settings page (language, display, sound, ...); /engines opens engines
//   /stage?fen&side        the YouTube set, no app shell; driven by window.__stage
import { START_FEN } from './format';

export const gamePath = (id: string | number, ply?: number) =>
  `/games/${encodeURIComponent(String(id))}${ply === undefined ? '' : `/${ply}`}`;

export interface ExploreState {
  fen: string;
  moves: string[];
  /** How many of `moves` come from the source line; Reset line returns here. */
  base: number;
  /** Route to return to ("Back to game"), if any. */
  from: string | null;
  /** View the board from Black's side. */
  flipped: boolean;
}

export function explorePath({ fen = START_FEN, moves = [], base, from, flipped }: Partial<ExploreState>): string {
  const params = new URLSearchParams();
  if (fen !== START_FEN) params.set('fen', fen);
  if (moves.length) params.set('moves', moves.join(','));
  if (base) params.set('base', String(base));
  if (from) params.set('from', from);
  if (flipped !== undefined) params.set('side', flipped ? 'black' : 'white');
  const query = params.toString();
  return `/explore${query ? `?${query}` : ''}`;
}

export function parseExplore(params: URLSearchParams): ExploreState {
  const moves = (params.get('moves') ?? '').split(',').filter(m => /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m));
  const base = Math.max(0, Math.min(moves.length, Number(params.get('base')) || 0));
  const from = params.get('from');
  const fen = params.get('fen') || START_FEN;
  const side = params.get('side');
  return { fen, moves, base, from: from && from.startsWith('/') ? from : null,
    flipped: side ? side === 'black' : fen.split(' ')[1] === 'b' };
}

export const insightSections = ['overview', 'openings', 'learn', 'blunders'] as const;
export type InsightSection = typeof insightSections[number];

export const lessonPath = (slug?: string, step?: number) =>
  slug ? `/lessons/${encodeURIComponent(slug)}${step === undefined ? '' : `/${step + 1}`}` : '/lessons';

export const endgamePath = (id?: string) => (id ? `/endgames/${encodeURIComponent(id)}` : '/endgames');

export const PUZZLE_MIXED = 'mixed';
export const PUZZLE_MISSED = 'missed';
export const PUZZLE_WEAK = 'weak';
export const PUZZLE_STREAK = 'streak';
export const PUZZLE_STORM = 'storm';
export const puzzlePath = (theme?: string, id?: string) =>
  theme ? `/puzzles/${encodeURIComponent(theme)}${id ? `/${encodeURIComponent(id)}` : ''}` : '/puzzles';

export const mistakesPath = (id: string | number) => `/train/mistakes/${encodeURIComponent(String(id))}`;
export const guessPath = (master?: string, game?: number) =>
  `/train/guess${master ? `/${encodeURIComponent(master)}${game === undefined ? '' : `/${game}`}` : ''}`;

export const settingsPath = (section?: string) => (section ? `/settings/${encodeURIComponent(section)}` : '/settings');
