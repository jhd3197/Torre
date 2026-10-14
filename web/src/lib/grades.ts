// Move grades from the engine review, with the art and the words the review uses for each.
import grading from '../../../torre/content/grading.json';
import i18n from '../i18n';
import type { PlyEval } from '../hooks/useChess';
import type { AnalyzedMove, Grade, Judgment, Move } from '../types';

export type { Grade } from '../types';

/** analyze.SCORING_VERSION: a saved analysis from another version is graded again. */
export const SCORING_VERSION = 4;

/** The grade of an analysed move (scoring.grade). A move with no flag that was not Stockfish's choice is "good". */
export function gradeOf(move: AnalyzedMove): Grade {
  if (move.forced) return 'forced';
  if (move.brilliant) return 'brilliant';
  if (move.miss) return 'miss';
  if (move.class) return move.class;
  if (move.book) return 'book';
  if (move.great) return 'great';
  if (move.best) return 'best';
  return move.excellent ? 'excellent' : 'good';
}

export const GRADES: Grade[] = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'miss', 'mistake', 'blunder'];
export const emptyGrades = () => Object.fromEntries(GRADES.map(g => [g, 0])) as Record<Grade, number>;
const SYMBOLS: Record<Grade, string> = {
  brilliant: '!!', great: '!', best: '', excellent: '', good: '', book: '', forced: '□', inaccuracy: '?!', miss: '×', mistake: '?', blunder: '??',
};
/** Grades without coins of their own yet borrow the nearest one. */
const ART: Partial<Record<Grade, Grade>> = { excellent: 'good', forced: 'book', miss: 'mistake' };

// The words are read from the translation files each time, so they follow the chosen language.
export const GRADE_INFO = Object.fromEntries(GRADES.map(grade => [grade, {
  symbol: SYMBOLS[grade],
  get label() { return i18n.t(`board:grades.${grade}.label`); },
  get message() { return i18n.t(`board:grades.${grade}.message`); },
}])) as Record<Grade, { readonly label: string; readonly symbol: string; readonly message: string }>;

/** Grades worth marking in a move list (a "good" move is the quiet default). */
export const marked = (grade: Grade) => grade !== 'good';

/** The plain coin, for small marks: the board badge and the move list. */
export const gradeIcon = (grade: Grade) => `art/grades/icon/${ART[grade] ?? grade}.webp`;

// ---- Grading from the in-page review: scoring.py's Lichess rules, both reading content/grading.json ----
// (grading-cases.json pins the outputs of both sides to the same answers.)

export const WIN_CEILING_CP = grading.winCeilingCp;
const CEILING = WIN_CEILING_CP;
const { inaccuracy: MATE_INACCURACY, mistake: MATE_MISTAKE } = grading.mateLossCp;
const JUDGMENTS = grading.judgments as [number, Judgment][];
const { winning: STILL_WINNING, lost: STILL_LOST } = grading.stillDecided;
const MISS = grading.miss;
const MISSED_MATE_MAX = 5; // scoring.MISSED_MATE_MAX
const MATED_SCORE = 10000; // scoring.MATED_SCORE: a cp score this large is a mate on the board
const forcedCp = (cp: number | null, mate: number | null) =>
  mate != null ? (mate > 0 ? CEILING : -CEILING) : Math.max(-CEILING, Math.min(CEILING, cp ?? 0));
const chances = (cp: number) => 2 / (1 + Math.exp(-grading.winChancesK * cp)) - 1;
/** White's win% for a capped centipawn score (scoring.win_pct). */
export const winPct = (cp: number) => 50 + 50 * chances(cp);

type Eval = Pick<PlyEval, 'cp' | 'mate'> & Partial<PlyEval>;
const povCp = (e: Eval, sign: number) => forcedCp(e.cp == null ? null : e.cp * sign, e.mate == null ? null : e.mate * sign);
/** scoring.mover_win(): the mover's win%. */
const moverWin = (e: Eval, moverIsWhite: boolean) => winPct(povCp(e, moverIsWhite ? 1 : -1));

/** scoring.chances_drop(): how much the mover's winning chances (-1..1) fell with the move. */
export const chancesDrop = (before: Eval, after: Eval, moverIsWhite: boolean) =>
  chances(povCp(before, moverIsWhite ? 1 : -1)) - chances(povCp(after, moverIsWhite ? 1 : -1));

/** scoring.judge(): the judgment of one move from the evaluations around it, for the side that moved.
 *  Lichess's, with mistakes and blunders that leave the game as decided as it was capped at an inaccuracy. */
export function judge(before: Eval, after: Eval, moverIsWhite: boolean): Judgment | null {
  const label = lichessJudge(before, after, moverIsWhite);
  if (label !== 'mistake' && label !== 'blunder') return label;
  const wins = [moverWin(before, moverIsWhite), moverWin(after, moverIsWhite)];
  return Math.min(...wins) >= STILL_WINNING || Math.max(...wins) <= STILL_LOST ? 'inaccuracy' : label;
}

function lichessJudge(before: Eval, after: Eval, moverIsWhite: boolean): Judgment | null {
  const sign = moverIsWhite ? 1 : -1;
  const prevMate = before.mate == null ? null : before.mate * sign;
  const nextMate = after.mate == null ? null : after.mate * sign;
  const prev = forcedCp(before.cp == null ? null : before.cp * sign, prevMate);
  const next = forcedCp(after.cp == null ? null : after.cp * sign, nextMate);
  if (prevMate == null && nextMate != null && nextMate < 0) return prev < -MATE_INACCURACY ? 'inaccuracy' : prev < -MATE_MISTAKE ? 'mistake' : 'blunder';
  if (prevMate != null && prevMate > 0 && (nextMate == null || nextMate < 0)) {
    if (nextMate == null && next > MATE_INACCURACY) return 'inaccuracy';
    if (nextMate == null && next > MATE_MISTAKE) return 'mistake';
    return 'blunder';
  }
  if (prevMate != null || nextMate != null) return null;
  const drop = chances(prev) - chances(next);
  return JUDGMENTS.find(([threshold]) => drop >= threshold)?.[1] ?? null;
}

/** scoring.is_miss(): a forced mate let go, or the opponent's slip left unpunished, while the game stays playable.
 *  `earlier` is the evaluation before the opponent's last move. */
export function isMiss(earlier: Eval | null, before: Eval, after: Eval, moverIsWhite: boolean): boolean {
  const sign = moverIsWhite ? 1 : -1;
  if (after.mate === 0 || (after.mate == null && after.cp != null && after.cp * sign >= MATED_SCORE)) return false;
  const judgment = judge(before, after, moverIsWhite);
  if (judgment == null || moverWin(after, moverIsWhite) < MISS.minAfter) return false;
  const had = before.mate == null ? null : before.mate * sign, kept = after.mate == null ? null : after.mate * sign;
  if (had != null && had > 0 && had <= MISSED_MATE_MAX && (kept == null || kept < 0)) return true;
  return MISS.replaces.includes(judgment) && earlier != null && moverWin(before, moverIsWhite) >= MISS.minBefore
    && judge(earlier, before, !moverIsWhite) != null;
}

/** scoring.move_accuracy(), from the mover's win% before and after. */
export function moveAccuracy(before: number, after: number) {
  if (after >= before) return 100;
  const { scale, decay, offset, bonus } = grading.accuracy;
  const raw = scale * Math.exp(-decay * (before - after)) - offset;
  return Math.max(0, Math.min(100, raw + bonus));
}

/** Grades for every move whose position before and after the review has evaluated. `only` limits them to one side. */
export function gradeLine(moves: Move[], evals: (PlyEval | null)[], whiteFirst: boolean, only?: 'white' | 'black'): Map<number, AnalyzedMove> {
  const graded = new Map<number, AnalyzedMove>();
  moves.forEach((move, i) => {
    const before = evals[i], after = evals[i + 1];
    const moverIsWhite = (i % 2 === 0) === whiteFirst;
    if (!before || !after || (only && (only === 'white') !== moverIsWhite)) return;
    if (after.grade) {
      graded.set(i + 1, { ply: i + 1, san: move.san, ...after.grade });
      return;
    }
    // Without the server's grade there is no board here: brilliant and forced need one, so they are left out.
    const cls = judge(before, after, moverIsWhite), best = !!before.best && before.best === move.uci;
    graded.set(i + 1, {
      ply: i + 1, san: move.san, class: cls, best, brilliant: false,
      miss: isMiss(evals[i - 1] ?? null, before, after, moverIsWhite),
      excellent: !best && cls == null && chancesDrop(before, after, moverIsWhite) < grading.excellentMaxDrop,
      accuracy: Math.round(moveAccuracy(moverWin(before, moverIsWhite), moverWin(after, moverIsWhite)) * 10) / 10,
    });
  });
  return graded;
}
