// The hint ladder lessons share: each request shows one more rung, from a general nudge to the
// answer itself, so the reader gets as little help as finds the move. Hard mode takes the ladder away.
import { useState } from 'react';
import type { TFunction } from 'i18next';
import { hardMode } from '../../lib/settings';

export type Rung = 'nudge' | 'hint' | 'piece' | 'arrow';

export interface HintLadder {
  /** Rungs showing now, in order. */
  shown: Rung[];
  /** The next rung a request would show, or null at the top (or in hard mode). */
  next: Rung | null;
  climb: () => void;
  /** The move was played: the piece and arrow rungs (about that move) go, the words stay. */
  settle: () => void;
  /** Start the question over (a new stop). The counts below are kept. */
  reset: () => void;
  /** Rungs below the answer used so far, and whether the answer was ever shown: for the score. */
  hintsUsed: number;
  revealed: boolean;
  hard: boolean;
  /** Rungs on this ladder. */
  total: number;
}

/** The ladder for one question: `nudge` and `hint` are the step's own words; the last two rungs
 *  circle the piece to move, then draw the move. A step without a nudge uses the general one. */
export function useHintLadder(hint: string | null | undefined): HintLadder {
  const hard = hardMode.use();
  const [shown, setShown] = useState<Rung[]>([]);
  const [used, setUsed] = useState<{ hints: number; revealed: boolean }>({ hints: 0, revealed: false });
  const rungs: Rung[] = ['nudge', ...(hint ? ['hint' as const] : []), 'piece', 'arrow'];
  const next = hard ? null : rungs.find(rung => !shown.includes(rung)) ?? null;
  return {
    shown, next, hard, total: rungs.length,
    climb: () => {
      if (!next) return;
      setShown(s => [...s, next]);
      setUsed(u => next === 'arrow' ? { ...u, revealed: true } : { ...u, hints: u.hints + 1 });
    },
    settle: () => setShown(s => s.filter(rung => rung === 'nudge' || rung === 'hint')),
    reset: () => setShown([]),
    hintsUsed: used.hints,
    revealed: used.revealed,
  };
}

/** The button that climbs one rung. */
export const ladderLabel = (t: TFunction, next: Rung | null) =>
  next === 'arrow' ? t('step.showMove') : next === 'piece' ? t('hints.whichPiece') : t('step.showHint');

export { whyItFails } from '../../lib/whyItFails';

/** The footer's Hint button for a ladder: one pip per rung, filled as they show. None in hard mode
 *  (or when `show` is false); greyed out at the top of the ladder. */
export const hintButton = (t: TFunction, ladder: HintLadder, show = true) => (!show || ladder.hard ? undefined : {
  label: ladderLabel(t, ladder.next), used: ladder.shown.length, total: ladder.total, onClick: ladder.climb, disabled: !ladder.next,
});
