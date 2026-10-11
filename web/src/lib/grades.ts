// Move grades from the engine review, with the art and the words the review uses for each.
import grading from '../../../torre/content/grading.json';
import i18n from '../i18n';
import type { PlyEval } from '../hooks/useChess';
import type { AnalyzedMove, Grade, Judgment, Move } from '../types';

export type { Grade } from '../types';

/** The grade of an analysed move. A move with no flag that was not Stockfish's choice is "good". */
export function gradeOf(move: AnalyzedMove): Grade {
  if (move.brilliant) return 'brilliant';
  if (move.class) return move.class;
  if (move.book) return 'book';
  if (move.great) return 'great';
  return move.best ? 'best' : 'good';
}

export const GRADES: Grade[] = ['brilliant', 'great', 'best', 'good', 'book', 'inaccuracy', 'mistake', 'blunder'];
export const emptyGrades = () => Object.fromEntries(GRADES.map(g => [g, 0])) as Record<Grade, number>;
const SYMBOLS: Record<Grade, string> = { brilliant: '!!', great: '!', best: '', good: '', book: '', inaccuracy: '?!', mistake: '?', blunder: '??' };

// The words are read from the translation files each time, so they follow the chosen language.
export const GRADE_INFO = Object.fromEntries(GRADES.map(grade => [grade, {
  symbol: SYMBOLS[grade],
  get label() { return i18n.t(`board:grades.${grade}.label`); },
  get message() { return i18n.t(`board:grades.${grade}.message`); },
}])) as Record<Grade, { readonly label: string; readonly symbol: string; readonly message: string }>;

/** Grades worth marking in a move list (a "good" move is the quiet default). */
export const marked = (grade: Grade) => grade !== 'good';

/** The plain coin, for small marks: the board badge and the move list. */
export const gradeIcon = (grade: Grade) => `art/grades/icon/${grade}.webp`;

// ---- Grading from the in-page review: scoring.py's Lichess rules, both reading content/grading.json ----
// (grading-cases.json pins the outputs of both sides to the same answers.)

export const WIN_CEILING_CP = grading.winCeilingCp;
const CEILING = WIN_CEILING_CP;
const { inaccuracy: MATE_INACCURACY, mistake: MATE_MISTAKE } = grading.mateLossCp;
const JUDGMENTS = grading.judgments as [number, Judgment][];
const forcedCp = (cp: number | null, mate: number | null) =>
  mate != null ? (mate > 0 ? CEILING : -CEILING) : Math.max(-CEILING, Math.min(CEILING, cp ?? 0));
const chances = (cp: number) => 2 / (1 + Math.exp(-grading.winChancesK * cp)) - 1;
/** White's win% for a capped centipawn score (scoring.win_pct). */
export const winPct = (cp: number) => 50 + 50 * chances(cp);

/** scoring.judge(): the judgment of one move from the evaluations around it, for the side that moved. */
export function judge(before: PlyEval, after: PlyEval, moverIsWhite: boolean): Judgment | null {
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
    const sign = moverIsWhite ? 1 : -1;
    const pov = (e: PlyEval) => winPct(forcedCp(e.cp == null ? null : e.cp * sign, e.mate == null ? null : e.mate * sign));
    graded.set(i + 1, {
      ply: i + 1, san: move.san, class: judge(before, after, moverIsWhite), best: !!before.best && before.best === move.uci,
      brilliant: false, accuracy: Math.round(moveAccuracy(pov(before), pov(after)) * 10) / 10,
    });
  });
  return graded;
}
