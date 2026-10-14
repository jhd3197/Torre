// Why a good move is good, in one line for the review's verdict, the way whyItFails explains a slip:
// the only good move, a sacrifice that works, the chance a miss let go, the only legal move, or how
// close an excellent move came to the engine's. Everything comes from the review's lines and boards.
import type { TFunction } from 'i18next';
import { hangsAt, sacrificeOf } from './commentary';
import { winPct, WIN_CEILING_CP } from './grades';
import type { BoardState, EngineLine, Grade, Move } from '../types';

export interface WorksContext {
  grade: Grade;
  /** The review's top lines in the position before the move, best first. */
  picks: EngineLine[];
  moverWhite: boolean;
  played?: Move;
  /** The boards before and after the move. */
  before?: BoardState;
  after?: BoardState;
  /** The opponent's last move and the board before it (for a miss). */
  previous?: Move;
  earlier?: BoardState;
}

/** A line's win% for the side that moved. */
function moverWin(line: EngineLine, white: boolean) {
  const cp = line.mate != null ? Math.sign(line.mate) * WIN_CEILING_CP : Math.max(-WIN_CEILING_CP, Math.min(WIN_CEILING_CP, line.cp));
  return winPct(white ? cp : -cp);
}

/** The reason for a great, brilliant, miss, forced or excellent move, or null when there is none to give. */
export function whyItWorks(t: TFunction<'board'>, ctx: WorksContext): string | null {
  const { grade, picks, moverWhite, played, before, after } = ctx;
  const piece = (name: string) => t(`pieces.${name}`);
  switch (grade) {
    case 'great': {
      if (picks.length < 2) return null;
      const n = Math.round(moverWin(picks[0], moverWhite) - moverWin(picks[1], moverWhite));
      return n >= 1 ? t('verdict.why.great', { n }) : null;
    }
    case 'brilliant': {
      const given = before && after && played ? sacrificeOf(before, after, played.uci) : null;
      return given && played ? t('verdict.why.brilliant', { piece: piece(given), square: played.uci.slice(2, 4) }) : null;
    }
    case 'miss': {
      const mate = picks[0]?.mate;
      if (mate != null && (moverWhite ? mate : -mate) > 0) return t('verdict.why.missMate', { n: Math.abs(mate) });
      const left = ctx.earlier && before && ctx.previous ? hangsAt(ctx.earlier, before, ctx.previous.uci) : null;
      return left ? t('verdict.why.missHanging', { piece: piece(left.piece), square: left.square }) : t('verdict.why.missChance');
    }
    case 'forced':
      return t('verdict.why.forced');
    case 'excellent': {
      const best = picks[0];
      return best && best.uci[0] !== played?.uci && best.moves[0] ? t('verdict.why.excellent', { san: best.moves[0] }) : null;
    }
    default:
      return null;
  }
}
