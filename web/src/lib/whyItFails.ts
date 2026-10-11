// One plain sentence on why a move fails, from what the engine found (engine_service.judge_move).
// The words live in the lessons namespace (why.*); lessons and the play coach both say them.
import type { TFunction } from 'i18next';
import type { MoveJudgement } from '../hooks/useChess';

/** One plain sentence on why a move fails, from what the engine found: the tactic it allows,
 *  the material it drops, a forced win it lets slip, or else how much worse it is. */
export function whyItFails(t: TFunction<'lessons'>, judged: MoveJudgement, opponent: string): string {
  const motifs = judged.motifs ?? [];
  if (motifs.some(m => m.startsWith('mateIn') || m === 'backRankMate')) return t('why.mate', { opponent });
  if (motifs.includes('fork')) return t('why.fork', { opponent });
  if (motifs.includes('hangingPiece')) return t('why.hanging', { opponent });
  if (motifs.includes('promotion')) return t('why.promotion', { opponent });
  if ((judged.material ?? 0) <= -2) return t('why.material', { count: -(judged.material ?? 0) });
  if ((judged.expected_cp ?? 0) >= 9000) return t('why.missedMate');
  return t('why.worse', { pawns: (judged.loss / 100).toFixed(1) });
}
