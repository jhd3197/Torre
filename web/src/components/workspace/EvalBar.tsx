import i18n from '../../i18n';
import { describeEval, evalFill, scoreLabel } from '../../lib/format';
import type { BoardState, EngineLine } from '../../types';

/** Evaluation bar for White. Pending analysis is striped, never shown as an even position. */
export function EvalBar({ board, line, flipped }: { board: BoardState | null; line: EngineLine | null; flipped: boolean }) {
  let label = '…', fill: number | null = null, title = i18n.t('board:eval.pending');
  if (board?.result) {
    label = board.result === '1/2-1/2' ? '0.00' : board.result;
    fill = board.result === '1-0' ? 100 : board.result === '0-1' ? 0 : 50;
    title = `${board.termination} · ${board.result}`;
  } else if (line) {
    label = scoreLabel(line);
    fill = evalFill(line.mate !== null ? (line.mate > 0 ? 10000 : -10000) : line.cp);
    title = i18n.t('board:eval.title', { score: label, verdict: describeEval(line) });
  }
  // The score sits at the end of the side that is ahead, in that side's ink, so it always reads.
  const ahead = fill === null ? undefined : fill >= 50 ? 'white' : 'black';
  const end = ahead && (ahead === 'white') !== flipped ? 'bottom' : 'top';
  return (
    <div className={`eval-track${fill === null ? ' pending' : ''}${flipped ? ' flipped' : ''}`} title={title}
      data-ahead={ahead} data-label={fill === null ? undefined : end}>
      <span id="eval-fill" style={fill === null ? undefined : { height: `${fill}%` }} />
      <b id="eval-value">{label}</b>
    </div>
  );
}
