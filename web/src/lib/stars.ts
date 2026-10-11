// Stars: up to three per game, and the best result against each bot, kept in this browser.
import type { Color } from '../types';

const STARS_KEY = 'chess-jd-stars-v1';

/** Moves of your own that count as playing a game out, win or lose. */
export const FULL_GAME_MOVES = 20;

export interface StarGoal { label: string; earned: boolean }

export type Outcome = 'win' | 'draw' | 'loss';

export function outcomeFor(result: string, you: Color): Outcome {
  if (result === '1/2-1/2') return 'draw';
  return (result === '1-0') === (you === 'white') ? 'win' : 'loss';
}

/** The three goals of a finished game: play it out, don't lose, win. */
export function starGoals(result: string, you: Color, yourMoves: number): StarGoal[] {
  const outcome = outcomeFor(result, you);
  return [
    { label: `Last ${FULL_GAME_MOVES} moves, or don't lose`, earned: outcome !== 'loss' || yourMoves >= FULL_GAME_MOVES },
    { label: 'Avoid defeat', earned: outcome !== 'loss' },
    { label: 'Win the game', earned: outcome === 'win' },
  ];
}

export const starCount = (goals: StarGoal[]) => goals.filter(goal => goal.earned).length;

export function loadStars(): Record<string, number> {
  try {
    const saved = JSON.parse(localStorage.getItem(STARS_KEY) ?? '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}

/** Keep the best star count against `botId`; returns true when it improved. */
export function recordStars(botId: string, stars: number): boolean {
  const all = loadStars();
  if ((all[botId] ?? 0) >= stars) return false;
  all[botId] = stars;
  try { localStorage.setItem(STARS_KEY, JSON.stringify(all)); } catch { /* storage unavailable */ }
  return true;
}

export const totalStars = () => Object.values(loadStars()).reduce((sum, n) => sum + n, 0);

/** Forget every bot's stars (Settings' reset). */
export function clearStars() {
  try { localStorage.removeItem(STARS_KEY); } catch { /* storage unavailable */ }
}
