// The clock in a reviewed game: how long each side thought, when time trouble began, and the moves
// where time and quality met (an error played in a rush, a long think that still went wrong).
// The thresholds are game_stats.py's, through content/grading.json.
import grading from '../../../torre/content/grading.json';
import type { Grade } from './grades';
import type { Color, Move } from '../types';

const { trouble: TROUBLE, rushed: RUSHED } = grading.clock;
const ERRORS: Grade[] = ['inaccuracy', 'miss', 'mistake', 'blunder'];
const COSTLY: Grade[] = ['miss', 'mistake', 'blunder'];

/** Seconds on the mover's clock before each move: the clock after their previous move, or the start clock. */
export function clocksBefore(moves: Move[], startClock: number | null): (number | null)[] {
  return moves.map((_, i) => (i >= 2 ? moves[i - 2].clock ?? null : startClock));
}

/** Whether a clock (seconds left before the move) counts as time trouble: under 10% of the start or 30 s. */
export const inTrouble = (left: number, startClock: number | null) =>
  left < TROUBLE.seconds || (startClock != null && left < startClock * TROUBLE.fraction);

export interface ClockSummary {
  /** Average seconds per move, by side; null for a side with no timed move. */
  average: Record<Color, number | null>;
  /** The ply of the first move each side made in time trouble, null if it never was. */
  troubleAt: Record<Color, number | null>;
}

/** The two numbers for the summary. `whiteFirst`: White made the first move. */
export function clockSummary(moves: Move[], thinkTimes: (number | null)[], startClock: number | null, whiteFirst: boolean): ClockSummary {
  const sideOf = (i: number): Color => ((i % 2 === 0) === whiteFirst ? 'white' : 'black');
  const spent: Record<Color, number[]> = { white: [], black: [] };
  const troubleAt: Record<Color, number | null> = { white: null, black: null };
  clocksBefore(moves, startClock).forEach((left, i) => {
    const side = sideOf(i), seconds = thinkTimes[i];
    if (seconds != null) spent[side].push(seconds);
    if (left != null && troubleAt[side] == null && inTrouble(left, startClock)) troubleAt[side] = i + 1;
  });
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return { average: { white: mean(spent.white), black: mean(spent.black) }, troubleAt };
}

/** A move worth flagging on the clock chart: an error played in a rush (a mistake or worse in under 5 s,
 *  or under 3% of the clock), or a long think that still ended in an error. */
export function clockFlag(seconds: number | null, left: number | null, grade: Grade | null | undefined, longThink: number): 'rushed' | 'longWrong' | null {
  if (seconds == null || !grade) return null;
  if (COSTLY.includes(grade) && (seconds < RUSHED.seconds || (left != null && seconds < left * RUSHED.fraction))) return 'rushed';
  if (ERRORS.includes(grade) && seconds >= longThink) return 'longWrong';
  return null;
}
